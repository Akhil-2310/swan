// SPDX-License-Identifier: Apache-2.0

import { Contract, JsonRpcProvider, Wallet, getAddress, verifyMessage } from "ethers";

const CHAIN_ID = 296n;
const DEFAULT_RPC_URL = "https://testnet.hashio.io/api";
const DEFAULT_REGISTRY = "0xE11f893483E85c93900925c63036db827FEf5fdE";
const MAX_SIGNATURE_AGE_SECONDS = 5 * 60;
const DEMO_KYC_VALIDITY_SECONDS = 7 * 24 * 60 * 60;
const REGISTRY_ABI = [
  "function reviewer() view returns (address)",
  "function requests(address) view returns (address applicant,uint64 submittedAt,uint8 roles,uint8 status)",
  "function isFullyKyc(address applicant) view returns (bool)",
  "function approve(address applicant,string vcId,uint256 validTo)",
];

export const maxDuration = 30;

export function demoAccessMessage(applicant, registry, issuedAt) {
  return [
    "Swan automated testnet demo access",
    `Chain ID: ${CHAIN_ID}`,
    `Registry: ${getAddress(registry).toLowerCase()}`,
    `Applicant: ${getAddress(applicant).toLowerCase()}`,
    `Issued at: ${issuedAt}`,
  ].join("\n");
}

function json(body, status = 200) {
  return Response.json(body, {
    status,
    headers: {
      "cache-control": "no-store",
      "x-content-type-options": "nosniff",
    },
  });
}

function reviewerKey() {
  const raw = process.env.KYC_REVIEWER_PRIVATE_KEY?.trim();
  if (!raw) return undefined;
  return raw.startsWith("0x") ? raw : `0x${raw}`;
}

export default {
  async fetch(request) {
    if (request.method === "GET") {
      return json({
        enabled: process.env.SWAN_AUTO_KYC_ENABLED === "true",
        chainId: Number(CHAIN_ID),
        registry: getAddress(process.env.KYC_ACCESS_REGISTRY_ADDRESS || DEFAULT_REGISTRY),
      });
    }
    if (request.method !== "POST") return json({ error: "METHOD_NOT_ALLOWED" }, 405);
    if (process.env.SWAN_AUTO_KYC_ENABLED !== "true") {
      return json({ error: "AUTOMATED_DEMO_KYC_DISABLED" }, 503);
    }

    const allowedOrigin = process.env.SWAN_APP_ORIGIN?.replace(/\/$/, "");
    const requestOrigin = request.headers.get("origin")?.replace(/\/$/, "");
    if (allowedOrigin && requestOrigin !== allowedOrigin) return json({ error: "ORIGIN_NOT_ALLOWED" }, 403);

    const privateKey = reviewerKey();
    if (!privateKey) return json({ error: "REVIEWER_NOT_CONFIGURED" }, 503);

    let body;
    try {
      body = await request.json();
    } catch {
      return json({ error: "INVALID_JSON" }, 400);
    }

    let applicant;
    const issuedAt = Number(body?.issuedAt);
    const signature = typeof body?.signature === "string" ? body.signature : "";
    try {
      applicant = getAddress(String(body?.applicant || ""));
    } catch {
      return json({ error: "INVALID_APPLICANT" }, 400);
    }
    const now = Math.floor(Date.now() / 1_000);
    if (!Number.isSafeInteger(issuedAt) || Math.abs(now - issuedAt) > MAX_SIGNATURE_AGE_SECONDS) {
      return json({ error: "EXPIRED_ACCESS_SIGNATURE" }, 400);
    }

    const registryAddress = getAddress(process.env.KYC_ACCESS_REGISTRY_ADDRESS || DEFAULT_REGISTRY);
    let recovered;
    try {
      recovered = getAddress(verifyMessage(demoAccessMessage(applicant, registryAddress, issuedAt), signature));
    } catch {
      return json({ error: "INVALID_ACCESS_SIGNATURE" }, 401);
    }
    if (recovered !== applicant) return json({ error: "APPLICANT_SIGNATURE_REQUIRED" }, 401);

    try {
      const provider = new JsonRpcProvider(process.env.HEDERA_TESTNET_RPC_URL || DEFAULT_RPC_URL, Number(CHAIN_ID));
      const network = await provider.getNetwork();
      if (network.chainId !== CHAIN_ID) return json({ error: "WRONG_NETWORK" }, 503);

      const signer = new Wallet(privateKey, provider);
      const registry = new Contract(registryAddress, REGISTRY_ABI, signer);
      const [configuredReviewer, accessRequest, fullyKyc, latestBlock] = await Promise.all([
        registry.reviewer(),
        registry.requests(applicant),
        registry.isFullyKyc(applicant),
        provider.getBlock("latest"),
      ]);
      if (getAddress(configuredReviewer) !== getAddress(signer.address)) {
        return json({ error: "REVIEWER_KEY_DOES_NOT_MATCH_REGISTRY" }, 503);
      }
      if (fullyKyc) return json({ approved: true, alreadyApproved: true, applicant });
      if (Number(accessRequest.status) !== 1 || Number(accessRequest.roles) < 1 || Number(accessRequest.roles) > 3) {
        return json({ error: "PENDING_ONCHAIN_REQUEST_REQUIRED" }, 409);
      }
      if (!latestBlock) return json({ error: "CHAIN_TIME_UNAVAILABLE" }, 503);

      const validTo = BigInt(latestBlock.timestamp + DEMO_KYC_VALIDITY_SECONDS);
      const vcId = `swan-testnet-demo:${applicant.toLowerCase()}:${issuedAt}`;
      const transaction = await registry.approve(applicant, vcId, validTo);
      const receipt = await transaction.wait();
      if (!receipt || receipt.status !== 1) return json({ error: "APPROVAL_TRANSACTION_REVERTED" }, 502);

      return json({
        approved: true,
        applicant,
        validTo: validTo.toString(),
        transactionHash: receipt.hash,
        hashscanUrl: `https://hashscan.io/testnet/transaction/${receipt.hash}`,
      });
    } catch (error) {
      console.error("Automated demo KYC failed", error instanceof Error ? error.message : error);
      return json({ error: "AUTOMATED_DEMO_KYC_FAILED" }, 502);
    }
  },
};
