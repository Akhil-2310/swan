// SPDX-License-Identifier: Apache-2.0

const { ethers } = require("hardhat");

async function main() {
  const [deployer] = await ethers.getSigners();
  const reviewer = process.env.COMPLIANCE_REVIEWER_ADDRESS || deployer.address;
  const scheduleVerifier = process.env.SCHEDULE_VERIFIER_ADDRESS || reviewer;
  const priceSigner = process.env.PRICE_SIGNER_ADDRESS || deployer.address;
  const network = await ethers.provider.getNetwork();
  const cash =
    process.env.CASH_TOKEN_ADDRESS ||
    (network.chainId === 296n ? "0x0000000000000000000000000000000000068cda" : undefined);
  if (!cash) throw new Error("CASH_TOKEN_ADDRESS is required outside Hedera testnet");
  let oracle = process.env.ORACLE_ADDRESS;
  let oracleTransactionHash = null;
  if (!oracle) {
    const oracleFactory = await ethers.getContractFactory("SignedPriceOracle");
    const signedOracle = await oracleFactory.deploy(priceSigner, Number(process.env.ORACLE_MAX_AGE_SECONDS || 180));
    await signedOracle.waitForDeployment();
    oracle = await signedOracle.getAddress();
    oracleTransactionHash = signedOracle.deploymentTransaction()?.hash ?? null;
  }
  const repoFactory = await ethers.getContractFactory("RepoLifecycle");
  const repo = await repoFactory.deploy(
    oracle,
    cash,
    scheduleVerifier,
    Number(process.env.MARGIN_WINDOW_SECONDS || 300),
  );
  await repo.waitForDeployment();

  const factory = await ethers.getContractFactory("ComplianceAuction");
  const auction = await factory.deploy(reviewer, await repo.getAddress(), cash, oracle);
  await auction.waitForDeployment();

  console.log(
    JSON.stringify(
      {
        network: (await ethers.provider.getNetwork()).name,
        deployer: deployer.address,
        repoLifecycle: await repo.getAddress(),
        complianceAuction: await auction.getAddress(),
        reviewer,
        scheduleVerifier,
        cash,
        oracle,
        priceSigner,
        liquidationRouter: await repo.getAddress(),
        transactionHashes: {
          signedPriceOracle: oracleTransactionHash,
          repoLifecycle: repo.deploymentTransaction()?.hash ?? null,
          complianceAuction: auction.deploymentTransaction()?.hash ?? null,
        },
      },
      null,
      2,
    ),
  );
}

main().catch((error) => {
  console.error(error);
  process.exitCode = 1;
});
