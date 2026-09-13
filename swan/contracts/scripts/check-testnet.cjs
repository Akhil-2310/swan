// SPDX-License-Identifier: Apache-2.0

const { ethers } = require("hardhat");

async function main() {
  const missing = ["DEPLOYER_PRIVATE_KEY"].filter((name) => !process.env[name]);
  if (missing.length) {
    throw new Error(`Missing testnet configuration: ${missing.join(", ")}`);
  }
  const [deployer] = await ethers.getSigners();
  const network = await ethers.provider.getNetwork();
  if (network.chainId !== 296n) throw new Error(`Expected Hedera testnet chain 296, received ${network.chainId}`);
  const balance = await ethers.provider.getBalance(deployer.address);
  if (balance === 0n) throw new Error(`Deployer ${deployer.address} has no testnet HBAR`);
  console.log(
    JSON.stringify(
      {
        ready: true,
        chainId: network.chainId.toString(),
        deployer: deployer.address,
        balanceTinybar: balance.toString(),
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
