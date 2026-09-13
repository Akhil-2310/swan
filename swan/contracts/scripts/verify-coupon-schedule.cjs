// SPDX-License-Identifier: Apache-2.0

const { ethers } = require("hardhat");

function required(name) {
  const value = process.env[name];
  if (!value) throw new Error(`${name} is required`);
  return value;
}

async function main() {
  const [verifier] = await ethers.getSigners();
  const repo = await ethers.getContractAt("RepoLifecycle", required("REPO_CONTRACT_ADDRESS"), verifier);
  if ((await repo.scheduleVerifier()).toLowerCase() !== verifier.address.toLowerCase()) {
    throw new Error("The configured signer is not the deployed schedule verifier");
  }
  const scheduleId = required("COUPON_SCHEDULE_ID");
  const scheduleHash = ethers.id(scheduleId);
  const transaction = await repo.verifyCouponEquivalentSchedule(BigInt(required("REPO_ID")), scheduleHash);
  const receipt = await transaction.wait();
  console.log(
    JSON.stringify(
      {
        transactionHash: receipt.hash,
        scheduleId,
        scheduleHash,
        mirrorUrl: `https://testnet.mirrornode.hedera.com/api/v1/contracts/results/${receipt.hash}`,
      },
      null,
      2,
    ),
  );
}

main().catch((error) => {
  console.error(error instanceof Error ? error.message : error);
  process.exitCode = 1;
});
