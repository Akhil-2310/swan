// SPDX-License-Identifier: Apache-2.0

const fs = require("node:fs");
const path = require("node:path");
const { ethers } = require("hardhat");

const DEPLOYMENT_PATH = path.resolve(__dirname, "../../deployments/hedera-testnet.json");
const KYC_ROLE = "0x754f499f9fdfbb089d12bdec817a6863d593d8a3ea7f546c00a5cafd20957bfc";

async function main() {
  const deployment = JSON.parse(fs.readFileSync(DEPLOYMENT_PATH, "utf8"));
  const bonds = deployment.contracts.atsBonds || [];
  if (bonds.length !== 4) throw new Error("Deploy all four ATS bonds before the KYC registry");
  const [deployer] = await ethers.getSigners();
  const reviewer = process.env.COMPLIANCE_REVIEWER_ADDRESS || deployer.address;
  const issuer = process.env.KYC_ISSUER_ADDRESS || reviewer;
  const existing = deployment.contracts.kycAccessRegistry;
  let evmAddress;
  let transactionHash;
  let reused = false;
  if (existing?.evmAddress && (await ethers.provider.getCode(existing.evmAddress)).length > 2) {
    evmAddress = existing.evmAddress;
    transactionHash = existing.transactionHash || null;
    reused = true;
  } else {
    const factory = await ethers.getContractFactory("KycAccessRegistry");
    const registry = await factory.deploy(
      reviewer,
      issuer,
      bonds.map((bond) => bond.evmAddress),
    );
    await registry.waitForDeployment();
    evmAddress = await registry.getAddress();
    transactionHash = registry.deploymentTransaction()?.hash || null;
  }

  for (const bond of bonds) {
    const security = new ethers.Contract(
      bond.evmAddress,
      ["function hasRole(bytes32,address) view returns (bool)", "function grantRole(bytes32,address) returns (bool)"],
      deployer,
    );
    if (!(await security.hasRole(KYC_ROLE, evmAddress))) {
      await (await security.grantRole(KYC_ROLE, evmAddress)).wait();
    }
  }
  deployment.contracts.kycAccessRegistry = {
    contractId: existing?.contractId || null,
    evmAddress,
    transactionHash,
    consensusTimestamp: existing?.consensusTimestamp || null,
    reviewer,
    issuer,
  };
  fs.writeFileSync(DEPLOYMENT_PATH, `${JSON.stringify(deployment, null, 2)}\n`);
  console.log(JSON.stringify({ ready: true, reused, evmAddress, transactionHash, reviewer, issuer }, null, 2));
}

main().catch((error) => {
  console.error(error instanceof Error ? error.stack || error.message : error);
  process.exitCode = 1;
});
