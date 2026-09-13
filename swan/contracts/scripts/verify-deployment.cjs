// SPDX-License-Identifier: Apache-2.0

const { ethers } = require("hardhat");
const fs = require("node:fs");
const path = require("node:path");

const KYC_ROLE = "0x754f499f9fdfbb089d12bdec817a6863d593d8a3ea7f546c00a5cafd20957bfc";

function sameAddress(left, right) {
  return ethers.getAddress(left) === ethers.getAddress(right);
}

function requireAddress(name) {
  const value = process.env[name];
  if (!value) throw new Error(`${name} is required`);
  return value;
}

async function main() {
  const oracleAddress = requireAddress("ORACLE_ADDRESS");
  const repoAddress = requireAddress("REPO_CONTRACT_ADDRESS");
  const auctionAddress = requireAddress("AUCTION_CONTRACT_ADDRESS");
  const cashAddress = requireAddress("CASH_TOKEN_ADDRESS");
  const [deployer] = await ethers.getSigners();
  const expectedReviewer = process.env.COMPLIANCE_REVIEWER_ADDRESS || deployer.address;
  const expectedIssuer = process.env.KYC_ISSUER_ADDRESS || expectedReviewer;
  const expectedVerifier = process.env.SCHEDULE_VERIFIER_ADDRESS || expectedReviewer;
  const expectedPriceSigner = process.env.PRICE_SIGNER_ADDRESS || deployer.address;
  const expectedOracleMaxAge = Number(process.env.ORACLE_MAX_AGE_SECONDS || 180);

  const oracle = await ethers.getContractAt("SignedPriceOracle", oracleAddress);
  const repo = await ethers.getContractAt("RepoLifecycle", repoAddress);
  const auction = await ethers.getContractAt("ComplianceAuction", auctionAddress);
  const checks = {
    oracleCode: (await ethers.provider.getCode(oracleAddress)).length > 2,
    repoCode: (await ethers.provider.getCode(repoAddress)).length > 2,
    auctionCode: (await ethers.provider.getCode(auctionAddress)).length > 2,
    oracleSigner: sameAddress(await oracle.priceSigner(), expectedPriceSigner),
    oracleMaxAge: Number(await oracle.maxAge()) === expectedOracleMaxAge,
    repoOracle: sameAddress(await repo.oracle(), oracleAddress),
    repoCash: sameAddress(await repo.settlementCash(), cashAddress),
    scheduleVerifier: sameAddress(await repo.scheduleVerifier(), expectedVerifier),
    auctionOracle: sameAddress(await auction.priceOracle(), oracleAddress),
    auctionCash: sameAddress(await auction.settlementCash(), cashAddress),
    liquidationRouter: sameAddress(await auction.liquidationRouter(), repoAddress),
    complianceReviewer: sameAddress(await auction.complianceReviewer(), expectedReviewer),
  };
  const deploymentPath = path.resolve(__dirname, "../../deployments/hedera-testnet.json");
  const deployment = JSON.parse(fs.readFileSync(deploymentPath, "utf8"));
  const bonds = deployment.contracts.atsBonds || [];
  const registryDeployment = deployment.contracts.kycAccessRegistry;
  if (!registryDeployment?.evmAddress) throw new Error("KYC registry is missing from the deployment manifest");
  const registry = await ethers.getContractAt("KycAccessRegistry", registryDeployment.evmAddress);
  checks.kycRegistryCode = (await ethers.provider.getCode(registryDeployment.evmAddress)).length > 2;
  checks.kycReviewer = sameAddress(await registry.reviewer(), expectedReviewer);
  checks.kycIssuer = sameAddress(await registry.issuer(), expectedIssuer);
  checks.kycSecurityCount = Number(await registry.securityCount()) === bonds.length;
  checks.kycReviewerFullyGranted = await registry.isFullyKyc(expectedReviewer);
  for (const bond of bonds) {
    const security = new ethers.Contract(
      bond.evmAddress,
      [
        "function decimals() view returns (uint8)",
        "function balanceOf(address) view returns (uint256)",
        "function paused() view returns (bool)",
        "function isInternalKycActivated() view returns (bool)",
        "function getKycStatusFor(address) view returns (uint8)",
        "function hasRole(bytes32,address) view returns (bool)",
        "function canTransferFrom(address,address,uint256,bytes) view returns (bool,bytes1,bytes32)",
      ],
      ethers.provider,
    );
    const internalKyc = await security.isInternalKycActivated();
    const preflight = await security.canTransferFrom(deployer.address, repoAddress, 1, "0x");
    const prefix = bond.symbol.replace(/-/g, "_");
    checks[`${prefix}_code`] = (await ethers.provider.getCode(bond.evmAddress)).length > 2;
    checks[`${prefix}_decimals`] = Number(await security.decimals()) === bond.decimals;
    checks[`${prefix}_balance`] = (await security.balanceOf(deployer.address)) >= 20n;
    checks[`${prefix}_active`] = !(await security.paused());
    checks[`${prefix}_internalKyc`] = internalKyc;
    checks[`${prefix}_holderKyc`] = !internalKyc || Number(await security.getKycStatusFor(deployer.address)) === 1;
    checks[`${prefix}_repoKyc`] = !internalKyc || Number(await security.getKycStatusFor(repoAddress)) === 1;
    checks[`${prefix}_auctionKyc`] = !internalKyc || Number(await security.getKycStatusFor(auctionAddress)) === 1;
    checks[`${prefix}_registryRole`] = await security.hasRole(KYC_ROLE, registryDeployment.evmAddress);
    checks[`${prefix}_registryBond`] = sameAddress(await registry.securityAt(bonds.indexOf(bond)), bond.evmAddress);
    checks[`${prefix}_repoTransfer`] = preflight[0];
  }
  const failed = Object.entries(checks)
    .filter(([, value]) => !value)
    .map(([name]) => name);
  if (failed.length) throw new Error(`Deployment verification failed: ${failed.join(", ")}`);
  console.log(JSON.stringify({ verified: true, checks }, null, 2));
}

main().catch((error) => {
  console.error(error instanceof Error ? error.message : error);
  process.exitCode = 1;
});
