// SPDX-License-Identifier: Apache-2.0

const { ethers } = require("hardhat");

async function main() {
  const repoAddress = process.env.REPO_CONTRACT_ADDRESS;
  const repoId = process.env.REPO_ID;
  if (!repoAddress || !repoId) throw new Error("REPO_CONTRACT_ADDRESS and REPO_ID are required");

  const [signer] = await ethers.getSigners();
  const repo = await ethers.getContractAt("RepoLifecycle", repoAddress, signer);
  const snapshot = await repo.repos(repoId);
  if (ethers.getAddress(snapshot.borrower) !== ethers.getAddress(signer.address)) {
    throw new Error(`Signer ${signer.address} is not the borrower for Repo ${repoId}`);
  }
  if (Number(snapshot.state) !== 1) {
    console.log(JSON.stringify({ reclaimed: false, repoId, state: Number(snapshot.state), reason: "not funding" }));
    return;
  }

  const receipt = await (await repo.reclaimUnfundedRepo(repoId)).wait();
  console.log(
    JSON.stringify(
      {
        reclaimed: true,
        repoId,
        transactionHash: receipt.hash,
        blockNumber: receipt.blockNumber,
      },
      null,
      2,
    ),
  );
}

main().catch((error) => {
  console.error(error instanceof Error ? error.stack || error.message : error);
  process.exitCode = 1;
});
