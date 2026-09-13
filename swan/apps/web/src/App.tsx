// SPDX-License-Identifier: Apache-2.0

import { useEffect, useRef, useState, type ReactNode } from "react";
import { ConnectButton } from "@rainbow-me/rainbowkit";
import { useAccount, useChainId } from "wagmi";
import Landing from "./Landing";
import { createDemoEngine, type ComplianceAuction, type ComplianceAuctionEngine } from "@swan/auction";
import {
  HEDERA_TESTNET_USDC_TOKEN_ID,
  LiveSwanClient,
  formatUsdc,
  hashScheduleId,
  parseTokenUnits,
  parseUsdc,
  type LiveAddresses,
  type TransactionEvidence,
  type UsdcSnapshot,
} from "@swan/live";
import {
  RepoRuleError,
  challengeRules,
  createRepoFixture,
  type ChallengeDifficulty,
  type FundingOffer,
  type RepoEngine,
} from "@swan/repo";

const LIVE_ADDRESSES: LiveAddresses | null =
  import.meta.env.VITE_REPO_LIFECYCLE_ADDRESS &&
  import.meta.env.VITE_COMPLIANCE_AUCTION_ADDRESS &&
  import.meta.env.VITE_SIGNED_PRICE_ORACLE_ADDRESS &&
  import.meta.env.VITE_USDC_ADDRESS
    ? {
        repoLifecycle: import.meta.env.VITE_REPO_LIFECYCLE_ADDRESS,
        complianceAuction: import.meta.env.VITE_COMPLIANCE_AUCTION_ADDRESS,
        signedPriceOracle: import.meta.env.VITE_SIGNED_PRICE_ORACLE_ADDRESS,
        usdc: import.meta.env.VITE_USDC_ADDRESS,
      }
    : null;
const LIVE_REPO_ALLOWANCE = parseUsdc("11");
const LIVE_AUCTION_ALLOWANCE = parseUsdc("10");
const LENDERS: FundingOffer[] = [
  {
    lenderId: "unverified",
    lenderLabel: "Unverified Desk",
    rateBps: 325,
    cashAvailable: 2_000_000n,
    kycEligible: false,
    submittedAt: 1,
  },
  {
    lenderId: "atlas",
    lenderLabel: "Atlas Capital",
    rateBps: 475,
    cashAvailable: 2_000_000n,
    kycEligible: true,
    submittedAt: 2,
  },
  {
    lenderId: "meridian",
    lenderLabel: "Meridian Bank",
    rateBps: 410,
    cashAvailable: 2_000_000n,
    kycEligible: true,
    submittedAt: 3,
  },
];

type Notice = { tone: "good" | "bad" | "neutral"; text: string };
type SessionState = "PLAYING" | "WON" | "LOST";
type BestScores = Record<ChallengeDifficulty, number>;
type Screen = "nest" | "bonds" | "pond" | "care" | "sale" | "book";
type LiveForm = {
  security: string;
  securityDecimals: string;
  quantity: string;
  unitPrice: string;
  stormPrice: string;
  principal: string;
  ratePercent: string;
  repoId: string;
  auctionId: string;
  bid: string;
  coupon: string;
  scheduleId: string;
  scheduledCaller: string;
};

const EMPTY_BEST_SCORES: BestScores = { CADET: 0, PRO: 0, EXPERT: 0 };
const DEFAULT_LIVE_FORM: LiveForm = {
  security: import.meta.env.VITE_ATS_SECURITY_ADDRESS ?? "",
  securityDecimals: import.meta.env.VITE_ATS_SECURITY_DECIMALS ?? "0",
  quantity: "2",
  unitPrice: "6",
  stormPrice: "2",
  principal: "5",
  ratePercent: "4.10",
  repoId: "",
  auctionId: "",
  bid: "11",
  coupon: "0.10",
  scheduleId: "",
  scheduledCaller: import.meta.env.VITE_SCHEDULED_CALLER_ADDRESS ?? "",
};
const SCREENS: { id: Screen; glyph: string; label: string }[] = [
  { id: "nest", glyph: "⌂", label: "Nest" },
  { id: "bonds", glyph: "●", label: "Bonds" },
  { id: "pond", glyph: "≈", label: "Pond" },
  { id: "care", glyph: "♥", label: "Care" },
  { id: "sale", glyph: "✦", label: "Sale" },
  { id: "book", glyph: "▣", label: "Book" },
];

export default function App() {
  const { address: connectedAddress, connector, isConnected } = useAccount();
  const connectedChainId = useChainId();
  const [view, setView] = useState<"home" | "play">(() => (window.location.hash === "#play" ? "play" : "home"));
  const [difficulty, setDifficulty] = useState<ChallengeDifficulty>("PRO");
  const [seed, setSeed] = useState(1042);
  const [screen, setScreen] = useState<Screen>("nest");
  const arena = useRef(createRepoFixture({ difficulty: "PRO", seed: 1042 }));
  const liquidationMarket = useRef<ComplianceAuctionEngine>(createDemoEngine());
  const liveClient = useRef<LiveSwanClient | null>(null);
  const [, redraw] = useState(0);
  const [clock, setClock] = useState(() => Date.now());
  const [fundingDeadline, setFundingDeadline] = useState<number>();
  const [liquidationAuction, setLiquidationAuction] = useState<ComplianceAuction>();
  const [sessionState, setSessionState] = useState<SessionState>("PLAYING");
  const [bestScores, setBestScores] = useState<BestScores>(loadBestScores);
  const [notice, setNotice] = useState<Notice>({
    tone: "neutral",
    text: "Feed the nest: raise $1.00m with the smallest healthy basket.",
  });
  const [liveAccount, setLiveAccount] = useState<string>();
  const [usdcSnapshot, setUsdcSnapshot] = useState<UsdcSnapshot>();
  const [liveEvidence, setLiveEvidence] = useState<TransactionEvidence>();
  const [liveHistory, setLiveHistory] = useState<{ label: string; evidence: TransactionEvidence }[]>([]);
  const [liveBusy, setLiveBusy] = useState<string>();
  const [liveForm, setLiveForm] = useState<LiveForm>(DEFAULT_LIVE_FORM);
  const [liveReadout, setLiveReadout] = useState("Connect, then load an ATS bond.");
  const engine = arena.current;
  const rules = challengeRules(difficulty);
  const metrics = engine.metrics();
  const score = engine.score();
  const mood = swanMood(engine, sessionState);
  const coverageHearts = heartsFromBps(metrics.coverageBps, rules.maintenanceBps);
  const hungerHearts = heartsFromCapacity(metrics.borrowingCapacity, engine.outstanding);
  const happyHearts =
    sessionState === "WON" ? 4 : sessionState === "LOST" ? 0 : engine.offers.length + (engine.selectedOffer ? 1 : 0);

  useEffect(() => {
    const onHash = () => setView(window.location.hash === "#play" ? "play" : "home");
    window.addEventListener("hashchange", onHash);
    return () => window.removeEventListener("hashchange", onHash);
  }, []);

  useEffect(() => {
    const timer = window.setInterval(() => setClock(Date.now()), 250);
    return () => window.clearInterval(timer);
  }, []);

  useEffect(() => {
    let stale = false;

    async function synchronizeLiveWallet() {
      if (!LIVE_ADDRESSES || !isConnected || !connector || !connectedAddress) {
        liveClient.current = null;
        setLiveAccount(undefined);
        setUsdcSnapshot(undefined);
        return;
      }
      // Never leave the previous signer usable while an account or connector
      // change is being synchronized.
      liveClient.current = null;
      setLiveAccount(undefined);
      setUsdcSnapshot(undefined);
      if (connectedChainId !== 296) {
        setLiveReadout("Use RainbowKit to switch this wallet to Hedera testnet.");
        return;
      }

      try {
        const walletProvider = (await connector.getProvider({
          chainId: 296,
        })) as Parameters<typeof LiveSwanClient.connect>[0];
        const client = await LiveSwanClient.connect(walletProvider, LIVE_ADDRESSES);
        const snapshot = await client.usdcSnapshot();
        if (stale) return;
        liveClient.current = client;
        setLiveAccount(client.account);
        setUsdcSnapshot(snapshot);
        setLiveReadout(`Wallet ready with ${formatUsdc(snapshot.balance)} test USDC.`);
        setNotice({
          tone: "good",
          text: `Wallet linked. ${formatUsdc(snapshot.balance)} ready for live settlement.`,
        });
      } catch (error) {
        if (stale) return;
        liveClient.current = null;
        setLiveAccount(undefined);
        setUsdcSnapshot(undefined);
        const message = error instanceof Error ? error.message : "Wallet connection failed";
        setLiveReadout(message);
        setNotice({ tone: "bad", text: message });
      }
    }

    void synchronizeLiveWallet();
    return () => {
      stale = true;
    };
  }, [connectedAddress, connectedChainId, connector, isConnected]);

  useEffect(() => {
    const now = Math.floor(clock / 1_000);
    if (liquidationAuction?.state === "OPEN" && now >= liquidationAuction.deadline) {
      const closed = liquidationMarket.current.close(liquidationAuction.id, now);
      const finalAuction = closed.state === "CLOSED" ? liquidationMarket.current.settle(closed.id, now) : closed;
      setLiquidationAuction(finalAuction);
      setNotice({
        tone: finalAuction.state === "SETTLED" ? "good" : "bad",
        text:
          finalAuction.state === "SETTLED"
            ? `Sale settled at ${formatUsd(finalAuction.winningBid!)}. Swan is safe with ATS DvP.`
            : "Sale missed reserve. Collateral swam back to the enforcement pond.",
      });
      redraw((value) => value + 1);
      return;
    }
    if (sessionState !== "PLAYING") return;
    if (engine.state === "FUNDING" && fundingDeadline && clock >= fundingDeadline) {
      setFundingDeadline(undefined);
      if (engine.offers.length === 0) {
        finishChallenge("LOST", "The pond closed before an eligible swan could feed.");
      } else {
        const winner = engine.activate();
        setNotice({
          tone: "good",
          text: `Nest funded. ${winner.lenderLabel} won at ${rate(winner.rateBps)}.`,
        });
        redraw((value) => value + 1);
      }
      return;
    }
    if (engine.state === "MARGIN_CALL" && engine.marginDeadline && now >= engine.marginDeadline) {
      const liquidation = engine.expireMargin(now);
      openLiquidationAuction(liquidation.lenderClaim, now);
      finishChallenge("LOST", "Care window expired. The nest entered a recovery sale.");
    }
  }, [clock, engine, fundingDeadline, liquidationAuction, sessionState]);

  function act(action: () => string, failure = "Action failed", successTone: Notice["tone"] = "good") {
    try {
      setNotice({ tone: successTone, text: action() });
    } catch (error) {
      const code = isRuleError(error) ? error.code : failure.toUpperCase().replace(/ /g, "_");
      setNotice({ tone: "bad", text: `${code}: ${error instanceof Error ? error.message : failure}` });
    }
    redraw((value) => value + 1);
  }

  function setQuantity(assetId: string, quantity: number) {
    if (engine.state !== "DRAFT") return;
    const next = engine.basket.filter((line) => line.assetId !== assetId);
    if (quantity > 0) next.push({ assetId, quantity });
    engine.setBasket(next);
    redraw((value) => value + 1);
  }

  function shockPrices() {
    act(() => {
      for (const line of [...engine.basket]) {
        const asset = engine.assets.find((item) => item.id === line.assetId)!;
        engine.reprice(
          line.assetId,
          (asset.price * BigInt(10_000 - rules.shockBps)) / 10_000n,
          Math.floor(Date.now() / 1_000),
        );
      }
      return `Storm −${(rules.shockBps / 100).toFixed(0)}%. Coverage ${(engine.metrics().coverageBps / 100).toFixed(1)}%. Care for Swan now.`;
    });
  }

  function addCollateral() {
    act(() => {
      const candidate = engine.assets.find(
        (asset) => (engine.basket.find((line) => line.assetId === asset.id)?.quantity ?? 0) <= asset.available - 2,
      );
      if (!candidate) throw new RepoRuleError("NO_SPARE_COLLATERAL", "No spare nest stuffing remains");
      engine.addCollateral({ assetId: candidate.id, quantity: 2 });
      return engine.state === "ACTIVE"
        ? "Two units fed. Swan perked up."
        : "Fed extra units. Swan still needs more cover.";
    });
  }

  function substituteCollateral() {
    act(() => {
      for (const current of [...engine.basket].sort((a, b) => b.quantity - a.quantity)) {
        for (let removeQuantity = 1; removeQuantity <= current.quantity; removeQuantity += 1) {
          for (const candidate of engine.assets) {
            const alreadyLocked = engine.basket.find((line) => line.assetId === candidate.id)?.quantity ?? 0;
            if (candidate.id === current.assetId || alreadyLocked >= candidate.available) continue;
            for (let quantity = 1; quantity <= candidate.available - alreadyLocked; quantity += 1) {
              try {
                engine.substitute(
                  { assetId: current.assetId, quantity: removeQuantity },
                  { assetId: candidate.id, quantity },
                );
                return `Swapped ${removeQuantity} ${current.assetId} for ${quantity} ${candidate.series}.`;
              } catch (error) {
                if (!isRuleError(error)) throw error;
              }
            }
          }
        }
      }
      throw new RepoRuleError("NO_VALID_SUBSTITUTION", "No swap restores maintenance coverage");
    });
  }

  function openLiquidationAuction(lenderClaim: bigint, now = Math.floor(Date.now() / 1_000)) {
    liquidationMarket.current = createDemoEngine();
    const auction = liquidationMarket.current.createAuction(
      {
        kind: "LIQUIDATION",
        sellerId: "seller",
        beneficiaryId: "lender",
        surplusRecipientId: "seller",
        lenderClaim,
        quantity: BigInt(engine.basket.reduce((sum, line) => sum + line.quantity, 0)),
        reservePrice: (lenderClaim * 9_000n) / 10_000n,
        deadline: now + 30,
        oraclePrice: lenderClaim,
        sanityToleranceBps: 1_500,
      },
      now,
    );
    setLiquidationAuction(auction);
    setScreen("sale");
  }

  function bidLiquidation(bidderId: string, premiumBps: number) {
    if (!liquidationAuction) return;
    act(() => {
      const amount = (liquidationAuction.oraclePrice * BigInt(premiumBps)) / 10_000n;
      const updated = liquidationMarket.current.bid(
        liquidationAuction.id,
        bidderId,
        amount,
        Math.floor(Date.now() / 1_000),
      );
      setLiquidationAuction(updated);
      return `${bidderLabel(bidderId)} bid ${formatUsd(amount)}.`;
    });
  }

  function startChallenge(nextDifficulty = difficulty, nextSeed = newSeed()) {
    arena.current = createRepoFixture({ difficulty: nextDifficulty, seed: nextSeed });
    liquidationMarket.current = createDemoEngine();
    setDifficulty(nextDifficulty);
    setSeed(nextSeed);
    setFundingDeadline(undefined);
    setLiquidationAuction(undefined);
    setSessionState("PLAYING");
    setScreen("bonds");
    setNotice({
      tone: "neutral",
      text: `Swan #${nextSeed} hatched. Stuff the nest without extra help.`,
    });
    redraw((value) => value + 1);
  }

  function finishChallenge(result: Exclude<SessionState, "PLAYING">, message: string) {
    setSessionState(result);
    setScreen("nest");
    setNotice({ tone: result === "WON" ? "good" : "bad", text: message });
    const finalScore = arena.current.score().total;
    setBestScores((current) => {
      const next = { ...current, [difficulty]: Math.max(current[difficulty], finalScore) };
      window.localStorage.setItem("swan.best-scores", JSON.stringify(next));
      return next;
    });
    redraw((value) => value + 1);
  }

  async function approveLiveUsdc(role: "repo" | "auction") {
    const client = liveClient.current;
    if (!client || !LIVE_ADDRESSES) {
      setNotice({ tone: "bad", text: "Connect a Hedera testnet wallet before approving USDC." });
      return;
    }
    const spender = role === "repo" ? LIVE_ADDRESSES.repoLifecycle : LIVE_ADDRESSES.complianceAuction;
    const amount = role === "repo" ? LIVE_REPO_ALLOWANCE : LIVE_AUCTION_ALLOWANCE;
    try {
      setLiveBusy(role);
      const evidence = await client.approveUsdc(spender, amount);
      setLiveEvidence(evidence);
      setLiveHistory((current) => [{ label: `${role} USDC approval`, evidence }, ...current].slice(0, 6));
      setUsdcSnapshot(await client.usdcSnapshot());
      setNotice({
        tone: "good",
        text: `${formatUsdc(amount)} approved for the ${role === "repo" ? "nest" : "sale"}.`,
      });
    } catch (error) {
      setNotice({ tone: "bad", text: error instanceof Error ? error.message : "USDC approval failed" });
    } finally {
      setLiveBusy(undefined);
    }
  }

  function setLiveField<Key extends keyof LiveForm>(key: Key, value: LiveForm[Key]) {
    setLiveForm((current) => ({ ...current, [key]: value }));
  }

  function requireLiveClient(): LiveSwanClient {
    if (!liveClient.current) throw new Error("Connect a Hedera testnet wallet first");
    return liveClient.current;
  }

  function liveEntityId(value: string, label: string): bigint {
    if (!/^\d+$/.test(value)) throw new Error(`${label} must be a numeric on-chain ID`);
    return BigInt(value);
  }

  function liveQuantity(): bigint {
    const decimals = Number(liveForm.securityDecimals);
    if (!Number.isInteger(decimals) || decimals < 0 || decimals > 18) {
      throw new Error("Security decimals must be between 0 and 18");
    }
    return parseTokenUnits(liveForm.quantity, decimals);
  }

  function liveTotalOracleValue(): bigint {
    return (parseUsdc(liveForm.unitPrice) * liveQuantity()) / 10n ** BigInt(Number(liveForm.securityDecimals));
  }

  async function executeLive<T extends TransactionEvidence>(
    label: string,
    operation: () => Promise<T>,
  ): Promise<T | undefined> {
    try {
      setLiveBusy(label);
      const result = await operation();
      setLiveEvidence(result);
      setLiveHistory((current) => [{ label, evidence: result }, ...current].slice(0, 6));
      setLiveReadout(`${label} confirmed in block ${result.blockNumber}.`);
      setNotice({ tone: "good", text: `${label} confirmed on Hedera testnet.` });
      try {
        setUsdcSnapshot(await requireLiveClient().usdcSnapshot());
      } catch {
        // The lifecycle transaction is still successful if a follow-up balance read is unavailable.
      }
      return result;
    } catch (error) {
      const message = error instanceof Error ? error.message : `${label} failed`;
      setLiveReadout(message);
      setNotice({ tone: "bad", text: message });
      return undefined;
    } finally {
      setLiveBusy(undefined);
    }
  }

  async function loadLiveSecurity() {
    try {
      setLiveBusy("load security");
      if (!liveForm.security) throw new Error("Enter an ATS security EVM address");
      const decimals = await requireLiveClient().securityDecimals(liveForm.security);
      setLiveField("securityDecimals", String(decimals));
      setLiveReadout(`ATS bond loaded with ${decimals} decimals.`);
      setNotice({ tone: "good", text: "ATS bond loaded. Publish its signed price next." });
    } catch (error) {
      const message = error instanceof Error ? error.message : "Could not load ATS bond";
      setLiveReadout(message);
      setNotice({ tone: "bad", text: message });
    } finally {
      setLiveBusy(undefined);
    }
  }

  async function publishLiveSecurityPrice(price = liveForm.unitPrice) {
    await executeLive("signed bond price", () =>
      requireLiveClient().publishSecurityPrice(liveForm.security, parseUsdc(price)),
    );
  }

  async function approveLiveSecurity(target: "repo" | "auction") {
    await executeLive(`${target} bond approval`, () => {
      const client = requireLiveClient();
      const quantity = liveQuantity();
      return target === "repo"
        ? client.approveSecurity(liveForm.security, quantity)
        : client.approveSecurityForAuction(liveForm.security, quantity);
    });
  }

  async function requestLiveRepo() {
    await executeLive("repo requested", async () => {
      const now = BigInt(Math.floor(Date.now() / 1_000));
      const result = await requireLiveClient().requestRepo({
        principal: parseUsdc(liveForm.principal),
        fundingDeadline: now + 90n,
        maturity: now + 600n,
        maintenanceBps: 10_500,
        basket: [
          {
            security: liveForm.security,
            quantity: liveQuantity(),
            oraclePrice: parseUsdc(liveForm.unitPrice),
            haircutBps: 1_000,
            maxConcentrationBps: 10_000,
          },
        ],
      });
      setLiveField("repoId", result.entityId.toString());
      return result;
    });
  }

  async function offerLiveFunding() {
    await executeLive("funding offer", () => {
      const rateBps = Math.round(Number(liveForm.ratePercent) * 100);
      if (!Number.isInteger(rateBps) || rateBps <= 0 || rateBps > 65_535) throw new Error("Invalid repo rate");
      return requireLiveClient().offerFunding(liveEntityId(liveForm.repoId, "Repo ID"), rateBps);
    });
  }

  async function openLiveRepo() {
    await executeLive("repo opened", () => requireLiveClient().openRepo(liveEntityId(liveForm.repoId, "Repo ID")));
  }

  async function shockLiveRepo() {
    await executeLive("margin price applied", async () => {
      const client = requireLiveClient();
      const price = parseUsdc(liveForm.stormPrice);
      await client.publishSecurityPrice(liveForm.security, price);
      return client.refreshPrice(liveEntityId(liveForm.repoId, "Repo ID"), 0n);
    });
  }

  async function addLiveCollateral() {
    await executeLive("collateral added", () =>
      requireLiveClient().addCollateral(liveEntityId(liveForm.repoId, "Repo ID"), 0n, liveQuantity()),
    );
  }

  async function partiallyRepayLiveRepo() {
    await executeLive("partial repayment", () =>
      requireLiveClient().partiallyRepay(liveEntityId(liveForm.repoId, "Repo ID"), parseUsdc("1")),
    );
  }

  async function declareLiveDefault() {
    await executeLive("default declared", () =>
      requireLiveClient().declareDefault(liveEntityId(liveForm.repoId, "Repo ID")),
    );
  }

  async function createLiveLiquidation() {
    await executeLive("liquidation auction", async () => {
      const result = await requireLiveClient().createLiquidationAuctions(
        liveEntityId(liveForm.repoId, "Repo ID"),
        BigInt(Math.floor(Date.now() / 1_000) + 90),
        1_500,
      );
      setLiveField("auctionId", result.entityIds[0].toString());
      return result;
    });
  }

  async function createLiveVoluntaryAuction() {
    await executeLive("voluntary auction", async () => {
      const result = await requireLiveClient().createVoluntaryAuction({
        security: liveForm.security,
        quantity: liveQuantity(),
        reservePrice: parseUsdc(liveForm.principal),
        biddingDeadline: BigInt(Math.floor(Date.now() / 1_000) + 90),
        oraclePrice: liveTotalOracleValue(),
        sanityToleranceBps: 1_500,
      });
      setLiveField("auctionId", result.entityId.toString());
      return result;
    });
  }

  async function bidLiveAuction() {
    await executeLive("auction bid", () =>
      requireLiveClient().bid(liveEntityId(liveForm.auctionId, "Auction ID"), parseUsdc(liveForm.bid)),
    );
  }

  async function verifyLiveCouponSchedule() {
    if (!liveForm.scheduleId.trim()) {
      setLiveReadout("Create a Hedera scheduled coupon first, then paste its schedule ID.");
      return;
    }
    await executeLive("coupon schedule verified", () =>
      requireLiveClient().verifyCouponEquivalentSchedule(
        liveEntityId(liveForm.repoId, "Repo ID"),
        hashScheduleId(liveForm.scheduleId),
      ),
    );
  }

  async function payLiveCoupon() {
    await executeLive("coupon equivalent paid", () =>
      requireLiveClient().payCouponEquivalent(liveEntityId(liveForm.repoId, "Repo ID"), parseUsdc(liveForm.coupon)),
    );
  }

  async function authorizeLiveScheduledCaller() {
    if (!liveForm.scheduledCaller.trim()) {
      setLiveReadout("Enter the long-zero EVM address for the Hedera account that will execute the schedule.");
      return;
    }
    await executeLive("scheduled caller authorized", () =>
      requireLiveClient().authorizeScheduledCaller(
        liveEntityId(liveForm.repoId, "Repo ID"),
        liveForm.scheduledCaller.trim(),
      ),
    );
  }

  async function readLiveRepo() {
    try {
      setLiveBusy("read repo");
      const snapshot = await requireLiveClient().repoSnapshot(liveEntityId(liveForm.repoId, "Repo ID"));
      const states = ["none", "funding", "active", "margin call", "closed", "liquidation", "cancelled"];
      setLiveReadout(
        `Repo ${liveForm.repoId}: ${states[Number(snapshot.repo.state)] ?? "unknown"}, capacity ${formatUsdc(snapshot.capacity)}.`,
      );
    } catch (error) {
      setLiveReadout(error instanceof Error ? error.message : "Repo read failed");
    } finally {
      setLiveBusy(undefined);
    }
  }

  function cycleScreen(step: -1 | 1) {
    const index = SCREENS.findIndex((item) => item.id === screen);
    setScreen(SCREENS[(index + step + SCREENS.length) % SCREENS.length].id);
  }

  function runPrimary() {
    if (sessionState !== "PLAYING" && screen === "nest") {
      startChallenge();
      return;
    }
    if (screen === "bonds" && engine.state === "DRAFT") {
      act(() => {
        engine.openFunding();
        setFundingDeadline(Date.now() + rules.fundingWindowSeconds * 1_000);
        setScreen("pond");
        return "Nest locked. The pond is open for feeding.";
      });
      return;
    }
    if (screen === "pond" && engine.state === "FUNDING") {
      act(() => {
        const winner = engine.activate();
        setFundingDeadline(undefined);
        setScreen("care");
        return `${winner.lenderLabel} won at ${rate(winner.rateBps)}. Cash delivered.`;
      });
      return;
    }
    if (screen === "care" && engine.state === "ACTIVE") {
      if (!engine.couponEquivalentScheduled) {
        act(() => {
          engine.scheduleCouponEquivalent();
          return "Coupon snack scheduled for Harbor Treasury.";
        });
        return;
      }
      act(() => {
        const amount = engine.close();
        finishChallenge("WON", `Nest defended. ${formatUsd(amount)} repaid and Swan came home.`);
        return `Nest defended. ${formatUsd(amount)} repaid and Swan came home.`;
      });
    }
  }

  function openPlay() {
    window.location.hash = "play";
    setView("play");
  }

  if (view === "home") {
    return <Landing onPlay={openPlay} />;
  }

  return (
    <div className="room">
      <div className="room-label">
        <button
          className="back-home"
          onClick={() => {
            window.location.hash = "";
            setView("home");
          }}
        >
          ← nest
        </button>
        <span className="wordmark">swan</span>
        <small>virtual pet for compliant collateral</small>
      </div>

      <div className="device">
        <div className="device-shell">
          <div className="brand-bead">SWAN</div>
          <div className="lcd">
            <div className="lcd-status">
              <span>SWAN-{seed}</span>
              <span className={`mood-chip mood-${mood}`}>{moodLabel(mood)}</span>
              <ConnectButton.Custom>
                {({ account, chain, mounted, openAccountModal, openChainModal, openConnectModal }) => {
                  if (!mounted) return <button className="lcd-link">wallet</button>;
                  if (!account || !chain) {
                    return (
                      <button className="lcd-link" onClick={openConnectModal}>
                        connect
                      </button>
                    );
                  }
                  if (chain.unsupported) {
                    return (
                      <button className="lcd-link" onClick={openChainModal}>
                        network
                      </button>
                    );
                  }
                  return (
                    <button className="lcd-link" onClick={openAccountModal}>
                      {account.displayName}
                    </button>
                  );
                }}
              </ConnectButton.Custom>
            </div>

            <nav className="icon-row" aria-label="Swan menus">
              {SCREENS.map((item) => (
                <button key={item.id} className={screen === item.id ? "on" : ""} onClick={() => setScreen(item.id)}>
                  <b>{item.glyph}</b>
                  <span>{item.label}</span>
                </button>
              ))}
            </nav>

            <div className="lcd-body">
              <section className="pet-stage">
                <SwanPet mood={mood} />
                <p className="pet-line">{petLine(mood, engine.state)}</p>
                <div className="meters">
                  <HeartMeter label="cover" filled={coverageHearts} />
                  <HeartMeter label="feed" filled={hungerHearts} />
                  <HeartMeter label="joy" filled={Math.min(4, happyHearts)} />
                </div>
                <div className={`speech speech-${notice.tone}`}>
                  <b>{notice.tone === "bad" ? "!" : notice.tone === "good" ? "★" : "·"}</b>
                  <span>{notice.text}</span>
                </div>
              </section>

              <section className="lcd-page">
                {screen === "nest" && (
                  <div className="page">
                    <h2>Nest</h2>
                    <p>Keep Swan plump, funded, and home before the clock sings.</p>
                    <div className="stat-grid">
                      <Stat label="cash need" value="$1.00m" hint="30-day repo" />
                      <Stat
                        label="capacity"
                        value={formatUsd(metrics.borrowingCapacity)}
                        hint="after haircuts"
                        tone={metrics.borrowingCapacity >= engine.outstanding ? "good" : "bad"}
                      />
                      <Stat
                        label="cover"
                        value={`${(metrics.coverageBps / 100).toFixed(1)}%`}
                        hint={`${(rules.maintenanceBps / 100).toFixed(0)}% floor`}
                        tone={engine.state === "MARGIN_CALL" ? "warn" : "good"}
                      />
                      <Stat
                        label="rate"
                        value={
                          engine.selectedOffer
                            ? rate(engine.selectedOffer.rateBps)
                            : engine.offers[0]
                              ? rate(engine.offers[0].rateBps)
                              : "—"
                        }
                        hint={engine.selectedOffer?.lenderLabel ?? "waiting"}
                      />
                    </div>
                    <div className="care-row">
                      <label>
                        Age
                        <select
                          value={difficulty}
                          onChange={(event) => startChallenge(event.target.value as ChallengeDifficulty)}
                        >
                          <option value="CADET">Chick</option>
                          <option value="PRO">Swan</option>
                          <option value="EXPERT">Elder</option>
                        </select>
                      </label>
                      <button className="toy" onClick={() => startChallenge()}>
                        new egg
                      </button>
                    </div>
                    <ol className="life-track">
                      {["Stuff nest", "Feed pond", "Swim", "Care", "Home / sale"].map((label, index) => (
                        <li className={phaseIndex(engine) >= index ? "on" : ""} key={label}>
                          <i>{index + 1}</i>
                          {label}
                        </li>
                      ))}
                    </ol>
                    {sessionState !== "PLAYING" && (
                      <div className={`result result-${sessionState.toLowerCase()}`}>
                        <h3>{sessionState === "WON" ? "Swan came home" : "Nest went quiet"}</h3>
                        <p>
                          Grade {score.grade} · {score.total} pts · best {bestScores[difficulty]}
                        </p>
                        <div className="btn-row">
                          <button className="toy" onClick={() => startChallenge(difficulty, seed)}>
                            replay
                          </button>
                          <button className="toy solid" onClick={() => startChallenge()}>
                            hatch again
                          </button>
                        </div>
                      </div>
                    )}
                  </div>
                )}

                {screen === "bonds" && (
                  <div className="page">
                    <h2>Bonds</h2>
                    <p>Pick the smallest nest that still feeds $1.00m.</p>
                    <div className="bond-list">
                      {engine.assets.map((asset) => {
                        const quantity = engine.basket.find((line) => line.assetId === asset.id)?.quantity ?? 0;
                        return (
                          <div className="bond" key={asset.id}>
                            <div>
                              <b>{asset.series}</b>
                              <small>
                                {formatUsd(asset.price)} · {(asset.haircutBps / 100).toFixed(0)}% cut ·{" "}
                                {asset.liquidity.toLowerCase()}
                              </small>
                            </div>
                            <div className="stepper">
                              <button
                                disabled={engine.state !== "DRAFT" || quantity === 0}
                                onClick={() => setQuantity(asset.id, quantity - 1)}
                              >
                                −
                              </button>
                              <em>{quantity}</em>
                              <button
                                disabled={engine.state !== "DRAFT" || quantity === asset.available}
                                onClick={() => setQuantity(asset.id, quantity + 1)}
                              >
                                +
                              </button>
                            </div>
                          </div>
                        );
                      })}
                    </div>
                    <div className="formula">
                      <span>post-haircut feed</span>
                      <b>{formatUsd(metrics.borrowingCapacity)}</b>
                    </div>
                    <div className="btn-row">
                      <button className="toy" onClick={() => startChallenge(difficulty, seed)}>
                        reset
                      </button>
                      {engine.state === "DRAFT" && (
                        <>
                          <button
                            className="toy"
                            onClick={() =>
                              act(() => {
                                engine.optimizeBasket(true);
                                return `Helper stuffed the nest. Efficiency −60.`;
                              })
                            }
                          >
                            auto
                          </button>
                          <button className="toy solid" onClick={runPrimary}>
                            lock nest
                          </button>
                        </>
                      )}
                    </div>
                  </div>
                )}

                {screen === "pond" && (
                  <div className="page">
                    <h2>Pond</h2>
                    <p>
                      {fundingDeadline
                        ? `Feeding window ${formatCountdown(fundingDeadline - clock)}`
                        : engine.state === "FUNDING" || engine.state === "DRAFT"
                          ? `Window ${formatCountdown(rules.fundingWindowSeconds * 1_000)}`
                          : "Pond closed"}
                    </p>
                    <div className="lender-grid">
                      {LENDERS.map((lender) => {
                        const submitted = engine.offers.some((offer) => offer.lenderId === lender.lenderId);
                        return (
                          <button
                            className={`lender ${submitted ? "in" : ""} ${!lender.kycEligible ? "no" : ""}`}
                            disabled={sessionState !== "PLAYING" || engine.state !== "FUNDING" || submitted}
                            key={lender.lenderId}
                            onClick={() =>
                              act(() => {
                                engine.submitOffer(lender);
                                return `${lender.lenderLabel} fed an offer at ${rate(lender.rateBps)}.`;
                              })
                            }
                          >
                            <small>{lender.kycEligible ? "kyc ok" : "no pass"}</small>
                            <b>{lender.lenderLabel}</b>
                            <em>{rate(lender.rateBps)}</em>
                            <span>{submitted ? "fed" : !lender.kycEligible ? "blocked" : "feed"}</span>
                          </button>
                        );
                      })}
                    </div>
                    {engine.state === "FUNDING" && (
                      <div className="btn-row">
                        <span>Lowest valid rate wins.</span>
                        <button className="toy solid" onClick={runPrimary}>
                          close pond
                        </button>
                      </div>
                    )}
                    <div className="mini-list">
                      {engine.offers.length === 0 ? (
                        <div className="empty">No eligible feeds yet.</div>
                      ) : (
                        engine.offers.map((offer) => (
                          <div className="mini-row" key={offer.lenderId}>
                            <span>{offer.lenderLabel}</span>
                            <b>{rate(offer.rateBps)}</b>
                          </div>
                        ))
                      )}
                    </div>
                  </div>
                )}

                {screen === "care" && (
                  <div className="page">
                    <h2>{engine.state === "MARGIN_CALL" ? "Sick swan" : "Care"}</h2>
                    <p>
                      {engine.state === "MARGIN_CALL"
                        ? `Cure in ${formatCountdown((engine.marginDeadline! - Math.floor(clock / 1_000)) * 1_000)}`
                        : engine.state === "ACTIVE"
                          ? "Swan is swimming. Keep snacks and cover ready."
                          : "Lock a nest and feed the pond first."}
                    </p>
                    {(engine.state === "ACTIVE" || engine.state === "MARGIN_CALL") && (
                      <div className="care-grid">
                        <button
                          onClick={() =>
                            act(() => {
                              engine.scheduleCouponEquivalent();
                              return "Coupon snack scheduled.";
                            })
                          }
                          disabled={engine.couponEquivalentScheduled}
                        >
                          <b>{engine.couponEquivalentScheduled ? "★" : "1"}</b>
                          snack
                        </button>
                        <button onClick={shockPrices} disabled={engine.state === "MARGIN_CALL"}>
                          <b>2</b>
                          storm
                        </button>
                        {engine.state === "MARGIN_CALL" && (
                          <>
                            <button onClick={addCollateral}>
                              <b>3</b>
                              feed
                            </button>
                            <button
                              onClick={() =>
                                act(() => {
                                  engine.partialRepay(250_000n);
                                  return "Repaid $250k. Swan feels lighter.";
                                })
                              }
                            >
                              <b>4</b>
                              repay
                            </button>
                            <button onClick={substituteCollateral}>
                              <b>5</b>
                              swap
                            </button>
                            <button
                              className="danger"
                              onClick={() =>
                                act(
                                  () => {
                                    const liquidation = engine.expireMargin(engine.marginDeadline!);
                                    openLiquidationAuction(liquidation.lenderClaim);
                                    finishChallenge("LOST", "Default accepted. Swan entered the sale pond.");
                                    return "Default accepted. Swan entered the sale pond.";
                                  },
                                  "Default failed",
                                  "bad",
                                )
                              }
                            >
                              <b>!</b>
                              default
                            </button>
                          </>
                        )}
                      </div>
                    )}
                    {engine.state === "ACTIVE" && (
                      <div className="btn-row">
                        <span>Pay principal + return, then Swan comes home.</span>
                        <button className="toy solid" disabled={!engine.couponEquivalentScheduled} onClick={runPrimary}>
                          close nest
                        </button>
                      </div>
                    )}
                  </div>
                )}

                {screen === "sale" && (
                  <div className="page">
                    <h2>Sale</h2>
                    {engine.state !== "LIQUIDATION" ? (
                      <p>No recovery sale yet. Swan is still in the nest.</p>
                    ) : (
                      <>
                        <p>Only KYC swans may bid. Settlement stays atomic.</p>
                        <div className="stat-grid">
                          <Stat label="series" value={`${engine.basket.length}`} hint="ATS lines" />
                          <Stat
                            label="claim"
                            value={formatUsd(engine.liquidation!.lenderClaim)}
                            hint={engine.selectedOffer!.lenderLabel}
                          />
                          <Stat
                            label="clock"
                            value={
                              liquidationAuction?.state === "OPEN"
                                ? formatCountdown((liquidationAuction.deadline - Math.floor(clock / 1_000)) * 1_000)
                                : (liquidationAuction?.state.replace(/_/g, " ") ?? "—")
                            }
                            hint="sale window"
                            tone="warn"
                          />
                          <Stat
                            label="high bid"
                            value={formatUsd(liquidationAuction?.bids.at(-1)?.amount ?? 0n)}
                            hint="oracle ref"
                          />
                        </div>
                        {liquidationAuction && (
                          <div className="lender-grid">
                            {(
                              [
                                ["blocked", "Unverified Wallet", 9_200],
                                ["bidder-a", "Atlas Capital", 9_600],
                                ["bidder-b", "Meridian Bank", 10_400],
                              ] as const
                            ).map(([bidderId, label, premiumBps]) => {
                              const submitted = liquidationAuction.bids.some((bid) => bid.bidderId === bidderId);
                              return (
                                <button
                                  key={String(bidderId)}
                                  className={`lender ${submitted ? "in" : ""} ${bidderId === "blocked" ? "no" : ""}`}
                                  disabled={liquidationAuction.state !== "OPEN" || submitted}
                                  onClick={() => bidLiquidation(String(bidderId), Number(premiumBps))}
                                >
                                  <small>{bidderId === "blocked" ? "no kyc" : "kyc ok"}</small>
                                  <b>{label}</b>
                                  <span>
                                    {submitted
                                      ? "bid in"
                                      : formatUsd((liquidationAuction.oraclePrice * BigInt(premiumBps)) / 10_000n)}
                                  </span>
                                </button>
                              );
                            })}
                          </div>
                        )}
                      </>
                    )}
                  </div>
                )}

                {screen === "book" && (
                  <div className="page">
                    <h2>Book</h2>
                    <div className="grade-pill">
                      <b>{score.grade}</b>
                      <span>{score.total} / 1000</span>
                    </div>
                    <Score label="efficiency" value={score.collateralEfficiency} max={300} />
                    <Score label="funding" value={score.fundingQuality} max={250} />
                    <Score label="risk" value={score.riskManagement} max={300} />
                    <Score label="care" value={score.compliance} max={150} />
                    {score.assistancePenalty > 0 && <p className="warn-copy">helper −{score.assistancePenalty}</p>}
                    <div className="checks">
                      <Check label="borrower kyc" value="granted" ok />
                      <Check label="token" value="active" ok />
                      <Check
                        label="feed target"
                        value={metrics.borrowingCapacity >= engine.terms.requiredCash ? "covered" : "hungry"}
                        ok={metrics.borrowingCapacity >= engine.terms.requiredCash}
                      />
                      <Check
                        label="concentration"
                        value={metrics.errors.some((error) => error.includes("concentration")) ? "too full" : "ok"}
                        ok={!metrics.errors.some((error) => error.includes("concentration"))}
                      />
                      <Check
                        label="coupon snack"
                        value={engine.couponEquivalentScheduled ? "scheduled" : "pending"}
                        ok={engine.couponEquivalentScheduled}
                        pending={!engine.couponEquivalentScheduled}
                      />
                    </div>
                    <div className="cash-box">
                      <small>test USDC</small>
                      <b>
                        {usdcSnapshot ? formatUsdc(usdcSnapshot.balance) : liveAccount ? "reading…" : "wallet asleep"}
                      </b>
                      <span>{HEDERA_TESTNET_USDC_TOKEN_ID}</span>
                      <div className="btn-row wrap">
                        <button
                          className="toy"
                          disabled={!liveAccount || Boolean(liveBusy)}
                          onClick={() => void approveLiveUsdc("repo")}
                        >
                          {liveBusy === "repo" ? "…" : "11 USDC nest"}
                        </button>
                        <button
                          className="toy"
                          disabled={!liveAccount || Boolean(liveBusy)}
                          onClick={() => void approveLiveUsdc("auction")}
                        >
                          {liveBusy === "auction" ? "…" : "10 USDC sale"}
                        </button>
                      </div>
                      <a href="https://faucet.circle.com/" target="_blank" rel="noreferrer">
                        faucet
                      </a>
                      {liveEvidence && (
                        <a href={liveEvidence.hashscanUrl} target="_blank" rel="noreferrer">
                          evidence
                        </a>
                      )}
                    </div>
                    <div className="live-console">
                      <div className="live-console-head">
                        <div>
                          <small>hedera testnet</small>
                          <b>Live repo lane</b>
                        </div>
                        <span className={liveAccount ? "ready" : "sleeping"}>{liveAccount ? "linked" : "offline"}</span>
                      </div>
                      <p>{liveReadout}</p>
                      <div className="live-fields">
                        <LiveField
                          className="wide"
                          label="ATS bond EVM address"
                          value={liveForm.security}
                          placeholder="0x…"
                          onChange={(value) => setLiveField("security", value)}
                        />
                        <LiveField
                          label="bond quantity"
                          value={liveForm.quantity}
                          onChange={(value) => setLiveField("quantity", value)}
                        />
                        <LiveField
                          label="decimals"
                          value={liveForm.securityDecimals}
                          onChange={(value) => setLiveField("securityDecimals", value)}
                        />
                        <LiveField
                          label="unit price USDC"
                          value={liveForm.unitPrice}
                          onChange={(value) => setLiveField("unitPrice", value)}
                        />
                        <LiveField
                          label="cash principal"
                          value={liveForm.principal}
                          onChange={(value) => setLiveField("principal", value)}
                        />
                        <LiveField
                          label="repo ID"
                          value={liveForm.repoId}
                          placeholder="created automatically"
                          onChange={(value) => setLiveField("repoId", value)}
                        />
                        <LiveField
                          label="rate %"
                          value={liveForm.ratePercent}
                          onChange={(value) => setLiveField("ratePercent", value)}
                        />
                        <LiveField
                          label="storm unit price"
                          value={liveForm.stormPrice}
                          onChange={(value) => setLiveField("stormPrice", value)}
                        />
                        <LiveField
                          label="coupon USDC"
                          value={liveForm.coupon}
                          onChange={(value) => setLiveField("coupon", value)}
                        />
                        <LiveField
                          className="wide"
                          label="Hedera coupon schedule ID"
                          value={liveForm.scheduleId}
                          placeholder="0.0.xxxxx"
                          onChange={(value) => setLiveField("scheduleId", value)}
                        />
                        <LiveField
                          className="wide"
                          label="scheduled caller (long-zero EVM)"
                          value={liveForm.scheduledCaller}
                          placeholder="0x0000…account number"
                          onChange={(value) => setLiveField("scheduledCaller", value)}
                        />
                        <LiveField
                          label="auction ID"
                          value={liveForm.auctionId}
                          placeholder="created automatically"
                          onChange={(value) => setLiveField("auctionId", value)}
                        />
                        <LiveField
                          label="bid USDC"
                          value={liveForm.bid}
                          onChange={(value) => setLiveField("bid", value)}
                        />
                      </div>

                      <LiveActions title="1 · prepare borrower">
                        <button disabled={!liveAccount || Boolean(liveBusy)} onClick={() => void loadLiveSecurity()}>
                          load bond
                        </button>
                        <button
                          disabled={!liveAccount || Boolean(liveBusy)}
                          onClick={() => void publishLiveSecurityPrice()}
                        >
                          sign price
                        </button>
                        <button
                          disabled={!liveAccount || Boolean(liveBusy)}
                          onClick={() => void approveLiveSecurity("repo")}
                        >
                          approve bond
                        </button>
                        <button disabled={!liveAccount || Boolean(liveBusy)} onClick={() => void requestLiveRepo()}>
                          request repo
                        </button>
                      </LiveActions>

                      <LiveActions title="2 · switch to eligible lender">
                        <button
                          disabled={!liveAccount || Boolean(liveBusy)}
                          onClick={() => void approveLiveUsdc("repo")}
                        >
                          approve USDC
                        </button>
                        <button disabled={!liveAccount || Boolean(liveBusy)} onClick={() => void offerLiveFunding()}>
                          offer rate
                        </button>
                        <button disabled={!liveAccount || Boolean(liveBusy)} onClick={() => void openLiveRepo()}>
                          open after 90s
                        </button>
                        <button disabled={!liveAccount || Boolean(liveBusy)} onClick={() => void readLiveRepo()}>
                          read state
                        </button>
                      </LiveActions>

                      <LiveActions title="3 · risk and remedy">
                        <button disabled={!liveAccount || Boolean(liveBusy)} onClick={() => void shockLiveRepo()}>
                          price storm
                        </button>
                        <button
                          disabled={!liveAccount || Boolean(liveBusy)}
                          onClick={() => void approveLiveSecurity("repo")}
                        >
                          approve top-up
                        </button>
                        <button disabled={!liveAccount || Boolean(liveBusy)} onClick={() => void addLiveCollateral()}>
                          add collateral
                        </button>
                        <button
                          disabled={!liveAccount || Boolean(liveBusy)}
                          onClick={() => void partiallyRepayLiveRepo()}
                        >
                          repay 1 USDC
                        </button>
                        <button disabled={!liveAccount || Boolean(liveBusy)} onClick={() => void declareLiveDefault()}>
                          declare default
                        </button>
                      </LiveActions>

                      <LiveActions title="4 · coupon and close">
                        <button
                          disabled={!liveAccount || Boolean(liveBusy)}
                          onClick={() => void authorizeLiveScheduledCaller()}
                        >
                          authorize caller
                        </button>
                        <button
                          disabled={!liveAccount || Boolean(liveBusy)}
                          onClick={() => void verifyLiveCouponSchedule()}
                        >
                          verify schedule
                        </button>
                        <button disabled={!liveAccount || Boolean(liveBusy)} onClick={() => void payLiveCoupon()}>
                          pay coupon
                        </button>
                        <button
                          disabled={!liveAccount || Boolean(liveBusy)}
                          onClick={() =>
                            void executeLive("repo closed", () =>
                              requireLiveClient().closeRepo(liveEntityId(liveForm.repoId, "Repo ID")),
                            )
                          }
                        >
                          close at 10m
                        </button>
                      </LiveActions>

                      <LiveActions title="5 · compliant sale">
                        <button
                          disabled={!liveAccount || Boolean(liveBusy)}
                          onClick={() => void createLiveLiquidation()}
                        >
                          route default
                        </button>
                        <button
                          disabled={!liveAccount || Boolean(liveBusy)}
                          onClick={() => void approveLiveSecurity("auction")}
                        >
                          approve sale lot
                        </button>
                        <button
                          disabled={!liveAccount || Boolean(liveBusy)}
                          onClick={() => void createLiveVoluntaryAuction()}
                        >
                          voluntary list
                        </button>
                        <button
                          disabled={!liveAccount || Boolean(liveBusy)}
                          onClick={() => void approveLiveUsdc("auction")}
                        >
                          approve bid cash
                        </button>
                        <button disabled={!liveAccount || Boolean(liveBusy)} onClick={() => void bidLiveAuction()}>
                          place bid
                        </button>
                        <button
                          disabled={!liveAccount || Boolean(liveBusy)}
                          onClick={() =>
                            void executeLive("auction closed", () =>
                              requireLiveClient().closeAuction(liveEntityId(liveForm.auctionId, "Auction ID")),
                            )
                          }
                        >
                          close after 90s
                        </button>
                        <button
                          disabled={!liveAccount || Boolean(liveBusy)}
                          onClick={() =>
                            void executeLive("auction settled", () =>
                              requireLiveClient().settleAuction(liveEntityId(liveForm.auctionId, "Auction ID")),
                            )
                          }
                        >
                          settle DvP
                        </button>
                      </LiveActions>
                      <small className="live-note">
                        Switch MetaMask accounts and press link again for borrower, lender, verifier, and bidder roles.
                        The bond and both Swan contracts must be KYC-granted in ATS.
                      </small>
                      {liveHistory.length > 0 && (
                        <div className="live-evidence">
                          {liveHistory.map(({ label, evidence }) => (
                            <a
                              key={evidence.transactionHash}
                              href={evidence.hashscanUrl}
                              target="_blank"
                              rel="noreferrer"
                            >
                              {label} ↗
                            </a>
                          ))}
                        </div>
                      )}
                    </div>
                    <div className="timeline">
                      {[...engine.events]
                        .reverse()
                        .slice(0, 6)
                        .map((event) => (
                          <div key={event.sequence}>
                            <b>{event.type.replace(/_/g, " ").toLowerCase()}</b>
                            <small>{event.detail}</small>
                          </div>
                        ))}
                    </div>
                  </div>
                )}
              </section>
            </div>
          </div>

          <div className="pads">
            <button aria-label="previous menu" onClick={() => cycleScreen(-1)}>
              A
            </button>
            <button aria-label="confirm" className="select" onClick={runPrimary}>
              B
            </button>
            <button aria-label="next menu" onClick={() => cycleScreen(1)}>
              C
            </button>
          </div>
          <p className="pad-hint">A menu · B do · C next</p>
        </div>
      </div>
    </div>
  );
}

function SwanPet({ mood }: { mood: ReturnType<typeof swanMood> }) {
  const faces: Record<typeof mood, { eye: string; beak: string; extra?: string }> = {
    egg: { eye: "·", beak: "v", extra: "zzz" },
    happy: { eye: "•", beak: ">", extra: "♡" },
    hungry: { eye: "•", beak: "o" },
    sick: { eye: "x", beak: "~", extra: "!" },
    sad: { eye: "u", beak: "n" },
    star: { eye: "^", beak: ">", extra: "★" },
  };
  const face = faces[mood];
  return (
    <div className={`swan-pet mood-${mood}`} aria-hidden>
      <div className="swan-body">
        <span className="swan-wing" />
        <span className="swan-neck" />
        <span className="swan-head">
          <i className="eye">{face.eye}</i>
          <i className="beak">{face.beak}</i>
        </span>
        {face.extra && <em className="extra">{face.extra}</em>}
      </div>
      <div className="water" />
    </div>
  );
}

function HeartMeter({ label, filled }: { label: string; filled: number }) {
  return (
    <div className="hearts">
      <small>{label}</small>
      <span>
        {Array.from({ length: 4 }, (_, index) => (
          <i key={index} className={index < filled ? "full" : ""}>
            ♥
          </i>
        ))}
      </span>
    </div>
  );
}

function Stat({
  label,
  value,
  hint,
  tone,
}: {
  label: string;
  value: string;
  hint: string;
  tone?: "good" | "warn" | "bad";
}) {
  return (
    <div className={tone ?? ""}>
      <small>{label}</small>
      <b>{value}</b>
      <span>{hint}</span>
    </div>
  );
}

function Check({ label, value, ok, pending }: { label: string; value: string; ok: boolean; pending?: boolean }) {
  return (
    <div className="check">
      <i className={ok ? "ok" : pending ? "pending" : "fail"}>{ok ? "★" : pending ? "·" : "×"}</i>
      <span>
        <small>{label}</small>
        <b>{value}</b>
      </span>
    </div>
  );
}

function LiveField({
  label,
  value,
  onChange,
  placeholder,
  className,
}: {
  label: string;
  value: string;
  onChange: (value: string) => void;
  placeholder?: string;
  className?: string;
}) {
  return (
    <label className={className}>
      <span>{label}</span>
      <input value={value} placeholder={placeholder} onChange={(event) => onChange(event.target.value)} />
    </label>
  );
}

function LiveActions({ title, children }: { title: string; children: ReactNode }) {
  return (
    <div className="live-actions">
      <b>{title}</b>
      <div>{children}</div>
    </div>
  );
}

function Score({ label, value, max }: { label: string; value: number; max: number }) {
  const cells = 8;
  const filled = Math.round((value / max) * cells);
  return (
    <div className="score-row">
      <span>
        {label} <b>{value}</b>
      </span>
      <i>
        {Array.from({ length: cells }, (_, index) => (
          <em key={index} className={index < filled ? "on" : ""} />
        ))}
      </i>
    </div>
  );
}

function swanMood(engine: RepoEngine, session: SessionState) {
  if (session === "WON") return "star";
  if (session === "LOST" || engine.state === "LIQUIDATION") return "sad";
  if (engine.state === "MARGIN_CALL") return "sick";
  if (engine.state === "FUNDING") return "hungry";
  if (engine.state === "ACTIVE") return "happy";
  return "egg";
}

function moodLabel(mood: ReturnType<typeof swanMood>) {
  return { egg: "egg", happy: "happy", hungry: "hungry", sick: "sick", sad: "sad", star: "star" }[mood];
}

function petLine(mood: ReturnType<typeof swanMood>, state: RepoEngine["state"]) {
  if (mood === "star") return "Swan is glittering.";
  if (mood === "sad") return "The pond went still.";
  if (mood === "sick") return "Swan needs care right now.";
  if (mood === "hungry") return "Feeders are circling.";
  if (mood === "happy") return "Swan is gliding.";
  return state === "DRAFT" ? "An egg is waiting to be stuffed." : "Swan is resting.";
}

function heartsFromBps(coverageBps: number, maintenanceBps: number) {
  if (coverageBps <= 0) return 0;
  if (coverageBps < maintenanceBps) return 1;
  if (coverageBps < maintenanceBps + 800) return 2;
  if (coverageBps < maintenanceBps + 1_600) return 3;
  return 4;
}

function heartsFromCapacity(capacity: bigint, outstanding: bigint) {
  if (outstanding === 0n) return capacity > 0n ? 3 : 1;
  if (capacity >= outstanding) return 4;
  if (capacity * 4n >= outstanding * 3n) return 3;
  if (capacity * 2n >= outstanding) return 2;
  return capacity > 0n ? 1 : 0;
}

function phaseIndex(engine: RepoEngine) {
  if (engine.state === "DRAFT") return 0;
  if (engine.state === "FUNDING") return 1;
  if (engine.state === "ACTIVE") return 2;
  if (engine.state === "MARGIN_CALL") return 3;
  return 4;
}

function formatUsd(value: bigint) {
  return `$${new Intl.NumberFormat("en-US", { notation: value >= 1_000_000n ? "compact" : "standard", maximumFractionDigits: 2 }).format(value)}`;
}
function rate(bps: number) {
  return `${(bps / 100).toFixed(2)}%`;
}
function formatCountdown(milliseconds: number) {
  const seconds = Math.max(0, Math.ceil(milliseconds / 1_000));
  return `${String(Math.floor(seconds / 60)).padStart(2, "0")}:${String(seconds % 60).padStart(2, "0")}`;
}
function newSeed() {
  return Math.floor(1_000 + Math.random() * 8_999);
}
function bidderLabel(bidderId: string) {
  if (bidderId === "bidder-a") return "Atlas Capital";
  if (bidderId === "bidder-b") return "Meridian Bank";
  return "Unverified Wallet";
}
function isRuleError(error: unknown): error is { code: string } {
  return typeof error === "object" && error !== null && "code" in error;
}
function loadBestScores(): BestScores {
  try {
    const stored =
      window.localStorage.getItem("swan.best-scores") ?? window.localStorage.getItem("proofquest.best-scores");
    if (!stored) return { ...EMPTY_BEST_SCORES };
    const parsed = JSON.parse(stored) as Partial<BestScores>;
    return {
      CADET: Number(parsed.CADET ?? 0),
      PRO: Number(parsed.PRO ?? 0),
      EXPERT: Number(parsed.EXPERT ?? 0),
    };
  } catch {
    return { ...EMPTY_BEST_SCORES };
  }
}
