// SPDX-License-Identifier: Apache-2.0

import assert from "node:assert/strict";
import test from "node:test";
import { AtsKycStatus, type AtsSecurityReader, checkBidderEligibility, checkListingEligibility } from "./index.js";

function reader(overrides: Partial<AtsSecurityReader> = {}): AtsSecurityReader {
  return {
    paused: async () => false,
    isFrozen: async () => false,
    getKycStatusFor: async () => AtsKycStatus.Granted,
    balanceOf: async () => 100n,
    canTransferFrom: async () => ({ allowed: true, status: "0x51", reason: "OK" }),
    ...overrides,
  };
}

test("listing eligibility explains an insufficient ATS balance", async () => {
  const result = await checkListingEligibility(reader({ balanceOf: async () => 9n }), {
    securityId: "0.0.1001",
    sellerId: "0.0.2001",
    auctionEscrowId: "0.0.3001",
    quantity: 10n,
  });

  assert.equal(result.eligible, false);
  assert.equal(result.reason, "Available 9 / required 10");
  assert.equal(result.checks.find((check) => check.code === "BALANCE_AVAILABLE")?.passed, false);
});

test("a bidder without ATS KYC is rejected for the right reason", async () => {
  const result = await checkBidderEligibility(reader({ getKycStatusFor: async () => AtsKycStatus.NotGranted }), {
    securityId: "0.0.1001",
    escrowId: "0.0.3001",
    bidderId: "0.0.2002",
    quantity: 10n,
  });

  assert.equal(result.eligible, false);
  assert.equal(result.reason, "Bidder KYC is not granted");
});

test("a fully compliant bidder passes every ATS preflight", async () => {
  const result = await checkBidderEligibility(reader(), {
    securityId: "0.0.1001",
    escrowId: "0.0.3001",
    bidderId: "0.0.2003",
    quantity: 10n,
  });

  assert.equal(result.eligible, true);
  assert.equal(result.reason, null);
  assert.ok(result.checks.every((check) => check.passed));
});
