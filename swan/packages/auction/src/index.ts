// SPDX-License-Identifier: Apache-2.0

export type AuctionKind = "VOLUNTARY" | "LIQUIDATION";
export type AuctionState = "OPEN" | "CLOSED" | "SETTLED" | "CANCELLED" | "FAILED_NO_VALID_BID";

export interface MarketAccount {
  id: string;
  label: string;
  kyc: boolean;
  frozen: boolean;
  securityBalance: bigint;
  cashBalance: bigint;
  committedCash: bigint;
}

export interface AssetControlState {
  id: string;
  symbol: string;
  paused: boolean;
}

export interface AuctionBid {
  bidderId: string;
  amount: bigint;
  placedAt: number;
}

export type MarketEventType =
  | "LISTED"
  | "BID_REJECTED"
  | "BID_FUNDED"
  | "CLOSED"
  | "ORACLE_REVIEWED"
  | "REFUND_RELEASED"
  | "SETTLED"
  | "CANCELLED"
  | "FAILED_NO_VALID_BID";

export interface MarketEvent {
  sequence: number;
  type: MarketEventType;
  actorId: string;
  at: number;
  detail: string;
  evidenceId: string;
}

export interface ComplianceAuction {
  id: string;
  kind: AuctionKind;
  sellerId: string;
  beneficiaryId: string;
  surplusRecipientId: string;
  lenderClaim: bigint;
  quantity: bigint;
  reservePrice: bigint;
  deadline: number;
  oraclePrice: bigint;
  sanityToleranceBps: number;
  oracleExceptionApproved: boolean;
  state: AuctionState;
  bids: AuctionBid[];
  winnerId: string | null;
  winningBid: bigint | null;
  events: MarketEvent[];
}

export interface CreateAuctionInput {
  kind: AuctionKind;
  sellerId: string;
  beneficiaryId?: string;
  surplusRecipientId?: string;
  lenderClaim?: bigint;
  quantity: bigint;
  reservePrice: bigint;
  deadline: number;
  oraclePrice: bigint;
  sanityToleranceBps?: number;
}

export class AuctionRuleError extends Error {
  constructor(
    public readonly code: string,
    message: string,
  ) {
    super(message);
    this.name = "AuctionRuleError";
  }
}

/** Deterministic local model used by the UI and fixture suite. */
export class ComplianceAuctionEngine {
  private readonly accounts = new Map<string, MarketAccount>();
  private readonly auctions = new Map<string, ComplianceAuction>();
  private auctionSequence = 0;
  private eventSequence = 0;

  constructor(
    accounts: MarketAccount[],
    private readonly asset: AssetControlState,
  ) {
    for (const account of accounts) this.accounts.set(account.id, { ...account });
  }

  createAuction(input: CreateAuctionInput, now: number): ComplianceAuction {
    const seller = this.account(input.sellerId);
    const beneficiaryId = input.beneficiaryId ?? input.sellerId;
    const surplusRecipientId = input.surplusRecipientId ?? input.sellerId;
    this.account(beneficiaryId);
    this.account(surplusRecipientId);

    this.assert(input.quantity > 0n, "INVALID_QUANTITY", "Listing quantity must be positive");
    this.assert(input.reservePrice > 0n, "INVALID_RESERVE", "Reserve price must be positive");
    this.assert(input.oraclePrice > 0n, "INVALID_ORACLE", "Oracle reference price must be positive");
    this.assert(input.deadline > now, "INVALID_DEADLINE", "Bidding deadline must be in the future");
    this.assert(!this.asset.paused, "ASSET_PAUSED", "ATS security is paused");
    this.assert(seller.kyc, "SELLER_NOT_KYC", "Seller KYC is not granted");
    this.assert(!seller.frozen, "SELLER_FROZEN", "Seller account is frozen");
    this.assert(
      seller.securityBalance >= input.quantity,
      "INSUFFICIENT_ASSET",
      "Seller has insufficient available units",
    );

    seller.securityBalance -= input.quantity;
    const id = `PQ-AUC-${String(++this.auctionSequence).padStart(3, "0")}`;
    const auction: ComplianceAuction = {
      id,
      kind: input.kind,
      sellerId: seller.id,
      beneficiaryId,
      surplusRecipientId,
      lenderClaim: input.lenderClaim ?? 0n,
      quantity: input.quantity,
      reservePrice: input.reservePrice,
      deadline: input.deadline,
      oraclePrice: input.oraclePrice,
      sanityToleranceBps: input.sanityToleranceBps ?? 1_500,
      oracleExceptionApproved: false,
      state: "OPEN",
      bids: [],
      winnerId: null,
      winningBid: null,
      events: [],
    };
    this.auctions.set(id, auction);
    this.event(
      auction,
      "LISTED",
      seller.id,
      now,
      `${input.quantity} ${this.asset.symbol} secured for ${input.kind.toLowerCase()} sale`,
    );
    return this.snapshotAuction(auction);
  }

  bid(auctionId: string, bidderId: string, amount: bigint, now: number): ComplianceAuction {
    const auction = this.auction(auctionId);
    const bidder = this.account(bidderId);
    try {
      this.assert(auction.state === "OPEN", "AUCTION_NOT_OPEN", "Auction is not open");
      this.assert(now < auction.deadline, "BIDDING_ENDED", "Bidding deadline has passed");
      this.assert(!this.asset.paused, "ASSET_PAUSED", "ATS security is paused");
      this.assert(bidder.kyc, "BIDDER_NOT_KYC", "Bidder KYC is not granted");
      this.assert(!bidder.frozen, "BIDDER_FROZEN", "Bidder account is frozen");
      this.assert(
        !auction.bids.some((bid) => bid.bidderId === bidderId),
        "DUPLICATE_BID",
        "Bidder already funded a bid",
      );
      this.assert(amount > 0n, "INVALID_BID", "Bid must be positive");
      const highest = auction.bids.at(-1)?.amount ?? 0n;
      this.assert(amount > highest, "BID_NOT_HIGHER", `Bid must exceed ${highest}`);
      this.assert(bidder.cashBalance >= amount, "INSUFFICIENT_CASH", "Bidder has insufficient cash");
    } catch (error) {
      const message = error instanceof Error ? error.message : "Bid rejected";
      if (auction.state === "OPEN") this.event(auction, "BID_REJECTED", bidderId, now, message);
      throw error;
    }

    bidder.cashBalance -= amount;
    bidder.committedCash += amount;
    auction.bids.push({ bidderId, amount, placedAt: now });
    this.event(
      auction,
      "BID_FUNDED",
      bidderId,
      now,
      `${amount} simulated USD committed after ATS eligibility preflight`,
    );
    return this.snapshotAuction(auction);
  }

  close(auctionId: string, now: number): ComplianceAuction {
    const auction = this.auction(auctionId);
    this.assert(auction.state === "OPEN", "AUCTION_NOT_OPEN", "Auction is not open");
    this.assert(now >= auction.deadline, "AUCTION_ACTIVE", "Bidding deadline has not passed");
    const highest = auction.bids.at(-1);

    if (!highest || highest.amount < auction.reservePrice) {
      auction.state = "FAILED_NO_VALID_BID";
      this.account(auction.sellerId).securityBalance += auction.quantity;
      this.releaseAllBids(auction, now);
      this.event(
        auction,
        "FAILED_NO_VALID_BID",
        "SYSTEM",
        now,
        "No funded bid met the reserve; the lot and cash were released",
      );
      return this.snapshotAuction(auction);
    }

    auction.state = "CLOSED";
    auction.winnerId = highest.bidderId;
    auction.winningBid = highest.amount;
    this.event(auction, "CLOSED", "SYSTEM", now, `${highest.bidderId} selected at ${highest.amount}`);
    return this.snapshotAuction(auction);
  }

  approveOracleException(auctionId: string, reviewerId: string, now: number): ComplianceAuction {
    const auction = this.auction(auctionId);
    this.assert(auction.state === "CLOSED", "AUCTION_NOT_CLOSED", "Auction must be closed before review");
    this.assert(
      this.isOutsideOracleBounds(auction),
      "PRICE_WITHIN_BOUNDS",
      "Winning bid is already inside oracle bounds",
    );
    auction.oracleExceptionApproved = true;
    this.event(
      auction,
      "ORACLE_REVIEWED",
      reviewerId,
      now,
      "Authorized review approved the out-of-band clearing price",
    );
    return this.snapshotAuction(auction);
  }

  settle(auctionId: string, now: number): ComplianceAuction {
    const auction = this.auction(auctionId);
    this.assert(auction.state === "CLOSED", "AUCTION_NOT_CLOSED", "Auction is not ready to settle");
    this.assert(!this.asset.paused, "ASSET_PAUSED", "ATS security is paused");
    this.assert(auction.winnerId !== null && auction.winningBid !== null, "NO_WINNER", "Auction has no winner");
    const winner = this.account(auction.winnerId);
    this.assert(winner.kyc, "WINNER_NOT_KYC", "Winner KYC is not granted at settlement");
    this.assert(!winner.frozen, "WINNER_FROZEN", "Winner is frozen at settlement");
    this.assert(
      !this.isOutsideOracleBounds(auction) || auction.oracleExceptionApproved,
      "ORACLE_REVIEW_REQUIRED",
      "Winning bid is outside oracle sanity bounds",
    );

    winner.securityBalance += auction.quantity;
    winner.committedCash -= auction.winningBid;
    let beneficiaryRecovery = auction.winningBid;
    if (auction.kind === "LIQUIDATION" && auction.lenderClaim > 0n) {
      beneficiaryRecovery = auction.winningBid > auction.lenderClaim ? auction.lenderClaim : auction.winningBid;
      const surplus = auction.winningBid - beneficiaryRecovery;
      this.account(auction.surplusRecipientId).cashBalance += surplus;
    }
    this.account(auction.beneficiaryId).cashBalance += beneficiaryRecovery;
    this.releaseLosingBids(auction, now);
    auction.state = "SETTLED";
    this.event(
      auction,
      "SETTLED",
      "SYSTEM",
      now,
      `Atomic DvP moved ${auction.quantity} ${this.asset.symbol} for ${auction.winningBid} simulated USD`,
    );
    return this.snapshotAuction(auction);
  }

  cancel(auctionId: string, callerId: string, now: number): ComplianceAuction {
    const auction = this.auction(auctionId);
    this.assert(auction.state === "OPEN", "AUCTION_NOT_OPEN", "Auction is not open");
    this.assert(callerId === auction.sellerId, "NOT_SELLER", "Only the seller can cancel");
    this.assert(auction.bids.length === 0, "FUNDED_BIDS_EXIST", "An auction with funded bids cannot be cancelled");
    this.account(auction.sellerId).securityBalance += auction.quantity;
    auction.state = "CANCELLED";
    this.event(auction, "CANCELLED", callerId, now, "Unbid lot returned to seller");
    return this.snapshotAuction(auction);
  }

  setPaused(paused: boolean): void {
    this.asset.paused = paused;
  }

  setFrozen(accountId: string, frozen: boolean): void {
    this.account(accountId).frozen = frozen;
  }

  setKyc(accountId: string, kyc: boolean): void {
    this.account(accountId).kyc = kyc;
  }

  getAuction(id: string): ComplianceAuction {
    return this.snapshotAuction(this.auction(id));
  }

  getAccounts(): MarketAccount[] {
    return [...this.accounts.values()].map((account) => ({ ...account }));
  }

  isOutsideOracleBounds(auction: ComplianceAuction): boolean {
    if (auction.winningBid === null) return false;
    const tolerance = BigInt(auction.sanityToleranceBps);
    const low = (auction.oraclePrice * (10_000n - tolerance)) / 10_000n;
    const high = (auction.oraclePrice * (10_000n + tolerance)) / 10_000n;
    return auction.winningBid < low || auction.winningBid > high;
  }

  private releaseAllBids(auction: ComplianceAuction, now: number): void {
    for (const bid of auction.bids) this.releaseBid(auction, bid, now);
  }

  private releaseLosingBids(auction: ComplianceAuction, now: number): void {
    for (const bid of auction.bids) {
      if (bid.bidderId !== auction.winnerId) this.releaseBid(auction, bid, now);
    }
  }

  private releaseBid(auction: ComplianceAuction, bid: AuctionBid, now: number): void {
    const account = this.account(bid.bidderId);
    account.committedCash -= bid.amount;
    account.cashBalance += bid.amount;
    this.event(auction, "REFUND_RELEASED", bid.bidderId, now, `${bid.amount} simulated USD released`);
  }

  private event(auction: ComplianceAuction, type: MarketEventType, actorId: string, at: number, detail: string): void {
    const sequence = ++this.eventSequence;
    auction.events.push({ sequence, type, actorId, at, detail, evidenceId: `local-${auction.id}-${sequence}` });
  }

  private account(id: string): MarketAccount {
    const account = this.accounts.get(id);
    if (!account) throw new AuctionRuleError("UNKNOWN_ACCOUNT", `Unknown account ${id}`);
    return account;
  }

  private auction(id: string): ComplianceAuction {
    const auction = this.auctions.get(id);
    if (!auction) throw new AuctionRuleError("UNKNOWN_AUCTION", `Unknown auction ${id}`);
    return auction;
  }

  private snapshotAuction(auction: ComplianceAuction): ComplianceAuction {
    return {
      ...auction,
      bids: auction.bids.map((bid) => ({ ...bid })),
      events: auction.events.map((event) => ({ ...event })),
    };
  }

  private assert(condition: boolean, code: string, message: string): asserts condition {
    if (!condition) throw new AuctionRuleError(code, message);
  }
}

export function createDemoEngine(): ComplianceAuctionEngine {
  return new ComplianceAuctionEngine(
    [
      {
        id: "seller",
        label: "Northstar Treasury Desk",
        kyc: true,
        frozen: false,
        securityBalance: 100n,
        cashBalance: 0n,
        committedCash: 0n,
      },
      {
        id: "bidder-a",
        label: "Atlas Capital",
        kyc: true,
        frozen: false,
        securityBalance: 0n,
        cashBalance: 1_500_000n,
        committedCash: 0n,
      },
      {
        id: "bidder-b",
        label: "Meridian Bank",
        kyc: true,
        frozen: false,
        securityBalance: 0n,
        cashBalance: 1_500_000n,
        committedCash: 0n,
      },
      {
        id: "blocked",
        label: "Unverified Wallet",
        kyc: false,
        frozen: false,
        securityBalance: 0n,
        cashBalance: 1_500_000n,
        committedCash: 0n,
      },
      {
        id: "lender",
        label: "Harbor Repo Lender",
        kyc: true,
        frozen: false,
        securityBalance: 0n,
        cashBalance: 0n,
        committedCash: 0n,
      },
    ],
    { id: "0.0.7854012", symbol: "USTB-28", paused: false },
  );
}
