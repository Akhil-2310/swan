// SPDX-License-Identifier: Apache-2.0

import { useEffect, useRef, useState, type ReactNode } from "react";
import { ConnectButton } from "@rainbow-me/rainbowkit";
import { useAccount, useChainId } from "wagmi";
import Landing from "./Landing";
import { DEFAULT_LIVE_BONDS, DEPLOYED_LIVE_ADDRESSES, KYC_ACCESS_REGISTRY_ID, type LiveBondForm } from "./live-bonds";
import { createDemoEngine, type ComplianceAuction, type ComplianceAuctionEngine } from "@swan/auction";
import {
  HEDERA_TESTNET_USDC_TOKEN_ID,
  HEDERA_TESTNET_USDC_ADDRESS,
  LiveSwanClient,
  formatUsdc,
  hashScheduleId,
  parseTokenUnits,
  parseUsdc,
  type LiveAddresses,
  type KycRequest,
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

const configuredLiveAddresses: LiveAddresses = {
  repoLifecycle: import.meta.env.VITE_REPO_LIFECYCLE_ADDRESS || DEPLOYED_LIVE_ADDRESSES.repoLifecycle,
  complianceAuction: import.meta.env.VITE_COMPLIANCE_AUCTION_ADDRESS || DEPLOYED_LIVE_ADDRESSES.complianceAuction,
  signedPriceOracle: import.meta.env.VITE_SIGNED_PRICE_ORACLE_ADDRESS || DEPLOYED_LIVE_ADDRESSES.signedPriceOracle,
  kycAccessRegistry: import.meta.env.VITE_KYC_ACCESS_REGISTRY_ADDRESS || DEPLOYED_LIVE_ADDRESSES.kycAccessRegistry,
  usdc: import.meta.env.VITE_USDC_ADDRESS || HEDERA_TESTNET_USDC_ADDRESS,
};
const LIVE_ADDRESSES: LiveAddresses | null = Object.values(configuredLiveAddresses).every(Boolean)
  ? configuredLiveAddresses
  : null;
const LIVE_REPO_STORAGE_KEY = `swan.live.repo-id.${configuredLiveAddresses.repoLifecycle.toLowerCase()}`;
const LIVE_AUCTION_STORAGE_KEY = `swan.live.auction-id.${configuredLiveAddresses.complianceAuction.toLowerCase()}`;
const LIVE_REPO_ALLOWANCE = parseUsdc("3");
const LIVE_AUCTION_ALLOWANCE = parseUsdc("3");
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
  principal: "2.5",
  ratePercent: "4.10",
  repoId: window.localStorage.getItem(LIVE_REPO_STORAGE_KEY) ?? "",
  auctionId: window.localStorage.getItem(LIVE_AUCTION_STORAGE_KEY) ?? "",
  bid: "1.05",
  coupon: "0.05",
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
  const [kycRequest, setKycRequest] = useState<KycRequest>();
  const [kycQueue, setKycQueue] = useState<KycRequest[]>([]);
  const [isKycReviewer, setIsKycReviewer] = useState(false);
  const [liveEvidence, setLiveEvidence] = useState<TransactionEvidence>();
  const [liveHistory, setLiveHistory] = useState<{ label: string; evidence: TransactionEvidence }[]>([]);
  const [liveBusy, setLiveBusy] = useState<string>();
  const [liveForm, setLiveForm] = useState<LiveForm>(DEFAULT_LIVE_FORM);
  const [liveBonds, setLiveBonds] = useState<LiveBondForm[]>(DEFAULT_LIVE_BONDS);
  const [liveReadout, setLiveReadout] = useState("Connect, then load the four-bond ATS basket.");
  const engine = arena.current;
  const rules = challengeRules(difficulty);
  const metrics = engine.metrics();
  const score = engine.score();
  const mood = swanMood(engine, sessionState);
  const coverageHearts = heartsFromBps(metrics.coverageBps, rules.maintenanceBps);
  const hungerHearts = heartsFromCapacity(metrics.borrowingCapacity, engine.outstanding);
  const happyHearts =
    sessionState === "WON" ? 4 : sessionState === "LOST" ? 0 : engine.offers.length + (engine.selectedOffer ? 1 : 0);
  const liveKycReady = Boolean(kycRequest?.fullyKyc);

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
        setKycRequest(undefined);
        setKycQueue([]);
        setIsKycReviewer(false);
        return;
      }
      // Never leave the previous signer usable while an account or connector
      // change is being synchronized.
      liveClient.current = null;
      setLiveAccount(undefined);
      setUsdcSnapshot(undefined);
      setKycRequest(undefined);
      setKycQueue([]);
      setIsKycReviewer(false);
      if (connectedChainId !== 296) {
        setLiveReadout("Use RainbowKit to switch this wallet to Hedera testnet.");
        return;
      }

      try {
        const walletProvider = (await connector.getProvider({
          chainId: 296,
        })) as Parameters<typeof LiveSwanClient.connect>[0];
        const client = await LiveSwanClient.connect(walletProvider, LIVE_ADDRESSES);
        const [snapshot, access, reviewer] = await Promise.all([
          client.usdcSnapshot(),
          client.kycSnapshot(),
          client.isKycReviewer(),
        ]);
        const queue = reviewer ? await client.kycApplicants() : [];
        if (stale) return;
        liveClient.current = client;
        setLiveAccount(client.account);
        setUsdcSnapshot(snapshot);
        setKycRequest(access);
        setKycQueue(queue);
        setIsKycReviewer(reviewer);
        setLiveReadout(
          access.fullyKyc
            ? `Wallet is ATS KYC approved with ${formatUsdc(snapshot.balance)} test USDC.`
            : `Wallet connected. Request ATS access before transacting.`,
        );
        setNotice({
          tone: access.fullyKyc ? "good" : "neutral",
          text: access.fullyKyc
            ? `Wallet linked and KYC approved across all four ATS bonds.`
            : `Wallet linked. Submit an access request for compliance review.`,
        });
      } catch (error) {
        if (stale) return;
        liveClient.current = null;
        setLiveAccount(undefined);
        setUsdcSnapshot(undefined);
        setKycRequest(undefined);
        setKycQueue([]);
        setIsKycReviewer(false);
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

  async function refreshKyc(client = requireLiveClient()) {
    const [access, reviewer] = await Promise.all([client.kycSnapshot(), client.isKycReviewer()]);
    setKycRequest(access);
    setIsKycReviewer(reviewer);
    setKycQueue(reviewer ? await client.kycApplicants() : []);
  }

  async function requestLiveKyc(roles: 1 | 2 | 3) {
    const result = await executeLive("KYC access requested", () => requireLiveClient().requestKyc(roles));
    if (result) await refreshKyc();
  }

  async function reviewLiveKyc(applicant: string, approve: boolean) {
    const result = await executeLive(approve ? "KYC access approved" : "KYC access rejected", () =>
      approve ? requireLiveClient().approveKyc(applicant) : requireLiveClient().rejectKyc(applicant),
    );
    if (result) await refreshKyc();
  }

  function setLiveField<Key extends keyof LiveForm>(key: Key, value: LiveForm[Key]) {
    setLiveForm((current) => ({ ...current, [key]: value }));
    if (key === "repoId") window.localStorage.setItem(LIVE_REPO_STORAGE_KEY, value);
    if (key === "auctionId") window.localStorage.setItem(LIVE_AUCTION_STORAGE_KEY, value);
  }

  function requireLiveClient(): LiveSwanClient {
    if (!liveClient.current) throw new Error("Connect a Hedera testnet wallet first");
    return liveClient.current;
  }

  function liveEntityId(value: string, label: string): bigint {
    if (!/^\d+$/.test(value)) throw new Error(`${label} must be a numeric on-chain ID`);
    return BigInt(value);
  }

  function liveQuantity(bond: LiveBondForm): bigint {
    const decimals = Number(bond.decimals);
    if (!Number.isInteger(decimals) || decimals < 0 || decimals > 18) {
      throw new Error(`${bond.symbol} decimals must be between 0 and 18`);
    }
    return parseTokenUnits(bond.quantity, decimals);
  }

  function selectedLiveBonds(): LiveBondForm[] {
    const selected = liveBonds.filter((bond) => Number(bond.quantity) > 0);
    if (selected.length === 0) throw new Error("Select at least one ATS bond");
    for (const bond of selected) {
      if (!bond.security) throw new Error(`${bond.symbol} has not been deployed or configured`);
    }
    return selected;
  }

  function liveTotalOracleValue(bond: LiveBondForm): bigint {
    return (parseUsdc(bond.unitPrice) * liveQuantity(bond)) / 10n ** BigInt(Number(bond.decimals));
  }

  function setLiveBondField(
    id: string,
    key: "security" | "decimals" | "quantity" | "unitPrice" | "stormPrice",
    value: string,
  ) {
    setLiveBonds((current) => current.map((bond) => (bond.id === id ? { ...bond, [key]: value } : bond)));
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
      const message = readableLiveError(error, `${label} failed`);
      setLiveReadout(message);
      setNotice({ tone: "bad", text: message });
      return undefined;
    } finally {
      setLiveBusy(undefined);
    }
  }

  async function loadLiveSecurities() {
    try {
      setLiveBusy("load securities");
      const client = requireLiveClient();
      const selected = selectedLiveBonds();
      const loaded = await Promise.all(
        selected.map(async (bond) => ({ id: bond.id, decimals: await client.securityDecimals(bond.security) })),
      );
      setLiveBonds((current) =>
        current.map((bond) => {
          const result = loaded.find((item) => item.id === bond.id);
          return result ? { ...bond, decimals: String(result.decimals) } : bond;
        }),
      );
      setLiveReadout(`${loaded.length} ATS bonds loaded and ready.`);
      setNotice({ tone: "good", text: "Live ATS basket loaded. Approve it first, then publish fresh prices last." });
    } catch (error) {
      const message = error instanceof Error ? error.message : "Could not load the ATS basket";
      setLiveReadout(message);
      setNotice({ tone: "bad", text: message });
    } finally {
      setLiveBusy(undefined);
    }
  }

  async function publishLiveSecurityPrices() {
    const result = await executeLive("signed basket prices", async () => {
      const client = requireLiveClient();
      let evidence: TransactionEvidence | undefined;
      for (const bond of selectedLiveBonds()) {
        evidence = await client.publishSecurityPrice(bond.security, parseUsdc(bond.unitPrice));
      }
      if (!evidence) throw new Error("No ATS prices were submitted");
      return evidence;
    });
    if (result) {
      setLiveReadout("All four prices are fresh. Request the repo now, before the 180-second oracle window expires.");
      setNotice({ tone: "good", text: "Fresh prices confirmed. Click request repo immediately." });
    }
  }

  async function approveLiveSecurities(target: "repo" | "auction") {
    await executeLive(`${target} basket approval`, async () => {
      const client = requireLiveClient();
      let evidence: TransactionEvidence | undefined;
      for (const bond of selectedLiveBonds()) {
        const quantity = liveQuantity(bond);
        evidence =
          target === "repo"
            ? await client.approveSecurity(bond.security, quantity)
            : await client.approveSecurityForAuction(bond.security, quantity);
      }
      if (!evidence) throw new Error("No ATS approvals were submitted");
      return evidence;
    });
  }

  async function requestLiveRepo() {
    await executeLive("repo requested", async () => {
      const now = BigInt(Math.floor(Date.now() / 1_000));
      const result = await requireLiveClient().requestRepo({
        principal: parseUsdc(liveForm.principal),
        fundingDeadline: now + 180n,
        maturity: now + 600n,
        maintenanceBps: 10_500,
        basket: selectedLiveBonds().map((bond) => ({
          security: bond.security,
          quantity: liveQuantity(bond),
          oraclePrice: parseUsdc(bond.unitPrice),
          haircutBps: bond.haircutBps,
          maxConcentrationBps: bond.maxConcentrationBps,
        })),
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

  async function reclaimLiveRepo() {
    await executeLive("expired repo reclaimed", () =>
      requireLiveClient().reclaimUnfundedRepo(liveEntityId(liveForm.repoId, "Repo ID")),
    );
  }

  async function shockLiveRepo() {
    await executeLive("margin price applied", async () => {
      const client = requireLiveClient();
      const repoId = liveEntityId(liveForm.repoId, "Repo ID");
      let evidence: TransactionEvidence | undefined;
      for (const [index, bond] of selectedLiveBonds().entries()) {
        evidence = await client.publishRepoPrice(repoId, BigInt(index), parseUsdc(bond.stormPrice));
      }
      if (!evidence) throw new Error("No margin prices were submitted");
      return evidence;
    });
  }

  async function addLiveCollateral() {
    await executeLive("collateral added", () => {
      const first = selectedLiveBonds()[0];
      return requireLiveClient().addCollateral(
        liveEntityId(liveForm.repoId, "Repo ID"),
        0n,
        parseTokenUnits("1", Number(first.decimals)),
      );
    });
  }

  async function partiallyRepayLiveRepo() {
    await executeLive("partial repayment", async () => {
      const client = requireLiveClient();
      const amount = parseUsdc("0.5");
      const cash = await client.usdcSnapshot();
      if (cash.balance < amount) throw new Error("Wallet A needs at least 0.5 USDC to cure this margin call");
      if (cash.repoAllowance < amount) {
        throw new Error("APPROVAL_REQUIRED: Wallet A must click approve repay cash before repaying");
      }
      return client.partiallyRepay(liveEntityId(liveForm.repoId, "Repo ID"), amount);
    });
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

  async function publishLiveLiquidationPrices() {
    const result = await executeLive("fresh liquidation prices", async () => {
      const client = requireLiveClient();
      let evidence: TransactionEvidence | undefined;
      for (const bond of selectedLiveBonds()) {
        evidence = await client.publishSecurityPrice(bond.security, parseUsdc(bond.stormPrice));
      }
      if (!evidence) throw new Error("No liquidation prices were submitted");
      return evidence;
    });
    if (result) {
      setLiveReadout("Liquidation prices are fresh. Switch to Wallet B and route the default within three minutes.");
    }
  }

  async function publishLiveVoluntaryPrices() {
    const result = await executeLive("fresh voluntary-sale prices", async () => {
      const client = requireLiveClient();
      let evidence: TransactionEvidence | undefined;
      for (const bond of selectedLiveBonds()) {
        evidence = await client.publishSecurityPrice(bond.security, parseUsdc(bond.unitPrice));
      }
      if (!evidence) throw new Error("No voluntary-sale prices were submitted");
      return evidence;
    });
    if (result) setLiveReadout("Market prices are fresh. Approve the sale lot and list it within three minutes.");
  }

  async function createLiveVoluntaryAuction() {
    await executeLive("voluntary auction", async () => {
      const bond = selectedLiveBonds()[0];
      const oracleValue = liveTotalOracleValue(bond);
      const result = await requireLiveClient().createVoluntaryAuction({
        security: bond.security,
        quantity: liveQuantity(bond),
        reservePrice: (oracleValue * 9n) / 10n,
        biddingDeadline: BigInt(Math.floor(Date.now() / 1_000) + 90),
        oraclePrice: oracleValue,
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
                    <div className="practice-score">
                      <div className="grade-pill">
                        <b>{score.grade}</b>
                        <span>{score.total} / 1000</span>
                      </div>
                      <div>
                        <Score label="efficiency" value={score.collateralEfficiency} max={300} />
                        <Score label="funding" value={score.fundingQuality} max={250} />
                        <Score label="risk" value={score.riskManagement} max={300} />
                        <Score label="care" value={score.compliance} max={150} />
                      </div>
                    </div>
                    {score.assistancePenalty > 0 && <p className="warn-copy">helper −{score.assistancePenalty}</p>}
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
                    <p>Pick the smallest nest that still feeds $1.00m. Every symbol is live on Hedera testnet.</p>
                    <div className="bond-list">
                      {engine.assets.map((asset) => {
                        const quantity = engine.basket.find((line) => line.assetId === asset.id)?.quantity ?? 0;
                        const liveBond = liveBonds.find((bond) => bond.id === asset.id);
                        return (
                          <div className="bond" key={asset.id}>
                            <div>
                              <b>{asset.series}</b>
                              <small>
                                {formatUsd(asset.price)} · {(asset.haircutBps / 100).toFixed(0)}% cut ·{" "}
                                {asset.liquidity.toLowerCase()}
                              </small>
                              {liveBond?.contractId && (
                                <a
                                  className="bond-testnet"
                                  href={`https://hashscan.io/testnet/contract/${liveBond.contractId}`}
                                  target="_blank"
                                  rel="noreferrer"
                                >
                                  testnet {liveBond.contractId} ↗
                                </a>
                              )}
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
                    <LiveLane title="Collateral draft" account={liveAccount} readout={liveReadout}>
                      <div className="live-fields">
                        <div className="live-basket">
                          {liveBonds.map((bond) => (
                            <div className="live-bond" key={bond.id}>
                              <div className="live-bond-head">
                                <b>{bond.symbol}</b>
                                <span>
                                  {(bond.haircutBps / 100).toFixed(0)}% cut · {bond.maxConcentrationBps / 100}% max
                                </span>
                              </div>
                              <div className="live-bond-values two">
                                <LiveField
                                  label="quantity"
                                  value={bond.quantity}
                                  onChange={(value) => setLiveBondField(bond.id, "quantity", value)}
                                />
                                <LiveField
                                  label="price USDC"
                                  value={bond.unitPrice}
                                  onChange={(value) => setLiveBondField(bond.id, "unitPrice", value)}
                                />
                              </div>
                              {bond.contractId && (
                                <a
                                  className="bond-testnet"
                                  href={`https://hashscan.io/testnet/contract/${bond.contractId}`}
                                  target="_blank"
                                  rel="noreferrer"
                                >
                                  ATS {bond.contractId} ↗
                                </a>
                              )}
                            </div>
                          ))}
                        </div>
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
                      </div>
                      <LiveActions title="Wallet A · borrower">
                        <button disabled={!liveAccount || Boolean(liveBusy)} onClick={() => void loadLiveSecurities()}>
                          load basket
                        </button>
                        <button
                          disabled={!liveAccount || Boolean(liveBusy)}
                          onClick={() => void approveLiveSecurities("repo")}
                        >
                          approve basket
                        </button>
                        <button
                          disabled={!liveAccount || Boolean(liveBusy)}
                          onClick={() => void publishLiveSecurityPrices()}
                        >
                          sign fresh prices
                        </button>
                        <button disabled={!liveKycReady || Boolean(liveBusy)} onClick={() => void requestLiveRepo()}>
                          request repo
                        </button>
                      </LiveActions>
                    </LiveLane>
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
                    <LiveLane title="Funding race" account={liveAccount} readout={liveReadout}>
                      <div className="live-fields">
                        <LiveField
                          label="repo ID"
                          value={liveForm.repoId}
                          placeholder="from Bonds"
                          onChange={(value) => setLiveField("repoId", value)}
                        />
                        <LiveField
                          label="offer rate %"
                          value={liveForm.ratePercent}
                          onChange={(value) => setLiveField("ratePercent", value)}
                        />
                      </div>
                      <LiveActions title="Wallet B · eligible lender">
                        <button
                          disabled={!liveAccount || Boolean(liveBusy)}
                          onClick={() => void approveLiveUsdc("repo")}
                        >
                          approve 3 USDC
                        </button>
                        <button disabled={!liveKycReady || Boolean(liveBusy)} onClick={() => void offerLiveFunding()}>
                          offer rate
                        </button>
                        <button disabled={!liveKycReady || Boolean(liveBusy)} onClick={() => void openLiveRepo()}>
                          open after 3m
                        </button>
                        <button disabled={!liveAccount || Boolean(liveBusy)} onClick={() => void readLiveRepo()}>
                          read state
                        </button>
                      </LiveActions>
                      <LiveActions title="Wallet A · no-offer recovery">
                        <button disabled={!liveKycReady || Boolean(liveBusy)} onClick={() => void reclaimLiveRepo()}>
                          reclaim expired
                        </button>
                      </LiveActions>
                      <small className="live-note">
                        Switch to Wallet B before approving cash. If no lender offers, Wallet A reclaims the basket
                        after the window.
                      </small>
                    </LiveLane>
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
                    <LiveLane title="Margin and maturity" account={liveAccount} readout={liveReadout}>
                      <div className="live-fields">
                        <LiveField
                          label="repo ID"
                          value={liveForm.repoId}
                          placeholder="from Bonds"
                          onChange={(value) => setLiveField("repoId", value)}
                        />
                        <LiveField
                          label="coupon USDC"
                          value={liveForm.coupon}
                          onChange={(value) => setLiveField("coupon", value)}
                        />
                        <div className="live-basket compact">
                          {liveBonds.map((bond) => (
                            <div className="live-bond" key={bond.id}>
                              <div className="live-bond-head">
                                <b>{bond.symbol}</b>
                                <LiveField
                                  label="storm price"
                                  value={bond.stormPrice}
                                  onChange={(value) => setLiveBondField(bond.id, "stormPrice", value)}
                                />
                              </div>
                            </div>
                          ))}
                        </div>
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
                      </div>
                      <LiveActions title="Margin call · Wallet A">
                        <button disabled={!liveAccount || Boolean(liveBusy)} onClick={() => void shockLiveRepo()}>
                          price storm
                        </button>
                        <button
                          disabled={!liveAccount || Boolean(liveBusy)}
                          onClick={() => void approveLiveSecurities("repo")}
                        >
                          approve top-up
                        </button>
                        <button disabled={!liveAccount || Boolean(liveBusy)} onClick={() => void addLiveCollateral()}>
                          add collateral
                        </button>
                        <button
                          disabled={!liveAccount || Boolean(liveBusy)}
                          onClick={() => void approveLiveUsdc("repo")}
                        >
                          approve repay cash
                        </button>
                        <button
                          disabled={!liveAccount || Boolean(liveBusy)}
                          onClick={() => void partiallyRepayLiveRepo()}
                        >
                          repay 0.5 USDC
                        </button>
                        <button disabled={!liveAccount || Boolean(liveBusy)} onClick={() => void declareLiveDefault()}>
                          declare default
                        </button>
                      </LiveActions>
                      <LiveActions title="Coupon and close · Wallet B → Wallet A">
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
                          onClick={() => void approveLiveUsdc("repo")}
                        >
                          approve close cash
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
                    </LiveLane>
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
                    <LiveLane title="Compliant secondary auction" account={liveAccount} readout={liveReadout}>
                      <div className="live-fields">
                        <LiveField
                          label="repo ID"
                          value={liveForm.repoId}
                          placeholder="for liquidation"
                          onChange={(value) => setLiveField("repoId", value)}
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
                      <LiveActions title="Default sale · Wallet A then Wallet B">
                        <button
                          disabled={!liveAccount || Boolean(liveBusy)}
                          onClick={() => void publishLiveLiquidationPrices()}
                        >
                          refresh sale prices
                        </button>
                        <button
                          disabled={!liveAccount || Boolean(liveBusy)}
                          onClick={() => void createLiveLiquidation()}
                        >
                          route default
                        </button>
                      </LiveActions>
                      <LiveActions title="Voluntary sale · Wallet A">
                        <button
                          disabled={!liveAccount || Boolean(liveBusy)}
                          onClick={() => void publishLiveVoluntaryPrices()}
                        >
                          sign market prices
                        </button>
                        <button
                          disabled={!liveAccount || Boolean(liveBusy)}
                          onClick={() => void approveLiveSecurities("auction")}
                        >
                          approve sale lot
                        </button>
                        <button
                          disabled={!liveAccount || Boolean(liveBusy)}
                          onClick={() => void createLiveVoluntaryAuction()}
                        >
                          voluntary list
                        </button>
                      </LiveActions>
                      <LiveActions title="Eligible bidder">
                        <button
                          disabled={!liveAccount || Boolean(liveBusy)}
                          onClick={() => void approveLiveUsdc("auction")}
                        >
                          approve bid cash
                        </button>
                        <button disabled={!liveKycReady || Boolean(liveBusy)} onClick={() => void bidLiveAuction()}>
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
                    </LiveLane>
                  </div>
                )}

                {screen === "book" && (
                  <div className="page">
                    <h2>Book</h2>
                    <p>Compliance access, deployed contracts, and immutable transaction receipts.</p>
                    <div className="kyc-box">
                      <div className="kyc-head">
                        <div>
                          <small>ATS access passport</small>
                          <b>{liveKycReady ? "approved" : (kycRequest?.status.toLowerCase() ?? "connect wallet")}</b>
                        </div>
                        <i className={liveKycReady ? "ok" : kycRequest?.status === "PENDING" ? "pending" : "fail"}>
                          {liveKycReady ? "★" : kycRequest?.status === "PENDING" ? "…" : "×"}
                        </i>
                      </div>
                      <p>
                        One approval covers USTB, GRNB, MUNI and NSCR. The registry stores only your wallet and
                        requested roles—no identity documents.
                      </p>
                      {!liveKycReady && kycRequest?.status !== "PENDING" && (
                        <div className="btn-row wrap">
                          <button
                            className="toy"
                            disabled={!liveAccount || Boolean(liveBusy)}
                            onClick={() => void requestLiveKyc(1)}
                          >
                            repo access
                          </button>
                          <button
                            className="toy"
                            disabled={!liveAccount || Boolean(liveBusy)}
                            onClick={() => void requestLiveKyc(2)}
                          >
                            bidder access
                          </button>
                          <button
                            className="toy solid"
                            disabled={!liveAccount || Boolean(liveBusy)}
                            onClick={() => void requestLiveKyc(3)}
                          >
                            both roles
                          </button>
                        </div>
                      )}
                      {kycRequest?.status === "PENDING" && !liveKycReady && (
                        <span className="kyc-waiting">Request submitted. Ask the compliance wallet to approve it.</span>
                      )}
                      {KYC_ACCESS_REGISTRY_ID && (
                        <a
                          href={`https://hashscan.io/testnet/contract/${KYC_ACCESS_REGISTRY_ID}`}
                          target="_blank"
                          rel="noreferrer"
                        >
                          registry {KYC_ACCESS_REGISTRY_ID} ↗
                        </a>
                      )}
                      {isKycReviewer && (
                        <div className="kyc-review">
                          <b>Compliance queue</b>
                          {kycQueue.filter((request) => request.status === "PENDING").length === 0 ? (
                            <span>No pending wallets.</span>
                          ) : (
                            kycQueue
                              .filter((request) => request.status === "PENDING")
                              .map((request) => (
                                <div className="kyc-applicant" key={request.applicant}>
                                  <span>
                                    <b>{shortWallet(request.applicant)}</b>
                                    <small>{kycRoleLabel(request.roles)}</small>
                                  </span>
                                  <div>
                                    <button
                                      disabled={Boolean(liveBusy)}
                                      onClick={() => void reviewLiveKyc(request.applicant, false)}
                                    >
                                      reject
                                    </button>
                                    <button
                                      disabled={Boolean(liveBusy)}
                                      onClick={() => void reviewLiveKyc(request.applicant, true)}
                                    >
                                      approve
                                    </button>
                                  </div>
                                </div>
                              ))
                          )}
                        </div>
                      )}
                    </div>
                    <div className="cash-box">
                      <small>test USDC</small>
                      <b>
                        {usdcSnapshot ? formatUsdc(usdcSnapshot.balance) : liveAccount ? "reading…" : "wallet asleep"}
                      </b>
                      <span>{HEDERA_TESTNET_USDC_TOKEN_ID}</span>
                      <a href="https://faucet.circle.com/" target="_blank" rel="noreferrer">
                        faucet
                      </a>
                      {liveEvidence && (
                        <a href={liveEvidence.hashscanUrl} target="_blank" rel="noreferrer">
                          evidence
                        </a>
                      )}
                    </div>
                    {LIVE_ADDRESSES && (
                      <div className="contract-box">
                        <b>Deployed on Hedera testnet</b>
                        {[
                          ["Repo lifecycle", LIVE_ADDRESSES.repoLifecycle],
                          ["Compliance auction", LIVE_ADDRESSES.complianceAuction],
                          ["Signed price oracle", LIVE_ADDRESSES.signedPriceOracle],
                          ["KYC access registry", LIVE_ADDRESSES.kycAccessRegistry],
                        ].map(([label, address]) => (
                          <a
                            key={label}
                            href={`https://hashscan.io/testnet/contract/${address}`}
                            target="_blank"
                            rel="noreferrer"
                          >
                            <span>{label}</span>
                            <b>{shortWallet(address)}</b>
                            <small>HashScan ↗</small>
                          </a>
                        ))}
                        <span className="contract-note">4 ATS bonds · native testnet USDC · chain 296</span>
                      </div>
                    )}
                    <div className="evidence-book">
                      <div>
                        <small>immutable audit trail</small>
                        <b>Transaction receipts</b>
                      </div>
                      {liveHistory.length === 0 ? (
                        <span>No transactions in this browser session yet.</span>
                      ) : (
                        <div className="live-evidence">
                          {liveHistory.map(({ label, evidence }) => (
                            <a
                              key={evidence.transactionHash}
                              href={evidence.hashscanUrl}
                              target="_blank"
                              rel="noreferrer"
                            >
                              {label} · block {evidence.blockNumber} ↗
                            </a>
                          ))}
                        </div>
                      )}
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

function LiveLane({
  title,
  account,
  readout,
  children,
}: {
  title: string;
  account?: string;
  readout: string;
  children: ReactNode;
}) {
  return (
    <div className="live-console">
      <div className="live-console-head">
        <div>
          <small>live · hedera testnet</small>
          <b>{title}</b>
        </div>
        <span className={account ? "ready" : "sleeping"}>{account ? "linked" : "offline"}</span>
      </div>
      <p>{readout}</p>
      {children}
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
function shortWallet(address: string) {
  return `${address.slice(0, 6)}…${address.slice(-4)}`;
}
function kycRoleLabel(roles: number) {
  if (roles === 3) return "repo participant + bidder";
  if (roles === 2) return "auction bidder";
  return "repo participant";
}
function isRuleError(error: unknown): error is { code: string } {
  return typeof error === "object" && error !== null && "code" in error;
}
function readableLiveError(error: unknown, fallback: string) {
  const message = error instanceof Error ? error.message : fallback;
  if (message.includes("0x19abf40e")) {
    return "ORACLE_PRICE_EXPIRED: sign fresh prices, then request the repo within 180 seconds.";
  }
  if (message.includes("0x8756c20d")) {
    return "ORACLE_FUTURE_PRICE: restart Swan so price signing uses Hedera consensus time.";
  }
  if (message.includes("0x756688fe")) {
    return "ORACLE_NONCE_CHANGED: another price was submitted; sign the four prices again.";
  }
  if (message.includes("0x8baa579f")) {
    return "ORACLE_SIGNER_REQUIRED: switch to the configured price-signer wallet.";
  }
  return message;
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
