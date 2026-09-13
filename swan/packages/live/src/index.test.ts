// SPDX-License-Identifier: Apache-2.0

import assert from "node:assert/strict";
import test from "node:test";
import {
  HEDERA_TESTNET_USDC_ADDRESS,
  MirrorEvidenceClient,
  assertOfficialTestnetUsdc,
  formatUsdc,
  parseUsdc,
} from "./index.js";

test("uses six-decimal native Hedera testnet USDC amounts", () => {
  assert.equal(parseUsdc("10"), 10_000_000n);
  assert.equal(parseUsdc("0.25"), 250_000n);
  assert.equal(formatUsdc(10_250_000n), "10.25 USDC");
});

test("pins live cash settlement to official Hedera testnet USDC", () => {
  assert.doesNotThrow(() => assertOfficialTestnetUsdc(HEDERA_TESTNET_USDC_ADDRESS));
  assert.throws(() => assertOfficialTestnetUsdc("0x0000000000000000000000000000000000000001"), /INVALID_USDC_ADDRESS/);
});

test("reads a Hedera contract result by Ethereum transaction hash", async () => {
  const calls: string[] = [];
  const client = new MirrorEvidenceClient("https://mirror.test/api/v1", async (input) => {
    calls.push(String(input));
    return new Response(
      JSON.stringify({ hash: "0xabc", transaction_id: "0.0.100@1.2", timestamp: "1.2", result: "SUCCESS" }),
      {
        status: 200,
        headers: { "content-type": "application/json" },
      },
    );
  });
  const result = await client.contractResult("0xabc");
  assert.equal(calls[0], "https://mirror.test/api/v1/contracts/results/0xabc");
  assert.equal(result?.transactionId, "0.0.100@1.2");
  assert.equal(result?.result, "SUCCESS");
});

test("treats not-yet-indexed transaction and schedule evidence as pending", async () => {
  const client = new MirrorEvidenceClient(
    "https://mirror.test/api/v1",
    async () => new Response(null, { status: 404 }),
  );
  assert.equal(await client.contractResult("0xpending"), null);
  assert.equal(await client.schedule("0.0.123"), null);
});
