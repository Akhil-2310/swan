// SPDX-License-Identifier: Apache-2.0

const { ethers } = require("hardhat");

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
  const expectedVerifier = process.env.SCHEDULE_VERIFIER_ADDRESS || expectedReviewer;
  const expectedPriceSigner = process.env.PRICE_SIGNER_ADDRESS || deployer.address;

  const oracle = await ethers.getContractAt("SignedPriceOracle", oracleAddress);
  const repo = await ethers.getContractAt("RepoLifecycle", repoAddress);
  const auction = await ethers.getContractAt("ComplianceAuction", auctionAddress);
  const checks = {
    oracleCode: (await ethers.provider.getCode(oracleAddress)).length > 2,
    repoCode: (await ethers.provider.getCode(repoAddress)).length > 2,
    auctionCode: (await ethers.provider.getCode(auctionAddress)).length > 2,
    oracleSigner: sameAddress(await oracle.priceSigner(), expectedPriceSigner),
    repoOracle: sameAddress(await repo.oracle(), oracleAddress),
    repoCash: sameAddress(await repo.settlementCash(), cashAddress),
    scheduleVerifier: sameAddress(await repo.scheduleVerifier(), expectedVerifier),
    auctionOracle: sameAddress(await auction.priceOracle(), oracleAddress),
    auctionCash: sameAddress(await auction.settlementCash(), cashAddress),
    liquidationRouter: sameAddress(await auction.liquidationRouter(), repoAddress),
    complianceReviewer: sameAddress(await auction.complianceReviewer(), expectedReviewer),
  };
  if (process.env.SECURITY_ADDRESS) {
    const security = new ethers.Contract(
      process.env.SECURITY_ADDRESS,
      [
        "function decimals() view returns (uint8)",
        "function balanceOf(address) view returns (uint256)",
        "function paused() view returns (bool)",
        "function isInternalKycActivated() view returns (bool)",
        "function getKycStatusFor(address) view returns (uint8)",
        "function canTransferFrom(address,address,uint256,bytes) view returns (bool,bytes1,bytes32)",
      ],
      ethers.provider,
    );
    const internalKyc = await security.isInternalKycActivated();
    const preflight = await security.canTransferFrom(deployer.address, repoAddress, 2, "0x");
    Object.assign(checks, {
      atsBondCode: (await ethers.provider.getCode(process.env.SECURITY_ADDRESS)).length > 2,
      atsBondDecimals: Number(await security.decimals()) <= 18,
      atsBondBalance: (await security.balanceOf(deployer.address)) >= 20n,
      atsBondActive: !(await security.paused()),
      atsInternalKycActive: internalKyc,
      atsHolderKyc: !internalKyc || Number(await security.getKycStatusFor(deployer.address)) === 1,
      atsRepoKyc: !internalKyc || Number(await security.getKycStatusFor(repoAddress)) === 1,
      atsAuctionKyc: !internalKyc || Number(await security.getKycStatusFor(auctionAddress)) === 1,
      atsRepoTransferPreflight: preflight[0],
    });
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
