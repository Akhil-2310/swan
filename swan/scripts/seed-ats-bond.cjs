// SPDX-License-Identifier: Apache-2.0

const path = require("node:path");
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

async function createBond(wallet, accountId) {
  const now = Math.floor(Date.now() / 1_000);
  const configVersion = await resolveConfigVersion();
  const response = await Bond.create(
    new CreateBondRequest({
      name: "Swan Treasury 2027",
      symbol: "SWAN27",
      isin: "XS0000SWAN18",
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
      nominalValue: "6",
      nominalValueDecimals: 0,
      startingDate: String(now + 600),
      maturityDate: String(now + 365 * 24 * 60 * 60),
      regulationType: 1,
      regulationSubType: 0,
      isCountryControlListWhiteList: false,
      countries: "KP,IR",
      info: "Swan ATS collateral and repo arena demo bond",
      configId: BOND_CONFIG_ID,
      configVersion,
    }),
  );
  const securityAddress = response.security.evmDiamondAddress?.toString();
  if (!securityAddress) throw new Error("ATS creation did not return an EVM security address");
  console.log(JSON.stringify({ step: "bond-created", securityAddress, transactionId: response.transactionId }));
  return securityAddress;
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
  const securityAddress = process.env.ATS_SECURITY_ADDRESS || (await createBond(wallet, accountId));

  for (const role of [SecurityRole._ISSUER_ROLE, SecurityRole._SSI_MANAGER_ROLE, SecurityRole._KYC_ROLE]) {
    await ensureRole(securityAddress, wallet.address, role);
  }
  const issuerRequest = new IsIssuerRequest({ securityId: securityAddress, issuerId: wallet.address });
  if (!(await SsiManagement.isIssuer(issuerRequest))) {
    await SsiManagement.addIssuer(new AddIssuerRequest({ securityId: securityAddress, issuerId: wallet.address }));
  }
  for (const target of [wallet.address, repo, auction]) {
    await ensureKyc(securityAddress, privateKey, target);
  }

  const currentBalance = await Security.getBalanceOf(
    new GetAccountBalanceRequest({ securityId: securityAddress, targetId: wallet.address }),
  );
  if (Number(currentBalance.value) < 20) {
    await Security.issue(new IssueRequest({ securityId: securityAddress, targetId: wallet.address, amount: "20" }));
  }

  console.log(
    JSON.stringify(
      {
        ready: true,
        securityAddress,
        decimals: 0,
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
