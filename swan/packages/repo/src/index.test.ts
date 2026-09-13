// SPDX-License-Identifier: Apache-2.0

import assert from "node:assert/strict";
import test from "node:test";
import { RepoRuleError, challengeRules, createRepoFixture } from "./index.js";

function fund(engine = createRepoFixture()) {
  engine.optimizeBasket();
  engine.openFunding();
  engine.submitOffer({
    lenderId: "atlas",
    lenderLabel: "Atlas Capital",
    rateBps: 475,
    cashAvailable: 2_000_000n,
    kycEligible: true,
    submittedAt: 2,
  });
  engine.submitOffer({
    lenderId: "meridian",
    lenderLabel: "Meridian Bank",
    rateBps: 410,
    cashAvailable: 2_000_000n,
    kycEligible: true,
    submittedAt: 3,
  });
  return engine;
}

test("optimizer meets the target with the least valid market value", () => {
  const engine = createRepoFixture();
  const basket = engine.optimizeBasket();
  const metrics = engine.metrics();
  assert.ok(basket.length >= 2);
  assert.ok(metrics.borrowingCapacity >= engine.terms.requiredCash);
  assert.equal(metrics.valid, true);
});

test("funding race selects the lowest eligible funded rate", () => {
  const engine = fund();
  assert.equal(engine.activate().lenderId, "meridian");
  assert.equal(engine.state, "ACTIVE");
});

test("ineligible and unfunded lenders are rejected", () => {
  const engine = createRepoFixture();
  engine.optimizeBasket();
  engine.openFunding();
  assert.throws(
    () =>
      engine.submitOffer({
        lenderId: "bad",
        lenderLabel: "Bad",
        rateBps: 300,
        cashAvailable: 2_000_000n,
        kycEligible: false,
        submittedAt: 1,
      }),
    (error) => error instanceof RepoRuleError && error.code === "LENDER_NOT_KYC",
  );
  assert.throws(
    () =>
      engine.submitOffer({
        lenderId: "poor",
        lenderLabel: "Poor",
        rateBps: 300,
        cashAvailable: 1n,
        kycEligible: true,
        submittedAt: 1,
      }),
    (error) => error instanceof RepoRuleError && error.code === "LENDER_UNFUNDED",
  );
});

test("oracle shock starts a margin call and partial repayment cures it", () => {
  const engine = fund();
  engine.activate();
  for (const line of engine.basket)
    engine.reprice(line.assetId, (engine.assets.find((a) => a.id === line.assetId)!.price * 85n) / 100n, 100);
  assert.equal(engine.state, "MARGIN_CALL");
  engine.partialRepay(250_000n);
  assert.equal(engine.state, "ACTIVE");
});

test("uncured margin call routes collateral to lender-first liquidation", () => {
  const engine = fund();
  const winner = engine.activate();
  for (const line of engine.basket)
    engine.reprice(line.assetId, (engine.assets.find((a) => a.id === line.assetId)!.price * 80n) / 100n, 100);
  const liquidation = engine.expireMargin(engine.marginDeadline!);
  assert.equal(engine.state, "LIQUIDATION");
  assert.equal(liquidation.beneficiaryId, winner.lenderId);
  assert.equal(liquidation.surplusRecipientId, engine.terms.borrowerId);
  assert.ok(liquidation.lenderClaim > engine.outstanding);
});

test("close requires coupon treatment and releases collateral after repurchase", () => {
  const engine = fund();
  engine.activate();
  assert.throws(
    () => engine.close(),
    (error) => error instanceof RepoRuleError && error.code === "COUPON_UNSCHEDULED",
  );
  engine.scheduleCouponEquivalent();
  assert.ok(engine.close() > engine.terms.requiredCash);
  assert.equal(engine.state, "CLOSED");
});

test("substitution cannot reduce maintenance coverage", () => {
  const engine = fund();
  engine.activate();
  const line = engine.basket[0];
  assert.throws(
    () => engine.substitute({ assetId: line.assetId, quantity: line.quantity }, { assetId: "corp-29", quantity: 1 }),
    (error) => error instanceof RepoRuleError && error.code === "SUBSTITUTION_UNDERCOLLATERALIZED",
  );
});

test("arena score rewards efficient funding and a clean close over default", () => {
  const healthy = fund();
  healthy.activate();
  healthy.scheduleCouponEquivalent();
  healthy.close();

  const defaulted = fund();
  defaulted.activate();
  for (const line of defaulted.basket) {
    const asset = defaulted.assets.find((item) => item.id === line.assetId)!;
    defaulted.reprice(line.assetId, (asset.price * 80n) / 100n, 100);
  }
  defaulted.expireMargin(defaulted.marginDeadline!);

  assert.ok(healthy.score().total > defaulted.score().total);
  assert.equal(healthy.score().grade, "S");
});

test("seeded challenges are replayable and difficulty changes risk windows", () => {
  const first = createRepoFixture({ seed: 77, difficulty: "EXPERT" });
  const replay = createRepoFixture({ seed: 77, difficulty: "EXPERT" });
  const different = createRepoFixture({ seed: 78, difficulty: "EXPERT" });

  assert.deepEqual(
    first.assets.map((asset) => asset.price),
    replay.assets.map((asset) => asset.price),
  );
  assert.notDeepEqual(
    first.assets.map((asset) => asset.price),
    different.assets.map((asset) => asset.price),
  );
  assert.ok(challengeRules("EXPERT").marginWindowSeconds < challengeRules("CADET").marginWindowSeconds);
  assert.ok(challengeRules("EXPERT").shockBps > challengeRules("CADET").shockBps);
});

test("assistance and balance-sheet remedies carry visible score costs", () => {
  const manual = createRepoFixture({ seed: 1042 });
  manual.optimizeBasket();
  const assisted = createRepoFixture({ seed: 1042 });
  assisted.optimizeBasket(true);
  assert.equal(manual.score().collateralEfficiency - assisted.score().collateralEfficiency, 60);

  const engine = fund(createRepoFixture({ seed: 1042, difficulty: "PRO" }));
  engine.activate();
  for (const line of engine.basket) {
    const asset = engine.assets.find((item) => item.id === line.assetId)!;
    engine.reprice(line.assetId, (asset.price * 80n) / 100n, 100);
  }
  engine.partialRepay(250_000n);
  assert.equal(engine.score().remedyCapitalUsed, 250_000n);
  assert.ok(engine.score().riskManagement < 250);
});
