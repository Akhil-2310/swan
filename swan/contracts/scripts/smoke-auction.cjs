// SPDX-License-Identifier: Apache-2.0

const { ethers } = require("hardhat");

const ERC20_ABI = [
  "function approve(address,uint256) returns (bool)",
  "function balanceOf(address) view returns (uint256)",
];

function required(name) {
  const value = process.env[name];
  if (!value) throw new Error(`${name} is required`);
  return value;
}

function eventId(contract, receipt, name, argument) {
  for (const log of receipt.logs) {
    try {
      const parsed = contract.interface.parseLog(log);
      if (parsed?.name === name) return BigInt(parsed.args[argument]);
    } catch {
      // Ignore logs emitted by the ATS token or native USDC.
    }
  }
  throw new Error(`${name} event missing`);
}

async function waitForTimestamp(timestamp) {
  while (true) {
    const block = await ethers.provider.getBlock("latest");
    if (block.timestamp >= timestamp) return;
    await new Promise((resolve) => setTimeout(resolve, Math.min(3_000, (timestamp - block.timestamp) * 1_000)));
  }
}

async function main() {
  const [signer] = await ethers.getSigners();
  const securityAddress = required("SECURITY_ADDRESS");
  const auctionAddress = required("AUCTION_CONTRACT_ADDRESS");
  const cashAddress = required("CASH_TOKEN_ADDRESS");
  const oracle = await ethers.getContractAt("SignedPriceOracle", required("ORACLE_ADDRESS"), signer);
  const auction = await ethers.getContractAt("ComplianceAuction", auctionAddress, signer);
  const security = new ethers.Contract(securityAddress, ERC20_ABI, signer);
  const cash = new ethers.Contract(cashAddress, ERC20_ABI, signer);
  const quantity = 2n;
  const unitPrice = 1_000_000n;
  const reserve = 1_800_000n;
  const bidAmount = 2_000_000n;
  const bondBalanceBefore = await security.balanceOf(signer.address);
  const cashBalanceBefore = await cash.balanceOf(signer.address);

  const observedAt = BigInt((await ethers.provider.getBlock("latest")).timestamp);
  const nonce = await oracle.nextNonce();
  const payload = await oracle.securityPayloadHash(securityAddress, unitPrice, observedAt, nonce);
  const signature = await signer.signMessage(ethers.getBytes(payload));
  const priceReceipt = await (
    await oracle.submitSecurityPrice(securityAddress, unitPrice, observedAt, nonce, signature)
  ).wait();

  const approvalReceipt = await (await security.approve(auctionAddress, quantity)).wait();
  const latest = await ethers.provider.getBlock("latest");
  const deadline = latest.timestamp + 55;
  const listingReceipt = await (
    await auction.createVoluntaryAuction(
      securityAddress,
      cashAddress,
      quantity,
      reserve,
      deadline,
      unitPrice * quantity,
      1_500,
    )
  ).wait();
  const auctionId = eventId(auction, listingReceipt, "AuctionListed", "auctionId");

  const cashApprovalReceipt = await (await cash.approve(auctionAddress, bidAmount)).wait();
  const bidReceipt = await (await auction.bid(auctionId, bidAmount)).wait();
  await waitForTimestamp(deadline);
  const closeReceipt = await (await auction.close(auctionId)).wait();
  const settleReceipt = await (await auction.settle(auctionId)).wait();

  const snapshot = await auction.auctions(auctionId);
  const bondBalanceAfter = await security.balanceOf(signer.address);
  const cashBalanceAfter = await cash.balanceOf(signer.address);
  if (snapshot.state !== 3n) throw new Error(`Expected settled state 3, received ${snapshot.state}`);
  if (bondBalanceAfter !== bondBalanceBefore) throw new Error("ATS DvP did not return the self-test lot to its owner");
  if (cashBalanceAfter !== cashBalanceBefore) throw new Error("USDC DvP self-test balance did not reconcile");

  const receipts = {
    price: priceReceipt,
    securityApproval: approvalReceipt,
    listing: listingReceipt,
    cashApproval: cashApprovalReceipt,
    bid: bidReceipt,
    close: closeReceipt,
    settlement: settleReceipt,
  };
  console.log(
    JSON.stringify(
      {
        passed: true,
        auctionId: auctionId.toString(),
        security: securityAddress,
        cash: cashAddress,
        quantity: quantity.toString(),
        bidUsdc: ethers.formatUnits(bidAmount, 6),
        evidence: Object.fromEntries(
          Object.entries(receipts).map(([name, receipt]) => [
            name,
            `https://hashscan.io/testnet/transaction/${receipt.hash}`,
          ]),
        ),
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
