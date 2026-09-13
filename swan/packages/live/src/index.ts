// SPDX-License-Identifier: Apache-2.0

import {
  BrowserProvider,
  Contract,
  formatUnits,
  getBytes,
  getAddress,
  id,
  parseUnits,
  type Eip1193Provider,
  type TransactionReceipt,
} from "ethers";

export const HEDERA_TESTNET_CHAIN_ID = 296n;
export const HEDERA_TESTNET_USDC_TOKEN_ID = "0.0.429274";
export const HEDERA_TESTNET_USDC_ADDRESS = "0x0000000000000000000000000000000000068cda";
export const USDC_DECIMALS = 6;

export type LiveAddresses = {
  repoLifecycle: string;
  complianceAuction: string;
  signedPriceOracle: string;
  kycAccessRegistry: string;
  usdc: string;
};

export type KycRequestStatus = "NONE" | "PENDING" | "APPROVED" | "REJECTED";

export type KycRequest = {
  applicant: string;
  submittedAt: number;
  roles: number;
  status: KycRequestStatus;
  fullyKyc: boolean;
};

export type UsdcSnapshot = {
  balance: bigint;
  repoAllowance: bigint;
  auctionAllowance: bigint;
};

export type CollateralInput = {
  security: string;
  quantity: bigint;
  oraclePrice: bigint;
  haircutBps: number;
  maxConcentrationBps: number;
};

export type TransactionEvidence = {
  transactionHash: string;
  blockNumber: number;
  status: "SUCCESS" | "REVERTED";
  hashscanUrl: string;
};

export type CreatedTransactionEvidence = TransactionEvidence & {
  entityId: bigint;
};

export type CreatedManyTransactionEvidence = TransactionEvidence & {
  entityIds: bigint[];
};

const REPO_ABI = [
  "function requestRepo(address cash,uint256 principal,uint256 fundingDeadline,uint256 maturity,uint16 maintenanceBps,(address security,uint256 quantity,uint256 oraclePrice,uint16 haircutBps,uint16 maxConcentrationBps)[] basket) returns (uint256)",
  "function offerFunding(uint256 repoId,uint16 rateBps)",
  "function openRepo(uint256 repoId)",
  "function reclaimUnfundedRepo(uint256 repoId)",
  "function withdrawLosingOffer(uint256 repoId)",
  "function refreshPrice(uint256 repoId,uint256 collateralIndex)",
  "function addCollateral(uint256 repoId,uint256 collateralIndex,uint256 quantity)",
  "function partiallyRepay(uint256 repoId,uint256 amount)",
  "function substituteCollateral(uint256 repoId,uint256 collateralIndex,(address security,uint256 quantity,uint256 oraclePrice,uint16 haircutBps,uint16 maxConcentrationBps) replacement)",
  "function verifyCouponEquivalentSchedule(uint256 repoId,bytes32 scheduleHash)",
  "function authorizeScheduledCaller(uint256 repoId,address scheduledCaller)",
  "function payCouponEquivalent(uint256 repoId,uint256 amount)",
  "function closeRepo(uint256 repoId)",
  "function declareDefault(uint256 repoId)",
  "function createLiquidationAuctions(uint256 repoId,address auction,uint256 biddingDeadline,uint16 sanityToleranceBps) returns (uint256[])",
  "function collateralCount(uint256 repoId) view returns (uint256)",
  "function repos(uint256 repoId) view returns (uint8 state,address borrower,address lender,address cash,uint256 principal,uint256 outstanding,uint256 fundingDeadline,uint256 maturity,uint256 marginDeadline,uint256 openedAt,uint16 maintenanceBps,uint16 winningRateBps,address bestLender,uint16 bestRateBps,bool couponEquivalentScheduled,bytes32 couponScheduleHash,bool couponEquivalentPaid,address scheduledBorrowerCaller,address scheduledLenderCaller)",
  "function collateralCapacity(uint256 repoId) view returns (uint256)",
  "event RepoRequested(uint256 indexed repoId,address indexed borrower,uint256 principal,uint256 capacity)",
  "event LiquidationAuctionCreated(uint256 indexed repoId,uint256 indexed auctionId,uint256 collateralIndex,uint256 lenderClaim)",
];

const AUCTION_ABI = [
  "function createVoluntaryAuction(address security,address cash,uint256 quantity,uint256 reservePrice,uint256 biddingDeadline,uint256 oraclePrice,uint16 sanityToleranceBps) returns (uint256)",
  "function bid(uint256 auctionId,uint256 amount)",
  "function close(uint256 auctionId)",
  "function settle(uint256 auctionId)",
  "function withdrawRefund(uint256 auctionId)",
  "function cancel(uint256 auctionId)",
  "function approveOracleException(uint256 auctionId)",
  "function nextAuctionId() view returns (uint256)",
  "function auctions(uint256 auctionId) view returns (uint8 kind,uint8 state,address security,address cash,address seller,address beneficiary,address surplusRecipient,uint256 lenderClaim,uint256 quantity,uint256 reservePrice,uint256 biddingDeadline,uint256 oraclePrice,uint16 sanityToleranceBps,address highestBidder,uint256 highestBid,bool oracleExceptionApproved)",
  "event AuctionListed(uint256 indexed auctionId,uint8 indexed kind,address indexed seller,address beneficiary,address security,address cash,uint256 quantity,uint256 reservePrice,uint256 biddingDeadline,uint256 oraclePrice)",
];

const ERC20_ABI = [
  "function approve(address spender,uint256 amount) returns (bool)",
  "function allowance(address owner,address spender) view returns (uint256)",
  "function balanceOf(address account) view returns (uint256)",
];

const ORACLE_ABI = [
  "error InvalidPrice()",
  "error StalePrice()",
  "error FuturePrice()",
  "error InvalidNonce()",
  "error InvalidSignature()",
  "error PriceUnavailable()",
  "function nextNonce() view returns (uint256)",
  "function priceSigner() view returns (address)",
  "function securityPayloadHash(address security,uint256 price,uint256 observedAt,uint256 nonce) view returns (bytes32)",
  "function payloadHash(address repo,uint256 repoId,uint256 collateralIndex,uint256 price,uint256 observedAt,uint256 nonce) view returns (bytes32)",
  "function submitSecurityPrice(address security,uint256 price,uint256 observedAt,uint256 nonce,bytes signature)",
  "function submitPrice(address repo,uint256 repoId,uint256 collateralIndex,uint256 price,uint256 observedAt,uint256 nonce,bytes signature)",
];

const KYC_REGISTRY_ABI = [
  "function reviewer() view returns (address)",
  "function requests(address) view returns (address applicant,uint64 submittedAt,uint8 roles,uint8 status)",
  "function isFullyKyc(address applicant) view returns (bool)",
  "function requestAccess(uint8 roles)",
  "function approve(address applicant,string vcId,uint256 validTo)",
  "function reject(address applicant)",
  "function applicantCount() view returns (uint256)",
  "function applicantAt(uint256 index) view returns (address)",
];

const KYC_STATUSES: KycRequestStatus[] = ["NONE", "PENDING", "APPROVED", "REJECTED"];

export class LiveSwanClient {
  readonly repo: Contract;
  readonly auction: Contract;
  readonly oracle: Contract;
  readonly kyc: Contract;

  private constructor(
    readonly provider: BrowserProvider,
    readonly account: string,
    readonly addresses: LiveAddresses,
    signer: Awaited<ReturnType<BrowserProvider["getSigner"]>>,
  ) {
    this.repo = new Contract(addresses.repoLifecycle, REPO_ABI, signer);
    this.auction = new Contract(addresses.complianceAuction, AUCTION_ABI, signer);
    this.oracle = new Contract(addresses.signedPriceOracle, ORACLE_ABI, signer);
    this.kyc = new Contract(addresses.kycAccessRegistry, KYC_REGISTRY_ABI, signer);
  }

  static async connect(injected: Eip1193Provider, addresses: LiveAddresses): Promise<LiveSwanClient> {
    assertOfficialTestnetUsdc(addresses.usdc);
    const provider = new BrowserProvider(injected);
    await provider.send("eth_requestAccounts", []);
    const network = await provider.getNetwork();
    if (network.chainId !== HEDERA_TESTNET_CHAIN_ID) {
      throw new Error(`WRONG_NETWORK: expected Hedera testnet 296, received ${network.chainId}`);
    }
    const signer = await provider.getSigner();
    return new LiveSwanClient(provider, await signer.getAddress(), addresses, signer);
  }

  async approve(token: string, spender: string, amount: bigint): Promise<TransactionEvidence> {
    const signer = await this.provider.getSigner();
    const contract = new Contract(token, ERC20_ABI, signer);
    return evidence(await (await contract.approve(spender, amount)).wait());
  }

  async approveUsdc(spender: string, amount: bigint): Promise<TransactionEvidence> {
    return this.approve(this.addresses.usdc, spender, amount);
  }

  async approveSecurity(token: string, amount: bigint): Promise<TransactionEvidence> {
    return this.approve(token, this.addresses.repoLifecycle, amount);
  }

  async approveSecurityForAuction(token: string, amount: bigint): Promise<TransactionEvidence> {
    return this.approve(token, this.addresses.complianceAuction, amount);
  }

  async securityDecimals(token: string): Promise<number> {
    const contract = new Contract(token, ["function decimals() view returns (uint8)"], this.provider);
    return Number(await contract.decimals());
  }

  async usdcSnapshot(): Promise<UsdcSnapshot> {
    const token = new Contract(this.addresses.usdc, ERC20_ABI, this.provider);
    const [balance, repoAllowance, auctionAllowance] = await Promise.all([
      token.balanceOf(this.account),
      token.allowance(this.account, this.addresses.repoLifecycle),
      token.allowance(this.account, this.addresses.complianceAuction),
    ]);
    return {
      balance: BigInt(balance),
      repoAllowance: BigInt(repoAllowance),
      auctionAllowance: BigInt(auctionAllowance),
    };
  }

  async kycSnapshot(account = this.account): Promise<KycRequest> {
    const [request, fullyKyc] = await Promise.all([this.kyc.requests(account), this.kyc.isFullyKyc(account)]);
    const statusIndex = Number(request.status);
    return {
      applicant: getAddress(account),
      submittedAt: Number(request.submittedAt),
      roles: Number(request.roles),
      status: KYC_STATUSES[statusIndex] ?? "NONE",
      fullyKyc: Boolean(fullyKyc),
    };
  }

  async isKycReviewer(): Promise<boolean> {
    return getAddress(await this.kyc.reviewer()) === getAddress(this.account);
  }

  async requestKyc(roles: 1 | 2 | 3): Promise<TransactionEvidence> {
    return evidence(await (await this.kyc.requestAccess(roles)).wait());
  }

  async signDemoAccess(issuedAt: number): Promise<string> {
    const signer = await this.provider.getSigner();
    return signer.signMessage(demoAccessMessage(this.account, this.addresses.kycAccessRegistry, issuedAt));
  }

  async approveKyc(applicant: string): Promise<TransactionEvidence> {
    const validTo = BigInt(Math.floor(Date.now() / 1_000) + 365 * 24 * 60 * 60);
    const vcId = `swan:${getAddress(applicant).toLowerCase()}:${Date.now()}`;
    return evidence(await (await this.kyc.approve(applicant, vcId, validTo)).wait());
  }

  async rejectKyc(applicant: string): Promise<TransactionEvidence> {
    return evidence(await (await this.kyc.reject(applicant)).wait());
  }

  async kycApplicants(): Promise<KycRequest[]> {
    const count = Number(await this.kyc.applicantCount());
    const applicants = await Promise.all(
      Array.from({ length: count }, (_, index) => this.kyc.applicantAt(BigInt(index))),
    );
    return Promise.all(applicants.map((applicant) => this.kycSnapshot(String(applicant))));
  }

  async publishSecurityPrice(security: string, price: bigint): Promise<TransactionEvidence> {
    const observedAt = await this.latestChainTimestamp();
    const nonce = BigInt(await this.oracle.nextNonce());
    const payloadHash = await this.oracle.securityPayloadHash(security, price, observedAt, nonce);
    const signer = await this.provider.getSigner();
    const expectedSigner = getAddress(await this.oracle.priceSigner());
    if (getAddress(await signer.getAddress()) !== expectedSigner) {
      throw new Error(`PRICE_SIGNER_REQUIRED: switch to ${expectedSigner}`);
    }
    const signature = await signer.signMessage(getBytes(payloadHash));
    return evidence(
      await (await this.oracle.submitSecurityPrice(security, price, observedAt, nonce, signature)).wait(),
    );
  }

  async publishRepoPrice(repoId: bigint, collateralIndex: bigint, price: bigint): Promise<TransactionEvidence> {
    const observedAt = await this.latestChainTimestamp();
    const nonce = BigInt(await this.oracle.nextNonce());
    const payloadHash = await this.oracle.payloadHash(
      this.addresses.repoLifecycle,
      repoId,
      collateralIndex,
      price,
      observedAt,
      nonce,
    );
    const signer = await this.provider.getSigner();
    const expectedSigner = getAddress(await this.oracle.priceSigner());
    if (getAddress(await signer.getAddress()) !== expectedSigner) {
      throw new Error(`PRICE_SIGNER_REQUIRED: switch to ${expectedSigner}`);
    }
    const signature = await signer.signMessage(getBytes(payloadHash));
    return evidence(
      await (
        await this.oracle.submitPrice(
          this.addresses.repoLifecycle,
          repoId,
          collateralIndex,
          price,
          observedAt,
          nonce,
          signature,
        )
      ).wait(),
    );
  }

  async requestRepo(input: {
    principal: bigint;
    fundingDeadline: bigint;
    maturity: bigint;
    maintenanceBps: number;
    basket: CollateralInput[];
  }): Promise<CreatedTransactionEvidence> {
    const tx = await this.repo.requestRepo(
      this.addresses.usdc,
      input.principal,
      input.fundingDeadline,
      input.maturity,
      input.maintenanceBps,
      input.basket,
    );
    const receipt = await tx.wait();
    return { ...evidence(receipt), entityId: eventId(this.repo, receipt, "RepoRequested", "repoId") };
  }

  async offerFunding(repoId: bigint, rateBps: number): Promise<TransactionEvidence> {
    return evidence(await (await this.repo.offerFunding(repoId, rateBps)).wait());
  }

  async openRepo(repoId: bigint): Promise<TransactionEvidence> {
    return evidence(await (await this.repo.openRepo(repoId)).wait());
  }

  async reclaimUnfundedRepo(repoId: bigint): Promise<TransactionEvidence> {
    return evidence(await (await this.repo.reclaimUnfundedRepo(repoId)).wait());
  }

  async withdrawLosingOffer(repoId: bigint): Promise<TransactionEvidence> {
    return evidence(await (await this.repo.withdrawLosingOffer(repoId)).wait());
  }

  async refreshPrice(repoId: bigint, collateralIndex: bigint): Promise<TransactionEvidence> {
    return evidence(await (await this.repo.refreshPrice(repoId, collateralIndex)).wait());
  }

  async addCollateral(repoId: bigint, collateralIndex: bigint, quantity: bigint): Promise<TransactionEvidence> {
    return evidence(await (await this.repo.addCollateral(repoId, collateralIndex, quantity)).wait());
  }

  async partiallyRepay(repoId: bigint, amount: bigint): Promise<TransactionEvidence> {
    return evidence(await (await this.repo.partiallyRepay(repoId, amount)).wait());
  }

  async substituteCollateral(
    repoId: bigint,
    collateralIndex: bigint,
    replacement: CollateralInput,
  ): Promise<TransactionEvidence> {
    return evidence(await (await this.repo.substituteCollateral(repoId, collateralIndex, replacement)).wait());
  }

  async verifyCouponEquivalentSchedule(repoId: bigint, scheduleHash: string): Promise<TransactionEvidence> {
    return evidence(await (await this.repo.verifyCouponEquivalentSchedule(repoId, scheduleHash)).wait());
  }

  async authorizeScheduledCaller(repoId: bigint, scheduledCaller: string): Promise<TransactionEvidence> {
    return evidence(await (await this.repo.authorizeScheduledCaller(repoId, scheduledCaller)).wait());
  }

  async payCouponEquivalent(repoId: bigint, amount: bigint): Promise<TransactionEvidence> {
    return evidence(await (await this.repo.payCouponEquivalent(repoId, amount)).wait());
  }

  async closeRepo(repoId: bigint): Promise<TransactionEvidence> {
    return evidence(await (await this.repo.closeRepo(repoId)).wait());
  }

  async declareDefault(repoId: bigint): Promise<TransactionEvidence> {
    return evidence(await (await this.repo.declareDefault(repoId)).wait());
  }

  async createLiquidationAuctions(
    repoId: bigint,
    biddingDeadline: bigint,
    sanityToleranceBps: number,
  ): Promise<CreatedManyTransactionEvidence> {
    const auctionIdBefore = BigInt(await this.auction.nextAuctionId());
    const collateralCount = BigInt(await this.repo.collateralCount(repoId));
    const receipt = await (
      await this.repo.createLiquidationAuctions(
        repoId,
        this.addresses.complianceAuction,
        biddingDeadline,
        sanityToleranceBps,
      )
    ).wait();
    let entityIds = eventIds(this.repo, receipt, "LiquidationAuctionCreated", "auctionId", false);
    if (entityIds.length === 0) {
      // Hashio occasionally returns a successful top-level receipt without logs
      // produced around nested contract calls. The auction counter still gives a
      // deterministic, on-chain recovery path for this atomic transaction.
      const auctionIdAfter = BigInt(await this.auction.nextAuctionId());
      if (collateralCount === 0n || auctionIdAfter < auctionIdBefore + collateralCount) {
        throw new Error("LIQUIDATIONAUCTIONCREATED_EVENT_MISSING");
      }
      const firstCreatedId = auctionIdAfter - collateralCount;
      entityIds = Array.from({ length: Number(collateralCount) }, (_, index) => firstCreatedId + BigInt(index));
    }
    return {
      ...evidence(receipt),
      entityIds,
    };
  }

  async liquidationAuctionIds(repoId: bigint, attempts = 1): Promise<bigint[]> {
    for (let attempt = 0; attempt < attempts; attempt += 1) {
      const latestBlock = await this.provider.getBlockNumber();
      const fromBlock = Math.max(0, latestBlock - 2_000);
      const filter = this.repo.filters.LiquidationAuctionCreated(repoId);
      const logs = await this.repo.queryFilter(filter, fromBlock, latestBlock);
      const ids = logs.flatMap((log) => {
        if (!("args" in log) || !log.args) return [];
        return [BigInt(log.args.auctionId)];
      });
      if (ids.length > 0) {
        const snapshots = await Promise.all(ids.map((auctionId) => this.auction.auctions(auctionId)));
        return ids.filter((_, index) => Number(snapshots[index].state) === 1 || Number(snapshots[index].state) === 2);
      }
      if (attempt + 1 < attempts) await new Promise((resolve) => setTimeout(resolve, 1_000));
    }
    return [];
  }

  async createVoluntaryAuction(input: {
    security: string;
    quantity: bigint;
    reservePrice: bigint;
    biddingDeadline: bigint;
    oraclePrice: bigint;
    sanityToleranceBps: number;
  }): Promise<CreatedTransactionEvidence> {
    const transaction = await this.auction.createVoluntaryAuction(
      input.security,
      this.addresses.usdc,
      input.quantity,
      input.reservePrice,
      input.biddingDeadline,
      input.oraclePrice,
      input.sanityToleranceBps,
    );
    const receipt = await transaction.wait();
    return { ...evidence(receipt), entityId: eventId(this.auction, receipt, "AuctionListed", "auctionId") };
  }

  async bid(auctionId: bigint, amount: bigint): Promise<TransactionEvidence> {
    return evidence(await (await this.auction.bid(auctionId, amount)).wait());
  }

  async closeAuction(auctionId: bigint): Promise<TransactionEvidence> {
    return evidence(await (await this.auction.close(auctionId)).wait());
  }

  async settleAuction(auctionId: bigint): Promise<TransactionEvidence> {
    return evidence(await (await this.auction.settle(auctionId)).wait());
  }

  async withdrawAuctionRefund(auctionId: bigint): Promise<TransactionEvidence> {
    return evidence(await (await this.auction.withdrawRefund(auctionId)).wait());
  }

  async cancelAuction(auctionId: bigint): Promise<TransactionEvidence> {
    return evidence(await (await this.auction.cancel(auctionId)).wait());
  }

  async approveOracleException(auctionId: bigint): Promise<TransactionEvidence> {
    return evidence(await (await this.auction.approveOracleException(auctionId)).wait());
  }

  async auctionSnapshot(auctionId: bigint) {
    return this.auction.auctions(auctionId);
  }

  async repoSnapshot(repoId: bigint) {
    const [repo, capacity] = await Promise.all([this.repo.repos(repoId), this.repo.collateralCapacity(repoId)]);
    return { repo, capacity: BigInt(capacity) };
  }

  private async latestChainTimestamp(): Promise<bigint> {
    const block = await this.provider.getBlock("latest");
    if (!block) throw new Error("CHAIN_TIME_UNAVAILABLE: could not read Hedera's latest block");
    return BigInt(block.timestamp);
  }
}

export function parseUsdc(value: string): bigint {
  return parseUnits(value, USDC_DECIMALS);
}

export function parseTokenUnits(value: string, decimals: number): bigint {
  return parseUnits(value, decimals);
}

export function hashScheduleId(scheduleId: string): string {
  return id(scheduleId.trim());
}

export function demoAccessMessage(applicant: string, registry: string, issuedAt: number): string {
  return [
    "Swan automated testnet demo access",
    `Chain ID: ${HEDERA_TESTNET_CHAIN_ID}`,
    `Registry: ${getAddress(registry).toLowerCase()}`,
    `Applicant: ${getAddress(applicant).toLowerCase()}`,
    `Issued at: ${issuedAt}`,
  ].join("\n");
}

export function formatUsdc(value: bigint): string {
  return `${formatUnits(value, USDC_DECIMALS)} USDC`;
}

export function assertOfficialTestnetUsdc(address: string): void {
  if (getAddress(address) !== getAddress(HEDERA_TESTNET_USDC_ADDRESS)) {
    throw new Error(`INVALID_USDC_ADDRESS: expected native testnet USDC ${HEDERA_TESTNET_USDC_ADDRESS}`);
  }
}

export type MirrorContractResult = {
  hash: string;
  transactionId: string | null;
  consensusTimestamp: string | null;
  result: string;
  errorMessage: string | null;
};

export class MirrorEvidenceClient {
  constructor(
    readonly baseUrl = "https://testnet.mirrornode.hedera.com/api/v1",
    private readonly fetcher: typeof fetch = fetch,
  ) {}

  async contractResult(transactionHash: string): Promise<MirrorContractResult | null> {
    const response = await this.fetcher(`${this.baseUrl}/contracts/results/${transactionHash}`);
    if (response.status === 404) return null;
    if (!response.ok) throw new Error(`MIRROR_NODE_${response.status}`);
    const body = (await response.json()) as Record<string, unknown>;
    return {
      hash: String(body.hash ?? transactionHash),
      transactionId: typeof body.transaction_id === "string" ? body.transaction_id : null,
      consensusTimestamp: typeof body.timestamp === "string" ? body.timestamp : null,
      result: String(body.result ?? "UNKNOWN"),
      errorMessage: typeof body.error_message === "string" && body.error_message ? body.error_message : null,
    };
  }

  async schedule(scheduleId: string): Promise<Record<string, unknown> | null> {
    const response = await this.fetcher(`${this.baseUrl}/schedules/${scheduleId}`);
    if (response.status === 404) return null;
    if (!response.ok) throw new Error(`MIRROR_NODE_${response.status}`);
    return (await response.json()) as Record<string, unknown>;
  }
}

function evidence(receipt: TransactionReceipt | null): TransactionEvidence {
  if (!receipt) throw new Error("TRANSACTION_DROPPED");
  return {
    transactionHash: receipt.hash,
    blockNumber: receipt.blockNumber,
    status: receipt.status === 1 ? "SUCCESS" : "REVERTED",
    hashscanUrl: `https://hashscan.io/testnet/transaction/${receipt.hash}`,
  };
}

function eventId(
  contract: Contract,
  receipt: TransactionReceipt | null,
  eventName: string,
  argumentName: string,
): bigint {
  if (!receipt) throw new Error("TRANSACTION_DROPPED");
  for (const log of receipt.logs) {
    try {
      const parsed = contract.interface.parseLog(log);
      if (parsed?.name === eventName) return BigInt(parsed.args[argumentName]);
    } catch {
      // Ignore logs emitted by other contracts in the same transaction.
    }
  }
  throw new Error(`${eventName.toUpperCase()}_EVENT_MISSING`);
}

function eventIds(
  contract: Contract,
  receipt: TransactionReceipt | null,
  eventName: string,
  argumentName: string,
  required = true,
): bigint[] {
  if (!receipt) throw new Error("TRANSACTION_DROPPED");
  const ids: bigint[] = [];
  for (const log of receipt.logs) {
    try {
      const parsed = contract.interface.parseLog(log);
      if (parsed?.name === eventName) ids.push(BigInt(parsed.args[argumentName]));
    } catch {
      // Ignore logs emitted by other contracts in the same transaction.
    }
  }
  if (required && ids.length === 0) throw new Error(`${eventName.toUpperCase()}_EVENT_MISSING`);
  return ids;
}
