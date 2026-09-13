// SPDX-License-Identifier: Apache-2.0

const path = require("node:path");
const fs = require("node:fs");
const dotenv = require("dotenv");
const { ethers } = require("ethers");

dotenv.config({ path: path.resolve(__dirname, "../contracts/.env") });

// The ATS MetaMask adapter can be driven by a private-key signer in automation.
// It only registers that adapter in a browser-like runtime.
global.window = {};

const ats = require("../../packages/ats/sdk/build/cjs/src/index.js");
const Injectable = require("../../packages/ats/sdk/build/cjs/src/core/injectable/Injectable.js").default;
const { RPCTransactionAdapter } = require("../../packages/ats/sdk/build/cjs/src/port/out/rpc/RPCTransactionAdapter.js");
const { RPCQueryAdapter } = require("../../packages/ats/sdk/build/cjs/src/port/out/rpc/RPCQueryAdapter.js");
const { MirrorNodeAdapter } = require("../../packages/ats/sdk/build/cjs/src/port/out/mirror/MirrorNodeAdapter.js");
const NetworkService = require("../../packages/ats/sdk/build/cjs/src/app/service/network/NetworkService.js").default;
const { SecurityRole } = require("../../packages/ats/sdk/build/cjs/src/domain/context/security/SecurityRole.js");
const { createEcdsaCredential, EthrDID } = require("@terminal3/ecdsa_vc");
const { DID } = require("@terminal3/vc_core");

const {
  AddIssuerRequest,
  Bond,
  ConnectRequest,
  CreateBondRequest,
  GetAccountBalanceRequest,
  GetKycStatusForRequest,
  GrantKycRequest,
  InitializationRequest,
  IsIssuerRequest,
  IssueRequest,
  Kyc,
  Management,
  Network,
  ResolveLatestConfigVersionRequest,
  Role,
  RoleRequest,
  Security,
  SsiManagement,
  SupportedWallets,
} = ats;

const RPC_URL = process.env.HEDERA_TESTNET_RPC_URL || "https://testnet.hashio.io/api";
const MIRROR_URL = "https://testnet.mirrornode.hedera.com/api/v1/";
const RESOLVER = process.env.ATS_RESOLVER_ID || "0.0.9212226";
const FACTORY = process.env.ATS_FACTORY_ID || "0.0.9213391";
const BOND_CONFIG_ID =
  process.env.ATS_BOND_CONFIG_ID || "0x0000000000000000000000000000000000000000000000000000000000000002";
const DEPLOYMENT_PATH = path.resolve(__dirname, "../deployments/hedera-testnet.json");
const BONDS = [
  {
    id: "ust-28",
    name: "U.S. Treasury Note 4.25%",
    symbol: "USTB-28",
    isin: "XS0000USTB21",
    maturityYears: 2,
    nominalValue: "1",
    unitPriceUsdc: "1.00",
    stormPriceUsdc: "0.68",
    haircutBps: 200,
    maxConcentrationBps: 7000,
    demoQuantity: "1",
  },
  {
    id: "green-30",
    name: "Sovereign Green Bond 3.80%",
    symbol: "GRNB-30",
    isin: "XS0000GRNB34",
    maturityYears: 4,
    nominalValue: "1",
    unitPriceUsdc: "0.98",
    stormPriceUsdc: "0.66",
    haircutBps: 800,
    maxConcentrationBps: 6000,
    demoQuantity: "1",
  },
  {
    id: "muni-31",
    name: "Metro Infrastructure 5.10%",
    symbol: "MUNI-31",
    isin: "XS0000MUNI34",
    maturityYears: 5,
    nominalValue: "1",
    unitPriceUsdc: "0.95",
    stormPriceUsdc: "0.64",
    haircutBps: 1500,
    maxConcentrationBps: 5500,
    demoQuantity: "1",
  },
  {
    id: "corp-29",
    name: "Northstar Senior Note 5.65%",
    symbol: "NSCR-29",
    isin: "XS0000NSCR21",
    maturityYears: 3,
    nominalValue: "1",
    unitPriceUsdc: "1.02",
    stormPriceUsdc: "0.62",
    haircutBps: 2000,
    maxConcentrationBps: 4500,
    demoQuantity: "1",
  },
];

function required(name) {
  const value = process.env[name];
  if (!value) throw new Error(`${name} is required`);
  return value;
}

async function setupSdk(privateKey, accountId) {
  const mirrorNode = { name: "hedera-testnet", baseUrl: MIRROR_URL };
  const rpcNode = { name: "hashio-testnet", baseUrl: RPC_URL };
  const mirror = Injectable.resolve(MirrorNodeAdapter);
  const transactionAdapter = Injectable.resolve(RPCTransactionAdapter);
  const queryAdapter = Injectable.resolve(RPCQueryAdapter);
  const network = Injectable.resolve(NetworkService);
  const wallet = new ethers.Wallet(privateKey, new ethers.JsonRpcProvider(RPC_URL));

  mirror.set(mirrorNode);
  network.environment = "testnet";
  network.configuration = { factoryAddress: FACTORY, resolverAddress: RESOLVER };
  network.mirrorNode = mirrorNode;
  network.rpcNode = rpcNode;
  queryAdapter.init();
  await transactionAdapter.init(true);
  transactionAdapter.setSignerOrProvider(wallet);

  await Network.connect(
    new ConnectRequest({
      account: {
        accountId,
        evmAddress: wallet.address,
        privateKey: { key: privateKey.replace(/^0x/, ""), type: "ECDSA" },
      },
      network: "testnet",
      mirrorNode,
      rpcNode,
      wallet: SupportedWallets.METAMASK,
      debug: true,
    }),
  );
  Injectable.resolveTransactionHandler();
  return wallet;
}

async function resolveConfigVersion() {
  return (
    await Management.resolveLatestConfigVersion(
      new ResolveLatestConfigVersionRequest({
        resolverAddress: RESOLVER,
        configurationId: BOND_CONFIG_ID,
      }),
    )
  ).payload;
}

async function createBond(wallet, accountId, definition) {
  const now = Math.floor(Date.now() / 1_000);
  const configVersion = await resolveConfigVersion();
  const response = await Bond.create(
    new CreateBondRequest({
      name: definition.name,
      symbol: definition.symbol,
      isin: definition.isin,
      decimals: 0,
      isWhiteList: false,
      erc20VotesActivated: false,
      isControllable: true,
      arePartitionsProtected: false,
      isMultiPartition: false,
      clearingActive: false,
      internalKycActivated: true,
      diamondOwnerAccount: accountId,
      currency: "0x555344",
      numberOfUnits: "1000",
      nominalValue: definition.nominalValue,
      nominalValueDecimals: 0,
      startingDate: String(now + 600),
      maturityDate: String(now + definition.maturityYears * 365 * 24 * 60 * 60),
      regulationType: 1,
      regulationSubType: 0,
      isCountryControlListWhiteList: false,
      countries: "KP,IR",
      info: `${definition.symbol} Swan ATS collateral and repo arena demo bond`,
      configId: BOND_CONFIG_ID,
      configVersion,
    }),
  );
  const securityAddress = response.security.evmDiamondAddress?.toString();
  if (!securityAddress) throw new Error("ATS creation did not return an EVM security address");
  console.log(
    JSON.stringify({
      step: "bond-created",
      symbol: definition.symbol,
      securityAddress,
      transactionId: response.transactionId,
    }),
  );
  return { securityAddress, transactionId: response.transactionId };
}

function loadDeployment() {
  return JSON.parse(fs.readFileSync(DEPLOYMENT_PATH, "utf8"));
}

function saveBondDeployment(definition, securityAddress, transactionId) {
  const deployment = loadDeployment();
  const existing = deployment.contracts.atsBonds || [];
  const previous = existing.find((item) => item.id === definition.id);
  const record = {
    id: definition.id,
    name: definition.name,
    symbol: definition.symbol,
    isin: definition.isin,
    contractId: previous?.contractId || null,
    evmAddress: securityAddress,
    transactionHash: transactionId || previous?.transactionHash || previous?.transactionId || null,
    consensusTimestamp: previous?.consensusTimestamp || null,
    decimals: 0,
    unitPriceUsdc: definition.unitPriceUsdc,
    stormPriceUsdc: definition.stormPriceUsdc,
    haircutBps: definition.haircutBps,
    maxConcentrationBps: definition.maxConcentrationBps,
    demoQuantity: definition.demoQuantity,
  };
  deployment.contracts.atsBonds = [...existing.filter((item) => item.id !== definition.id), record].sort(
    (left, right) => BONDS.findIndex((item) => item.id === left.id) - BONDS.findIndex((item) => item.id === right.id),
  );
  deployment.multiBondSeededAt = new Date().toISOString();
  fs.writeFileSync(DEPLOYMENT_PATH, `${JSON.stringify(deployment, null, 2)}\n`);
}

async function ensureRole(securityAddress, target, role) {
  const request = new RoleRequest({ securityId: securityAddress, targetId: target, role });
  if (await Role.hasRole(request)) return;
  await Role.grantRole(request);
}

async function createVc(privateKey, holderAddress) {
  const issuer = new EthrDID(privateKey.replace(/^0x/, ""), "polygon");
  const holder = new DID("ethr", holderAddress);
  const credential = await createEcdsaCredential(
    issuer,
    holder,
    { kyc: "passed", purpose: "Swan testnet demo" },
    ["KycCredential"],
    undefined,
    undefined,
    {
      revocationRegistryAddress: "0x77Fb69B24e4C659CE03fB129c19Ad591374C349e",
      didRegistryAddress: "0x312C15922c22B60f5557bAa1A85F2CdA4891C39a",
      provider: new ethers.JsonRpcProvider(RPC_URL),
    },
  );
  return Buffer.from(JSON.stringify(credential)).toString("base64");
}

async function ensureKyc(securityAddress, privateKey, target) {
  const status = await Kyc.getKycStatusFor(
    new GetKycStatusForRequest({ securityId: securityAddress, targetId: target }),
  );
  if (status === 1) return;
  await Kyc.grantKyc(
    new GrantKycRequest({
      securityId: securityAddress,
      targetId: target,
      vcBase64: await createVc(privateKey, target),
    }),
  );
}

async function main() {
  const privateKey = required("DEPLOYER_PRIVATE_KEY");
  const accountId = process.env.ATS_OPERATOR_ID || "0.0.10499008";
  const repo = required("REPO_CONTRACT_ADDRESS");
  const auction = required("AUCTION_CONTRACT_ADDRESS");
  const wallet = await setupSdk(privateKey, accountId);
  const kycRegistry = loadDeployment().contracts.kycAccessRegistry?.evmAddress;
  const participants = (process.env.ATS_PARTICIPANT_ADDRESSES || "")
    .split(",")
    .map((address) => address.trim())
    .filter(Boolean)
    .map((address) => ethers.getAddress(address));
  const deployedById = new Map((loadDeployment().contracts.atsBonds || []).map((item) => [item.id, item]));
  const readyBonds = [];

  for (const definition of BONDS) {
    const envName = `ATS_${definition.symbol.replace(/-/g, "_")}_ADDRESS`;
    let securityAddress = process.env[envName] || deployedById.get(definition.id)?.evmAddress;
    let transactionId;
    if (!securityAddress) {
      const created = await createBond(wallet, accountId, definition);
      securityAddress = created.securityAddress;
      transactionId = created.transactionId;
      saveBondDeployment(definition, securityAddress, transactionId);
    }

    for (const role of [SecurityRole._ISSUER_ROLE, SecurityRole._SSI_MANAGER_ROLE, SecurityRole._KYC_ROLE]) {
      await ensureRole(securityAddress, wallet.address, role);
    }
    if (kycRegistry) await ensureRole(securityAddress, kycRegistry, SecurityRole._KYC_ROLE);
    const issuerRequest = new IsIssuerRequest({ securityId: securityAddress, issuerId: wallet.address });
    if (!(await SsiManagement.isIssuer(issuerRequest))) {
      await SsiManagement.addIssuer(new AddIssuerRequest({ securityId: securityAddress, issuerId: wallet.address }));
    }
    for (const target of [wallet.address, repo, auction, ...participants]) {
      await ensureKyc(securityAddress, privateKey, target);
    }

    const currentBalance = await Security.getBalanceOf(
      new GetAccountBalanceRequest({ securityId: securityAddress, targetId: wallet.address }),
    );
    if (Number(currentBalance.value) < 20) {
      await Security.issue(new IssueRequest({ securityId: securityAddress, targetId: wallet.address, amount: "20" }));
    }
    saveBondDeployment(definition, securityAddress, transactionId);
    readyBonds.push({ ...definition, securityAddress, decimals: 0 });
    console.log(JSON.stringify({ step: "bond-ready", symbol: definition.symbol, securityAddress }));
  }

  console.log(
    JSON.stringify(
      {
        ready: true,
        bonds: readyBonds,
        holder: wallet.address,
        repoEscrow: repo,
        auctionEscrow: auction,
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
