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

async function publishSecurityPrice(oracle, signer, security, price) {
  const observedAt = BigInt((await ethers.provider.getBlock("latest")).timestamp);
  const nonce = await oracle.nextNonce();
  const payload = await oracle.securityPayloadHash(security, price, observedAt, nonce);
  const signature = await signer.signMessage(ethers.getBytes(payload));
  return (await oracle.submitSecurityPrice(security, price, observedAt, nonce, signature)).wait();
}

async function main() {
  const [signer] = await ethers.getSigners();
  const securityAddress = required("SECURITY_ADDRESS");
  const repoAddress = required("REPO_CONTRACT_ADDRESS");
  const auctionAddress = required("AUCTION_CONTRACT_ADDRESS");
  const cashAddress = required("CASH_TOKEN_ADDRESS");
  const oracle = await ethers.getContractAt("SignedPriceOracle", required("ORACLE_ADDRESS"), signer);
  const repo = await ethers.getContractAt("RepoLifecycle", repoAddress, signer);
  const auction = await ethers.getContractAt("ComplianceAuction", auctionAddress, signer);
  const security = new ethers.Contract(securityAddress, ERC20_ABI, signer);
  const cash = new ethers.Contract(cashAddress, ERC20_ABI, signer);
  const quantity = 2n;
  const principal = 2_500_000n;
  const entryPrice = 1_500_000n;
  const stormPrice = 500_000n;
  const liquidationBid = 1_050_000n;
  const bondBalanceBefore = await security.balanceOf(signer.address);
  const cashBalanceBefore = await cash.balanceOf(signer.address);
  const receipts = {};

  receipts.entryPrice = await publishSecurityPrice(oracle, signer, securityAddress, entryPrice);
  receipts.securityApproval = await (await security.approve(repoAddress, quantity)).wait();
  const latest = await ethers.provider.getBlock("latest");
  const fundingDeadline = latest.timestamp + 50;
  const maturity = fundingDeadline + 45;
  receipts.request = await (
    await repo.requestRepo(cashAddress, principal, fundingDeadline, maturity, 10_500, [
      [securityAddress, quantity, entryPrice, 1_000, 10_000],
    ])
  ).wait();
  const repoId = eventId(repo, receipts.request, "RepoRequested", "repoId");

  receipts.cashApproval = await (await cash.approve(repoAddress, 3_000_000n)).wait();
  receipts.offer = await (await repo.offerFunding(repoId, 410)).wait();
  await waitForTimestamp(fundingDeadline);
  receipts.open = await (await repo.openRepo(repoId)).wait();

  receipts.stormPrice = await publishSecurityPrice(oracle, signer, securityAddress, stormPrice);
  receipts.marginCall = await (await repo.refreshPrice(repoId, 0)).wait();
  if ((await repo.repos(repoId)).state !== 3n) throw new Error("Oracle storm did not start a margin call");
  await waitForTimestamp(maturity);
  receipts.default = await (await repo.declareDefault(repoId)).wait();

  const auctionDeadline = (await ethers.provider.getBlock("latest")).timestamp + 50;
  receipts.liquidation = await (
    await repo.createLiquidationAuctions(repoId, auctionAddress, auctionDeadline, 1_500)
  ).wait();
  const auctionId = eventId(repo, receipts.liquidation, "LiquidationAuctionCreated", "auctionId");
  receipts.bidApproval = await (await cash.approve(auctionAddress, liquidationBid)).wait();
  receipts.bid = await (await auction.bid(auctionId, liquidationBid)).wait();
  await waitForTimestamp(auctionDeadline);
  receipts.auctionClose = await (await auction.close(auctionId)).wait();
  receipts.settlement = await (await auction.settle(auctionId)).wait();

  const repoSnapshot = await repo.repos(repoId);
  const auctionSnapshot = await auction.auctions(auctionId);
  const bondBalanceAfter = await security.balanceOf(signer.address);
  const cashBalanceAfter = await cash.balanceOf(signer.address);
  if (repoSnapshot.state !== 5n) throw new Error(`Expected liquidation repo state 5, received ${repoSnapshot.state}`);
  if (auctionSnapshot.state !== 3n)
    throw new Error(`Expected settled auction state 3, received ${auctionSnapshot.state}`);
  if (bondBalanceAfter !== bondBalanceBefore) throw new Error("Liquidated ATS collateral did not reconcile");
  if (cashBalanceAfter !== cashBalanceBefore) throw new Error("Repo and liquidation USDC balances did not reconcile");

  console.log(
    JSON.stringify(
      {
        passed: true,
        repoId: repoId.toString(),
        auctionId: auctionId.toString(),
        path: ["request", "funding", "open", "margin-call", "maturity-default", "liquidation", "DvP"],
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
