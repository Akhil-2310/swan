// SPDX-License-Identifier: Apache-2.0

const { ethers } = require("hardhat");

function required(name) {
  const value = process.env[name];
  if (!value) throw new Error(`${name} is required`);
  return value;
}

async function main() {
  const [relayer] = await ethers.getSigners();
  const oracle = await ethers.getContractAt("SignedPriceOracle", required("ORACLE_ADDRESS"), relayer);
  const signer = process.env.PRICE_SIGNER_PRIVATE_KEY
    ? new ethers.Wallet(process.env.PRICE_SIGNER_PRIVATE_KEY)
    : relayer;
  if ((await oracle.priceSigner()).toLowerCase() !== signer.address.toLowerCase()) {
    throw new Error("Configured price signer does not match the deployed oracle");
  }

  const price = BigInt(required("ORACLE_PRICE"));
  const observedAt = BigInt(Math.floor(Date.now() / 1000));
  const nonce = await oracle.nextNonce();
  const security = process.env.SECURITY_ADDRESS;
  if (security) {
    const hash = await oracle.securityPayloadHash(security, price, observedAt, nonce);
    const signature = await signer.signMessage(ethers.getBytes(hash));
    const transaction = await oracle.submitSecurityPrice(security, price, observedAt, nonce, signature);
    const receipt = await transaction.wait();
    console.log(
      JSON.stringify(
        {
          transactionHash: receipt.hash,
          security,
          price: price.toString(),
          observedAt: observedAt.toString(),
          nonce: nonce.toString(),
          mirrorUrl: `https://testnet.mirrornode.hedera.com/api/v1/contracts/results/${receipt.hash}`,
        },
        null,
        2,
      ),
    );
    return;
  }

  const repo = required("REPO_CONTRACT_ADDRESS");
  const repoId = BigInt(required("REPO_ID"));
  const collateralIndex = BigInt(required("COLLATERAL_INDEX"));
  const hash = await oracle.payloadHash(repo, repoId, collateralIndex, price, observedAt, nonce);
  const signature = await signer.signMessage(ethers.getBytes(hash));
  const transaction = await oracle.submitPrice(repo, repoId, collateralIndex, price, observedAt, nonce, signature);
  const receipt = await transaction.wait();
  console.log(
    JSON.stringify(
      {
        transactionHash: receipt.hash,
        repo,
        repoId: repoId.toString(),
        collateralIndex: collateralIndex.toString(),
        price: price.toString(),
        observedAt: observedAt.toString(),
        nonce: nonce.toString(),
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
