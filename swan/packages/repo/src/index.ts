// SPDX-License-Identifier: Apache-2.0

export const BPS = 10_000n;

export type RepoState = "DRAFT" | "FUNDING" | "ACTIVE" | "MARGIN_CALL" | "CLOSED" | "DEFAULTED" | "LIQUIDATION";
export type ChallengeDifficulty = "CADET" | "PRO" | "EXPERT";

export type ChallengeRules = {
  difficulty: ChallengeDifficulty;
  fundingWindowSeconds: number;
  marginWindowSeconds: number;
  maintenanceBps: number;
  shockBps: number;
};

export type RepoTerms = {
  borrowerId: string;
  requiredCash: bigint;
  termDays: number;
  maintenanceBps: number;
  marginWindowSeconds: number;
};

export type Asset = {
  id: string;
  label: string;
  series: string;
  available: number;
  price: bigint;
  haircutBps: number;
  maxConcentrationBps: number;
  couponDate: string;
  maturity: string;
  liquidity: "HIGH" | "MEDIUM" | "LOW";
  kycEligible: boolean;
  paused: boolean;
  frozen: boolean;
};

export type BasketLine = { assetId: string; quantity: number };
export type FundingOffer = {
  lenderId: string;
  lenderLabel: string;
  rateBps: number;
  cashAvailable: bigint;
  kycEligible: boolean;
  submittedAt: number;
};
export type RepoEvent = { sequence: number; type: string; detail: string };
export type BasketMetrics = {
  marketValue: bigint;
  borrowingCapacity: bigint;
  coverageBps: number;
  valid: boolean;
  errors: string[];
};
export type LiquidationInstruction = {
  kind: "LIQUIDATION";
  beneficiaryId: string;
  lenderClaim: bigint;
  collateral: BasketLine[];
  surplusRecipientId: string;
};
export type ArenaScore = {
  total: number;
  grade: "S" | "A" | "B" | "C" | "D";
  collateralEfficiency: number;
  fundingQuality: number;
  riskManagement: number;
  compliance: number;
  assistancePenalty: number;
  remedyCapitalUsed: bigint;
};

export class RepoRuleError extends Error {
  constructor(
    public readonly code: string,
    message: string,
  ) {
    super(message);
  }
}

export class RepoEngine {
  readonly events: RepoEvent[] = [];
  readonly offers: FundingOffer[] = [];
  readonly initialPrices: Map<string, bigint>;
  state: RepoState = "DRAFT";
  basket: BasketLine[] = [];
  outstanding: bigint;
  selectedOffer?: FundingOffer;
  marginDeadline?: number;
  couponEquivalentScheduled = false;
  liquidation?: LiquidationInstruction;
  optimizerAssisted = false;
  remedyCapitalUsed = 0n;

  constructor(
    readonly assets: Asset[],
    readonly terms: RepoTerms,
  ) {
    this.outstanding = terms.requiredCash;
    this.initialPrices = new Map(assets.map((asset) => [asset.id, asset.price]));
    this.record("DRAFT_OPENED", `Target liquidity ${terms.requiredCash.toString()} simulated USD`);
  }

  setBasket(lines: BasketLine[]): BasketMetrics {
    this.assertState("DRAFT");
    this.basket = normalize(lines);
    const metrics = this.metrics();
    this.record("BASKET_UPDATED", `${this.basket.length} ATS series; capacity ${metrics.borrowingCapacity}`);
    return metrics;
  }

  optimizeBasket(assisted = false): BasketLine[] {
    this.assertState("DRAFT");
    const eligible = this.assets.filter((asset) => asset.kycEligible && !asset.paused && !asset.frozen);
    let best: { lines: BasketLine[]; value: bigint; excess: bigint } | undefined;
    const walk = (index: number, lines: BasketLine[]) => {
      if (index === eligible.length) {
        const metrics = this.calculate(lines);
        if (!metrics.valid || metrics.borrowingCapacity < this.terms.requiredCash) return;
        const candidate = {
          lines: normalize(lines),
          value: metrics.marketValue,
          excess: metrics.borrowingCapacity - this.terms.requiredCash,
        };
        if (
          !best ||
          candidate.value < best.value ||
          (candidate.value === best.value && candidate.excess < best.excess)
        ) {
          best = candidate;
        }
        return;
      }
      const asset = eligible[index];
      for (let quantity = 0; quantity <= asset.available; quantity += 1) {
        walk(index + 1, quantity === 0 ? lines : [...lines, { assetId: asset.id, quantity }]);
      }
    };
    walk(0, []);
    if (!best)
      throw new RepoRuleError("NO_VALID_BASKET", "Inventory cannot meet the cash target and concentration rules");
    const chosen = best as { lines: BasketLine[]; value: bigint; excess: bigint };
    this.basket = chosen.lines;
    if (assisted) this.optimizerAssisted = true;
    this.record("BASKET_OPTIMIZED", `Minimum locked value ${chosen.value}; excess capacity ${chosen.excess}`);
    return this.basket.map((line) => ({ ...line }));
  }

  metrics(lines = this.basket): BasketMetrics {
    return this.calculate(lines);
  }

  openFunding(): void {
    this.assertState("DRAFT");
    const metrics = this.metrics();
    if (!metrics.valid) throw new RepoRuleError("INVALID_BASKET", metrics.errors.join("; "));
    if (metrics.borrowingCapacity < this.terms.requiredCash) {
      throw new RepoRuleError("INSUFFICIENT_CAPACITY", "Post-haircut value does not cover requested cash");
    }
    this.state = "FUNDING";
    this.record("FUNDING_OPENED", "Compliant basket locked for lender competition");
  }

  submitOffer(offer: FundingOffer): void {
    this.assertState("FUNDING");
    if (!offer.kycEligible) throw new RepoRuleError("LENDER_NOT_KYC", "Lender lacks the required ATS eligibility");
    if (offer.cashAvailable < this.terms.requiredCash)
      throw new RepoRuleError("LENDER_UNFUNDED", "Lender cannot fund the cash leg");
    if (offer.rateBps <= 0) throw new RepoRuleError("INVALID_RATE", "Repo rate must be positive");
    const previous = this.offers.findIndex((item) => item.lenderId === offer.lenderId);
    if (previous >= 0) this.offers.splice(previous, 1);
    this.offers.push({ ...offer });
    this.offers.sort((a, b) => a.rateBps - b.rateBps || a.submittedAt - b.submittedAt);
    this.record("OFFER_ACCEPTED", `${offer.lenderLabel} offered ${formatRate(offer.rateBps)}`);
  }

  activate(): FundingOffer {
    this.assertState("FUNDING");
    const winner = this.offers[0];
    if (!winner) throw new RepoRuleError("NO_FUNDING", "No valid lender offer exists");
    this.selectedOffer = winner;
    this.state = "ACTIVE";
    this.record("REPO_OPENED", `${winner.lenderLabel} funded cash; collateral locked atomically`);
    return { ...winner };
  }

  scheduleCouponEquivalent(): void {
    if (this.state !== "ACTIVE" && this.state !== "MARGIN_CALL") this.failState();
    this.couponEquivalentScheduled = true;
    this.record("COUPON_SCHEDULED", "Coupon equivalent payment scheduled for the borrower");
  }

  reprice(assetId: string, price: bigint, now: number): BasketMetrics {
    if (this.state !== "ACTIVE" && this.state !== "MARGIN_CALL") this.failState();
    const alreadyCalled = this.state === "MARGIN_CALL";
    const asset = this.requireAsset(assetId);
    if (price <= 0n) throw new RepoRuleError("INVALID_PRICE", "Oracle price must be positive");
    asset.price = price;
    const metrics = this.metrics();
    const required = (this.outstanding * BigInt(this.terms.maintenanceBps)) / BPS;
    if (metrics.borrowingCapacity < required) {
      if (!alreadyCalled) {
        this.state = "MARGIN_CALL";
        this.marginDeadline = now + this.terms.marginWindowSeconds;
        this.record("MARGIN_CALL", `Capacity ${metrics.borrowingCapacity}; cure required by ${this.marginDeadline}`);
      } else {
        this.record("COLLATERAL_REPRICED", `${asset.series} repriced to ${price} during margin call`);
      }
    } else if (this.state === "MARGIN_CALL") {
      this.state = "ACTIVE";
      this.marginDeadline = undefined;
      this.record("MARGIN_CURED", "Oracle recovery restored maintenance coverage");
    } else {
      this.record("COLLATERAL_REPRICED", `${asset.series} repriced to ${price}`);
    }
    return metrics;
  }

  addCollateral(line: BasketLine): BasketMetrics {
    this.assertState("MARGIN_CALL");
    const next = normalize([...this.basket, line]);
    const metrics = this.calculate(next);
    if (!metrics.valid) throw new RepoRuleError("INVALID_COLLATERAL", metrics.errors.join("; "));
    this.basket = next;
    this.remedyCapitalUsed += this.requireAsset(line.assetId).price * BigInt(line.quantity);
    this.tryCure("Collateral added");
    return this.metrics();
  }

  substitute(remove: BasketLine, add: BasketLine): BasketMetrics {
    if (this.state !== "ACTIVE" && this.state !== "MARGIN_CALL") this.failState();
    const quantities = new Map(this.basket.map((line) => [line.assetId, line.quantity]));
    quantities.set(remove.assetId, (quantities.get(remove.assetId) ?? 0) - remove.quantity);
    quantities.set(add.assetId, (quantities.get(add.assetId) ?? 0) + add.quantity);
    const next = normalize([...quantities].map(([assetId, quantity]) => ({ assetId, quantity })));
    const metrics = this.calculate(next);
    const required = (this.outstanding * BigInt(this.terms.maintenanceBps)) / BPS;
    if (!metrics.valid || metrics.borrowingCapacity < required) {
      throw new RepoRuleError(
        "SUBSTITUTION_UNDERCOLLATERALIZED",
        "Replacement basket fails eligibility or maintenance coverage",
      );
    }
    const removedAsset = this.requireAsset(remove.assetId);
    const addedAsset = this.requireAsset(add.assetId);
    const removedValue = removedAsset.price * BigInt(remove.quantity);
    const addedValue = addedAsset.price * BigInt(add.quantity);
    if (addedValue > removedValue) this.remedyCapitalUsed += addedValue - removedValue;
    this.basket = next;
    this.tryCure("Collateral substituted");
    return metrics;
  }

  partialRepay(amount: bigint): BasketMetrics {
    this.assertState("MARGIN_CALL");
    if (amount <= 0n || amount >= this.outstanding)
      throw new RepoRuleError("INVALID_REPAYMENT", "Repayment must be below outstanding principal");
    this.outstanding -= amount;
    this.remedyCapitalUsed += amount;
    this.tryCure(`Principal repaid ${amount}`);
    return this.metrics();
  }

  expireMargin(now: number): LiquidationInstruction {
    this.assertState("MARGIN_CALL");
    if (!this.marginDeadline || now < this.marginDeadline)
      throw new RepoRuleError("CURE_WINDOW_OPEN", "Margin cure window has not expired");
    this.state = "DEFAULTED";
    this.record("DEFAULT", "Margin cure expired; lender enforcement started");
    const claim = this.closeAmount();
    this.liquidation = {
      kind: "LIQUIDATION",
      beneficiaryId: this.selectedOffer!.lenderId,
      lenderClaim: claim,
      collateral: this.basket.map((line) => ({ ...line })),
      surplusRecipientId: this.terms.borrowerId,
    };
    this.state = "LIQUIDATION";
    this.record("AUCTION_ROUTED", `KYC auction created; lender claim ${claim}; surplus to borrower`);
    return { ...this.liquidation, collateral: this.liquidation.collateral.map((line) => ({ ...line })) };
  }

  close(): bigint {
    this.assertState("ACTIVE");
    if (!this.couponEquivalentScheduled) {
      throw new RepoRuleError("COUPON_UNSCHEDULED", "Equivalent coupon payment must be scheduled before closing");
    }
    const amount = this.closeAmount();
    this.state = "CLOSED";
    this.record("REPO_CLOSED", `Repurchase ${amount}; ATS collateral released to borrower`);
    return amount;
  }

  resetPrices(): void {
    for (const asset of this.assets) asset.price = this.initialPrices.get(asset.id)!;
  }

  score(): ArenaScore {
    const metrics = this.metrics();
    const rawCollateralEfficiency =
      metrics.marketValue === 0n ? 0 : Math.min(300, Number((this.terms.requiredCash * 300n) / metrics.marketValue));
    const assistancePenalty = this.optimizerAssisted ? 60 : 0;
    const collateralEfficiency = Math.max(0, rawCollateralEfficiency - assistancePenalty);
    const winningRate = this.selectedOffer?.rateBps ?? this.offers[0]?.rateBps;
    const fundingQuality =
      winningRate === undefined ? 0 : Math.max(0, Math.min(250, 250 - Math.max(0, winningRate - 350)));
    const rawRiskManagement =
      this.state === "CLOSED"
        ? 300
        : this.state === "LIQUIDATION"
          ? 20
          : this.events.some((event) => event.type === "MARGIN_CURED")
            ? 250
            : this.state === "ACTIVE"
              ? 180
              : 80;
    const capitalPenalty = Math.min(100, Number((this.remedyCapitalUsed * 100n) / this.terms.requiredCash));
    const riskManagement = Math.max(0, rawRiskManagement - capitalPenalty);
    const compliance = metrics.valid || this.state !== "DRAFT" ? 150 : 0;
    const total = collateralEfficiency + fundingQuality + riskManagement + compliance;
    return {
      total,
      grade: total >= 900 ? "S" : total >= 800 ? "A" : total >= 650 ? "B" : total >= 450 ? "C" : "D",
      collateralEfficiency,
      fundingQuality,
      riskManagement,
      compliance,
      assistancePenalty,
      remedyCapitalUsed: this.remedyCapitalUsed,
    };
  }

  private calculate(lines: BasketLine[]): BasketMetrics {
    const errors: string[] = [];
    let marketValue = 0n;
    let borrowingCapacity = 0n;
    for (const line of normalize(lines)) {
      const asset = this.assets.find((item) => item.id === line.assetId);
      if (!asset) {
        errors.push(`Unknown asset ${line.assetId}`);
        continue;
      }
      if (line.quantity > asset.available) errors.push(`${asset.series} exceeds available inventory`);
      if (!asset.kycEligible || asset.paused || asset.frozen)
        errors.push(`${asset.series} is not ATS-transfer eligible`);
      const value = asset.price * BigInt(line.quantity);
      marketValue += value;
      borrowingCapacity += (value * (BPS - BigInt(asset.haircutBps))) / BPS;
    }
    if (marketValue > 0n) {
      for (const line of normalize(lines)) {
        const asset = this.assets.find((item) => item.id === line.assetId);
        if (!asset) continue;
        const share = Number((asset.price * BigInt(line.quantity) * BPS) / marketValue);
        if (share > asset.maxConcentrationBps) errors.push(`${asset.series} exceeds its concentration limit`);
      }
    }
    return {
      marketValue,
      borrowingCapacity,
      coverageBps: this.outstanding === 0n ? 0 : Number((borrowingCapacity * BPS) / this.outstanding),
      valid: lines.length > 0 && errors.length === 0,
      errors,
    };
  }

  private tryCure(detail: string): void {
    const required = (this.outstanding * BigInt(this.terms.maintenanceBps)) / BPS;
    if (this.metrics().borrowingCapacity >= required) {
      this.state = "ACTIVE";
      this.marginDeadline = undefined;
      this.record("MARGIN_CURED", detail);
    } else {
      this.record("MARGIN_REMEDY", `${detail}; additional collateral still required`);
    }
  }

  private closeAmount(): bigint {
    const offer = this.selectedOffer;
    if (!offer) throw new RepoRuleError("NO_LENDER", "Repo has no selected lender");
    const interest = (this.outstanding * BigInt(offer.rateBps) * BigInt(this.terms.termDays)) / (BPS * 365n);
    return this.outstanding + interest;
  }

  private requireAsset(assetId: string): Asset {
    const asset = this.assets.find((item) => item.id === assetId);
    if (!asset) throw new RepoRuleError("UNKNOWN_ASSET", `Unknown asset ${assetId}`);
    return asset;
  }

  private assertState(expected: RepoState): void {
    if (this.state !== expected) this.failState();
  }

  private failState(): never {
    throw new RepoRuleError("INVALID_STATE", `Action unavailable while repo is ${this.state}`);
  }

  private record(type: string, detail: string): void {
    this.events.push({ sequence: this.events.length + 1, type, detail });
  }
}

const RULES: Record<ChallengeDifficulty, ChallengeRules> = {
  CADET: {
    difficulty: "CADET",
    fundingWindowSeconds: 75,
    marginWindowSeconds: 90,
    maintenanceBps: 10_000,
    shockBps: 1_400,
  },
  PRO: {
    difficulty: "PRO",
    fundingWindowSeconds: 45,
    marginWindowSeconds: 45,
    maintenanceBps: 10_500,
    shockBps: 1_800,
  },
  EXPERT: {
    difficulty: "EXPERT",
    fundingWindowSeconds: 30,
    marginWindowSeconds: 30,
    maintenanceBps: 11_000,
    shockBps: 2_200,
  },
};

export function challengeRules(difficulty: ChallengeDifficulty): ChallengeRules {
  return { ...RULES[difficulty] };
}

export function createRepoFixture(options: { seed?: number; difficulty?: ChallengeDifficulty } = {}): RepoEngine {
  const difficulty = options.difficulty ?? "PRO";
  const rules = challengeRules(difficulty);
  const seed = normalizeSeed(options.seed ?? 1042);
  const nextRandom = mulberry32(seed);
  const assets = [
    asset("ust-28", "U.S. Treasury Note 4.25%", "USTB-28", 8, 100_000n, 200, 7_000, "2026-10-15", "2028-11-15", "HIGH"),
    asset(
      "green-30",
      "Sovereign Green Bond 3.80%",
      "GRNB-30",
      6,
      98_000n,
      800,
      6_000,
      "2026-11-02",
      "2030-05-02",
      "MEDIUM",
    ),
    asset(
      "muni-31",
      "Metro Infrastructure 5.10%",
      "MUNI-31",
      5,
      95_000n,
      1_500,
      5_500,
      "2026-09-30",
      "2031-09-30",
      "MEDIUM",
    ),
    asset(
      "corp-29",
      "Northstar Senior Note 5.65%",
      "NSCR-29",
      5,
      102_000n,
      2_000,
      4_500,
      "2026-12-12",
      "2029-06-12",
      "LOW",
    ),
  ];

  for (const item of assets) {
    const priceShiftBps = Math.floor(nextRandom() * 801) - 400;
    item.price = (item.price * BigInt(10_000 + priceShiftBps)) / BPS;
  }

  return new RepoEngine(assets, {
    borrowerId: "harbor-treasury",
    requiredCash: 1_000_000n,
    termDays: 30,
    maintenanceBps: rules.maintenanceBps,
    marginWindowSeconds: rules.marginWindowSeconds,
  });
}

function normalizeSeed(seed: number): number {
  if (!Number.isFinite(seed)) return 1042;
  return Math.max(1, Math.floor(Math.abs(seed))) >>> 0;
}

function mulberry32(seed: number): () => number {
  return () => {
    let value = (seed += 0x6d2b79f5);
    value = Math.imul(value ^ (value >>> 15), value | 1);
    value ^= value + Math.imul(value ^ (value >>> 7), value | 61);
    return ((value ^ (value >>> 14)) >>> 0) / 4_294_967_296;
  };
}

function asset(
  id: string,
  label: string,
  series: string,
  available: number,
  price: bigint,
  haircutBps: number,
  maxConcentrationBps: number,
  couponDate: string,
  maturity: string,
  liquidity: Asset["liquidity"],
): Asset {
  return {
    id,
    label,
    series,
    available,
    price,
    haircutBps,
    maxConcentrationBps,
    couponDate,
    maturity,
    liquidity,
    kycEligible: true,
    paused: false,
    frozen: false,
  };
}

function normalize(lines: BasketLine[]): BasketLine[] {
  const totals = new Map<string, number>();
  for (const line of lines) {
    if (!Number.isInteger(line.quantity)) continue;
    totals.set(line.assetId, (totals.get(line.assetId) ?? 0) + line.quantity);
  }
  return [...totals]
    .filter(([, quantity]) => quantity > 0)
    .map(([assetId, quantity]) => ({ assetId, quantity }))
    .sort((a, b) => a.assetId.localeCompare(b.assetId));
}

function formatRate(rateBps: number): string {
  return `${(rateBps / 100).toFixed(2)}%`;
}
