// SPDX-License-Identifier: Apache-2.0

import assert from "node:assert/strict";
import test from "node:test";
import { AuctionRuleError, createDemoEngine } from "./index.js";

const NOW = 1_800_000_000;

function list(kind: "VOLUNTARY" | "LIQUIDATION" = "VOLUNTARY") {
  const engine = createDemoEngine();
  const auction = engine.createAuction(
    {
      kind,
      sellerId: "seller",
      beneficiaryId: kind === "LIQUIDATION" ? "lender" : "seller",
      quantity: 10n,
      reservePrice: 950_000n,
      deadline: NOW + 60,
      oraclePrice: 1_000_000n,
    },
    NOW,
  );
  return { engine, auction };
}

test("rejects an ineligible bidder for ATS KYC and records the attempt", () => {
  const { engine, auction } = list();
  assert.throws(
    () => engine.bid(auction.id, "blocked", 960_000n, NOW + 1),
    (error) => {
      assert.ok(error instanceof AuctionRuleError);
      assert.equal(error.code, "BIDDER_NOT_KYC");
      return true;
    },
  );
  assert.equal(engine.getAuction(auction.id).events.at(-1)?.type, "BID_REJECTED");
  assert.equal(engine.getAccounts().find((account) => account.id === "blocked")?.cashBalance, 1_500_000n);
});

test("selects the highest valid bid, settles DvP, and fully releases the loser", () => {
  const { engine, auction } = list();
  engine.bid(auction.id, "bidder-a", 980_000n, NOW + 1);
  engine.bid(auction.id, "bidder-b", 1_040_000n, NOW + 2);
  engine.close(auction.id, NOW + 60);
  const settled = engine.settle(auction.id, NOW + 61);
  const accounts = engine.getAccounts();

  assert.equal(settled.state, "SETTLED");
  assert.equal(settled.winnerId, "bidder-b");
  assert.equal(accounts.find((account) => account.id === "bidder-b")?.securityBalance, 10n);
  assert.equal(accounts.find((account) => account.id === "bidder-b")?.cashBalance, 460_000n);
  assert.equal(accounts.find((account) => account.id === "bidder-a")?.cashBalance, 1_500_000n);
  assert.equal(accounts.find((account) => account.id === "seller")?.cashBalance, 1_040_000n);
  assert.equal(
    accounts.reduce((sum, account) => sum + account.securityBalance, 0n),
    100n,
  );
  assert.equal(
    accounts.reduce((sum, account) => sum + account.cashBalance + account.committedCash, 0n),
    4_500_000n,
  );
});

test("blocks settlement after the ATS security is paused without moving balances", () => {
  const { engine, auction } = list();
  engine.bid(auction.id, "bidder-a", 980_000n, NOW + 1);
  engine.close(auction.id, NOW + 60);
  engine.setPaused(true);
  const before = engine.getAccounts();
  assert.throws(() => engine.settle(auction.id, NOW + 61), /ATS security is paused/);
  assert.deepEqual(engine.getAccounts(), before);
  assert.equal(engine.getAuction(auction.id).state, "CLOSED");
});

test("requires authorized review for a price outside oracle sanity bounds", () => {
  const { engine, auction } = list();
  engine.bid(auction.id, "bidder-a", 1_200_000n, NOW + 1);
  engine.close(auction.id, NOW + 60);
  assert.throws(() => engine.settle(auction.id, NOW + 61), /outside oracle sanity bounds/);
  engine.approveOracleException(auction.id, "compliance-reviewer", NOW + 62);
  assert.equal(engine.settle(auction.id, NOW + 63).state, "SETTLED");
});

test("routes liquidation proceeds to the repo lender beneficiary", () => {
  const { engine, auction } = list("LIQUIDATION");
  engine.bid(auction.id, "bidder-a", 1_000_000n, NOW + 1);
  engine.close(auction.id, NOW + 60);
  engine.settle(auction.id, NOW + 61);
  const accounts = engine.getAccounts();
  assert.equal(accounts.find((account) => account.id === "lender")?.cashBalance, 1_000_000n);
  assert.equal(accounts.find((account) => account.id === "seller")?.cashBalance, 0n);
});

test("caps lender recovery at its claim and returns liquidation surplus", () => {
  const engine = createDemoEngine();
  const auction = engine.createAuction(
    {
      kind: "LIQUIDATION",
      sellerId: "seller",
      beneficiaryId: "lender",
      surplusRecipientId: "seller",
      lenderClaim: 1_000_000n,
      quantity: 10n,
      reservePrice: 900_000n,
      deadline: NOW + 60,
      oraclePrice: 1_000_000n,
    },
    NOW,
  );
  engine.bid(auction.id, "bidder-b", 1_100_000n, NOW + 1);
  engine.close(auction.id, NOW + 60);
  engine.settle(auction.id, NOW + 61);

  const accounts = engine.getAccounts();
  assert.equal(accounts.find((account) => account.id === "lender")?.cashBalance, 1_000_000n);
  assert.equal(accounts.find((account) => account.id === "seller")?.cashBalance, 100_000n);
});

test("returns the lot and all funded cash when reserve is not met", () => {
  const { engine, auction } = list();
  engine.bid(auction.id, "bidder-a", 900_000n, NOW + 1);
  const closed = engine.close(auction.id, NOW + 60);
  const accounts = engine.getAccounts();
  assert.equal(closed.state, "FAILED_NO_VALID_BID");
  assert.equal(accounts.find((account) => account.id === "seller")?.securityBalance, 100n);
  assert.equal(accounts.find((account) => account.id === "bidder-a")?.cashBalance, 1_500_000n);
});

test("prevents double-listing by reserving the seller's available units", () => {
  const { engine } = list();
  assert.throws(
    () =>
      engine.createAuction(
        { kind: "VOLUNTARY", sellerId: "seller", quantity: 91n, reservePrice: 1n, deadline: NOW + 60, oraclePrice: 1n },
        NOW,
      ),
    /insufficient available units/,
  );
});
