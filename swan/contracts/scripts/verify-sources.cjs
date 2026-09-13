// SPDX-License-Identifier: Apache-2.0

const fs = require("node:fs");
const path = require("node:path");

const CHAIN_ID = "296";
const SOURCIFY = "https://sourcify.dev/server";
const contractsRoot = path.resolve(__dirname, "..");
const deploymentPath = path.resolve(contractsRoot, "../deployments/hedera-testnet.json");

const targets = [
  {
    key: "signedPriceOracle",
    artifact: "artifacts/src/SignedPriceOracle.sol/SignedPriceOracle.dbg.json",
    identifier: "src/SignedPriceOracle.sol:SignedPriceOracle",
  },
  {
    key: "repoLifecycle",
    artifact: "artifacts/src/RepoLifecycle.sol/RepoLifecycle.dbg.json",
    identifier: "src/RepoLifecycle.sol:RepoLifecycle",
  },
  {
    key: "complianceAuction",
    artifact: "artifacts/src/ComplianceAuction.sol/ComplianceAuction.dbg.json",
    identifier: "src/ComplianceAuction.sol:ComplianceAuction",
  },
  {
    key: "kycAccessRegistry",
    artifact: "artifacts/src/KycAccessRegistry.sol/KycAccessRegistry.dbg.json",
    identifier: "src/KycAccessRegistry.sol:KycAccessRegistry",
  },
];

function readJson(filePath) {
  return JSON.parse(fs.readFileSync(filePath, "utf8"));
}

function buildInfoFor(relativeDebugArtifact) {
  const debugPath = path.resolve(contractsRoot, relativeDebugArtifact);
  const debug = readJson(debugPath);
  return readJson(path.resolve(path.dirname(debugPath), debug.buildInfo));
}

async function jsonResponse(response) {
  const text = await response.text();
  try {
    return JSON.parse(text);
  } catch {
    return { message: text };
  }
}

async function lookup(address) {
  const response = await fetch(`${SOURCIFY}/v2/contract/${CHAIN_ID}/${address}`);
  if (response.status === 404) return null;
  const body = await jsonResponse(response);
  if (!response.ok) throw new Error(`Sourcify lookup failed (${response.status}): ${JSON.stringify(body)}`);
  return body;
}

async function waitForVerification(verificationId) {
  for (let attempt = 0; attempt < 60; attempt += 1) {
    const response = await fetch(`${SOURCIFY}/v2/verify/${verificationId}`);
    const body = await jsonResponse(response);
    if (!response.ok) throw new Error(`Sourcify job lookup failed (${response.status}): ${JSON.stringify(body)}`);
    if (body.isJobCompleted || body.status === "success" || body.status === "failed") return body;
    await new Promise((resolve) => setTimeout(resolve, 1_000));
  }
  throw new Error(`Sourcify verification ${verificationId} did not finish within 60 seconds`);
}

async function verify(target, deployed) {
  const existing = await lookup(deployed.evmAddress);
  if (existing?.runtimeMatch) {
    return {
      contract: target.key,
      address: deployed.evmAddress,
      result: "already_verified",
      match: existing.match,
      runtimeMatch: existing.runtimeMatch,
      verifiedAt: existing.verifiedAt,
    };
  }

  const buildInfo = buildInfoFor(target.artifact);
  const response = await fetch(`${SOURCIFY}/v2/verify/${CHAIN_ID}/${deployed.evmAddress}`, {
    method: "POST",
    headers: { "content-type": "application/json" },
    body: JSON.stringify({
      stdJsonInput: buildInfo.input,
      compilerVersion: buildInfo.solcLongVersion,
      contractIdentifier: target.identifier,
      creationTransactionHash: deployed.transactionHash,
    }),
  });
  const submitted = await jsonResponse(response);
  if (!response.ok && response.status !== 409) {
    throw new Error(`${target.key} submission failed (${response.status}): ${JSON.stringify(submitted)}`);
  }

  if (submitted.verificationId) await waitForVerification(submitted.verificationId);
  const verified = await lookup(deployed.evmAddress);
  if (!verified?.runtimeMatch) throw new Error(`${target.key} did not produce a verified runtime match`);
  return {
    contract: target.key,
    address: deployed.evmAddress,
    result: "verified",
    match: verified.match,
    runtimeMatch: verified.runtimeMatch,
    verifiedAt: verified.verifiedAt,
  };
}

async function main() {
  const deployment = readJson(deploymentPath);
  const results = [];
  for (const target of targets) {
    const deployed = deployment.contracts[target.key];
    if (!deployed?.evmAddress || !deployed?.transactionHash) {
      throw new Error(`Deployment manifest is missing ${target.key}`);
    }
    results.push(await verify(target, deployed));
  }
  console.log(JSON.stringify({ verified: true, chainId: Number(CHAIN_ID), results }, null, 2));
}

main().catch((error) => {
  console.error(error instanceof Error ? error.message : error);
  process.exitCode = 1;
});
