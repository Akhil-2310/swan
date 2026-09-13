# Swan — ATS Collateral & Repo Arena

Swan turns compliant bonds issued with Hedera Asset Tokenization Studio (ATS) into usable collateral. An institution builds a valid bond basket, asks lenders for USDC funding, manages margin and coupon treatment, repurchases the bonds at maturity, or sends defaulted collateral through a KYC-gated recovery auction.

The experience is presented as a virtual-pet strategy game: the collateral basket is the **Nest**, lenders compete in the **Pond**, margin actions keep the Swan healthy in **Care**, liquidation happens in **Sale**, and compliance plus on-chain evidence live in **Book**. The auction is an enforcement and secondary-sale rail—not the core product.

> **Network status:** deployed and verified on Hedera testnet, chain ID `296`. The four Swan-owned Solidity contracts are publicly source-verified through Sourcify. Live configuration, KYC, ATS transfer, and deployment checks also pass. This is unaudited testnet software, not a production financial product.

Swan does **not** use Inco.

## Contents

- [The problem](#the-problem)
- [What Swan delivers](#what-swan-delivers)
- [How the lifecycle works](#how-the-lifecycle-works)
- [Terminology](#terminology)
- [Gamification](#gamification)
- [Architecture](#architecture)
- [Verified testnet deployment](#verified-testnet-deployment)
- [Run locally](#run-locally)
- [Environment configuration](#environment-configuration)
- [Demo with two wallets](#demo-with-two-wallets)
- [One-wallet demo](#one-wallet-demo)
- [Testing and verification](#testing-and-verification)
- [Deploy the frontend to Vercel](#deploy-the-frontend-to-vercel)
- [Repository layout](#repository-layout)
- [Security model and limitations](#security-model-and-limitations)

## The problem

ATS can issue and administer a compliant tokenized bond, but issuance alone does not make the asset useful as collateral. A holder still needs to determine:

- whether borrower, lender, and eventual buyer are eligible;
- how much a mixed bond basket can borrow after haircuts;
- whether one asset exceeds its concentration limit;
- which lender offers the lowest valid repo rate;
- whether a price fall causes a margin call;
- how the borrower can cure the shortfall;
- who receives the economic value of a coupon while collateral is locked;
- how principal, repo return, and collateral move at maturity; and
- how the lender recovers value through a compliant sale after default.

Swan supplies that missing collateral-utilization lifecycle while leaving ATS authoritative for the securities themselves. It follows the real-world direction described by the [BIS next-generation monetary and financial system report](https://www.bis.org/publications/aer-2025/next-generation-monetary-financial-system) and the [ICMA Digital Bonds Annex](https://www.icmagroup.org/News/news-in-brief/icma-publishes-the-digital-bonds-annex-an-addition-to-the-gmra-digital-assets-annex/).

## What Swan delivers

### Collateral Draft

The borrower selects several ATS-issued bonds. Each line has an oracle price, quantity, haircut, and maximum concentration. Swan calculates:

```text
gross value = oracle price × quantity

borrowing capacity = Σ gross value × (1 − haircut)
```

The basket is accepted only when its post-haircut capacity covers the requested principal and every concentration rule is satisfied. The local game also contains an optimizer that searches the fixture inventory for the lowest gross value capable of funding the target.

### Funding Race

Eligible lenders escrow the complete USDC principal and quote a repo rate. The lowest valid rate wins. When the three-minute funding window ends, anyone can open the repo; the winning USDC moves to the borrower and the ATS collateral remains locked in `RepoLifecycle`. Losing lenders withdraw their funded offers independently.

### Margin Sprint

Signed oracle prices continuously determine collateral capacity. If capacity falls below `outstanding principal × maintenance ratio`, the repo enters a margin call with a five-minute cure deadline. The borrower can:

- add more collateral;
- substitute a healthier eligible bond;
- partially repay `0.5 USDC`; or
- do nothing and allow default.

### Coupon and repurchase

A repo transfers legal possession of collateral but normally preserves negotiated economics. Swan therefore requires both verified Hedera schedule evidence and an actual USDC coupon-equivalent payment before healthy maturity close. At maturity, the borrower pays principal plus repo return to the lender and receives every collateral line back atomically.

### Default and secondary auction

An uncured margin call or missed maturity changes the repo to liquidation. The winning lender routes each collateral line into a 90-second compliance auction. Bidders escrow USDC, and ATS eligibility is checked again at bid and settlement. Settlement performs delivery-versus-payment (DvP): the eligible winner receives the bond, the lender is paid first up to its allocated claim, and any surplus returns to the borrower.

The same auction contract also supports a voluntary sale by an ATS holder. This preserves a useful secondary-market exit without turning Swan into another general marketplace.

## How the lifecycle works

```text
ATS bond inventory
       │
       ▼
Collateral Draft ── invalid KYC / pause / freeze / capacity / concentration ──► rejected
       │ valid basket and fresh signed prices
       ▼
Funding Race ── no offers ──► cancel and return collateral
       │ lowest funded eligible rate
       ▼
Active Repo ───────────────────────────────────────────────► maturity close
       │                                                       │
       │ price drop                                            ├─ coupon schedule verified
       ▼                                                       ├─ coupon equivalent paid
Margin Call                                                    ├─ principal + return paid
       ├─ add / substitute / repay ──► Active Repo              └─ collateral returned
       │
       └─ cure deadline missed ──► Default ──► KYC Auction ──► lender-first settlement
```

The live demo uses these short testnet clocks:

| Clock            |    Duration | Purpose                                              |
| ---------------- | ----------: | ---------------------------------------------------- |
| Oracle freshness | 180 seconds | Prevents stale prices from opening a repo or auction |
| Funding race     | 180 seconds | Gives eligible lenders time to fund and quote        |
| Repo maturity    | 600 seconds | Makes the healthy repurchase path demoable           |
| Margin cure      | 300 seconds | Lets the borrower add, substitute, or repay          |
| Auction bidding  |  90 seconds | Makes liquidation and settlement demoable            |

## Terminology

| Term                   | Meaning in Swan                                                                                                                                                        |
| ---------------------- | ---------------------------------------------------------------------------------------------------------------------------------------------------------------------- |
| ATS                    | Hedera Asset Tokenization Studio, the security issuance and compliance layer used for the collateral bonds.                                                            |
| Tokenized bond         | A bond represented by a smart contract/token ledger with balances and transfer controls.                                                                               |
| Repo                   | A repurchase agreement: the borrower receives cash against securities and later repurchases them for principal plus return. Economically it acts like secured funding. |
| Borrower / Wallet A    | The bond holder seeking USDC liquidity. It supplies collateral and must cure margin or close the repo.                                                                 |
| Lender / Wallet B      | The eligible counterparty supplying USDC. It earns the repo return and receives the recovery claim after default.                                                      |
| Principal              | Cash advanced to the borrower; `2.5 USDC` in the default live form.                                                                                                    |
| Repo rate              | Annualized rate quoted in basis points. `410 bps` means `4.10%`; the lowest funded rate wins.                                                                          |
| Collateral             | ATS bonds locked to secure the lender's claim.                                                                                                                         |
| Oracle price           | Signed USDC value per whole bond. The deployed oracle rejects stale, future, replayed, incorrectly signed, or out-of-order observations.                               |
| Haircut                | A risk discount applied to market value. A `20%` haircut gives `80%` borrowing capacity.                                                                               |
| Concentration limit    | Maximum share of gross basket value allowed for one series. It prevents one bond from dominating the basket.                                                           |
| Maintenance ratio      | Minimum capacity relative to outstanding debt after opening. Swan's live form uses `105%`.                                                                             |
| Margin call            | State entered when capacity drops below required maintenance coverage.                                                                                                 |
| Top-up                 | Adding more units of an existing collateral line.                                                                                                                      |
| Substitution           | Replacing one collateral line with another without falling below required coverage.                                                                                    |
| Partial repayment      | Sending some principal directly to the lender, reducing outstanding debt and the required capacity.                                                                    |
| Coupon equivalent      | USDC paid by the lender to preserve the borrower's negotiated coupon economics while the bond is locked.                                                               |
| Maturity / close       | End of the repo. The borrower pays principal plus repo return and receives collateral back.                                                                            |
| Default                | An uncured margin call or missed maturity that makes collateral available for recovery.                                                                                |
| Liquidation waterfall  | Auction proceeds pay the lender's claim first; any excess goes to the borrower.                                                                                        |
| DvP                    | Delivery-versus-payment: bond delivery and USDC settlement occur together in one contract transaction.                                                                 |
| KYC                    | Know Your Customer eligibility. Swan stores request metadata, while ATS remains authoritative for per-bond KYC status.                                                 |
| Pause / freeze         | ATS controls that can stop the entire security or a specific account from transferring. Swan checks them before material movements.                                    |
| Basis point (bps)      | One hundredth of a percent. `100 bps = 1%`.                                                                                                                            |
| Native Hedera schedule | A Hedera Scheduled Transaction used to execute coupon treatment or maturity close at a specified time.                                                                 |
| Long-zero address      | The 20-byte EVM encoding of a Hedera `0.0.N` account number, used when a native schedule calls an EVM contract.                                                        |

## Gamification

The practice arena teaches repo mechanics through decisions with consequences rather than hiding a predetermined answer:

- **Nest:** construct the most capital-efficient valid basket. Manual construction earns the full score; optimizer assistance costs 60 points.
- **Pond:** compare lender eligibility and rates. An unverified desk demonstrates the KYC rejection, while eligible lenders compete on price.
- **Care:** respond to a visible margin countdown using scarce collateral or cash. Every top-up, substitution, and repayment consumes balance-sheet capital.
- **Sale:** recover from failure through a timed, KYC-gated auction and inspect the lender-first waterfall.
- **Difficulty:** Cadet, Pro, and Expert vary shock severity, maintenance requirements, and decision windows.
- **Score:** up to 1,000 points across collateral efficiency, funding quality, risk management, and compliance.
- **Replay:** seeded price scenarios and browser-persisted best scores make outcomes comparable.

The practice game uses deterministic million-dollar fixtures so it is fast and replayable. The panels labelled `live · Hedera testnet` perform real wallet transactions with the deployed contracts, four ATS securities, and native testnet USDC.

## Architecture

```text
React + Vite UI
  ├─ RainbowKit + wagmi + viem       wallet connection and Hedera chain switching
  ├─ @swan/repo                      deterministic game lifecycle and optimizer
  ├─ @swan/auction                   deterministic auction state machine
  ├─ @swan/ats-client                ATS eligibility boundary
  └─ @swan/live + ethers             contract writes, reads, allowances, Mirror Node evidence
                │
                ▼
Hedera testnet (chain 296)
  ├─ SignedPriceOracle               authenticated, fresh, nonce-protected prices
  ├─ RepoLifecycle                   basket, funding, margin, coupon, close, default
  ├─ ComplianceAuction               voluntary/liquidation auction and DvP waterfall
  ├─ KycAccessRegistry               public request queue and reviewer approval
  ├─ ATS security contracts          balance, KYC, pause, freeze, transfer permission
  ├─ native testnet USDC             six-decimal settlement cash
  ├─ Scheduled Transactions          coupon and repurchase automation
  └─ Mirror Node / HashScan          consensus receipts and public audit trail
```

### Contract responsibilities

| Contract            | Responsibility                                                                                                                                                                                                                                      |
| ------------------- | --------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------- |
| `SignedPriceOracle` | Accepts only signer-authorized observations for chain `296`; enforces timestamps, monotonically increasing nonces, low-`s` ECDSA signatures, and a 180-second maximum age. Anyone may relay a valid signature.                                      |
| `RepoLifecycle`     | Escrows multi-series ATS collateral, checks KYC/pause/freeze/transfers, ranks fully funded lender offers, calculates capacity and concentration, handles margin cures, gates coupon treatment, closes repos, and routes defaulted lines to auction. |
| `ComplianceAuction` | Runs voluntary and liquidation auctions, escrows funded bids, rechecks ATS eligibility, requires review for bids outside oracle tolerance, settles security-for-USDC DvP, pays the lender first, and permits loser refunds.                         |
| `KycAccessRegistry` | Lets any wallet request lender, bidder, or both roles. Only the configured reviewer may approve or reject. Approval grants ATS KYC on all four configured bonds without storing identity documents.                                                 |

### Trust boundaries

- ATS is authoritative for security balances, internal KYC, pause, freeze, and transfer permission.
- `SignedPriceOracle` is authoritative for current bond prices; the signing key is an operational trust assumption.
- Circle's native Hedera testnet USDC is the only accepted live cash token.
- The configured reviewer decides whether an access request passed off-chain identity/AML review.
- The configured schedule verifier binds a native Hedera schedule ID to coupon treatment.
- Mirror Node and HashScan expose consensus evidence; local `PQ-xxxx` fixture IDs are not represented as Hedera transactions.

## Verified testnet deployment

### Swan contracts

All four Swan-owned contracts were submitted with Standard JSON compiler input to Sourcify on 13 September 2026. Compiler: Solidity `0.8.28+commit.7893614a`, optimizer enabled with 200 runs, `viaIR: true`, EVM target `paris`.

| Contract          | Hedera ID      | EVM address                                  | Source match             | Public evidence                                                                                                                                                    |
| ----------------- | -------------- | -------------------------------------------- | ------------------------ | ------------------------------------------------------------------------------------------------------------------------------------------------------------------ |
| SignedPriceOracle | `0.0.10523821` | `0x412B2c3bbE07e9198Bc57BfDD697aeb54d481D9E` | creation + runtime exact | [HashScan](https://hashscan.io/testnet/contract/0.0.10523821) · [Sourcify](https://sourcify.dev/server/v2/contract/296/0x412B2c3bbE07e9198Bc57BfDD697aeb54d481D9E) |
| RepoLifecycle     | `0.0.10523822` | `0xeB192A3a7aDc5A5667e600F88963324547a003e7` | creation + runtime exact | [HashScan](https://hashscan.io/testnet/contract/0.0.10523822) · [Sourcify](https://sourcify.dev/server/v2/contract/296/0xeB192A3a7aDc5A5667e600F88963324547a003e7) |
| ComplianceAuction | `0.0.10523825` | `0xE1F425F6669AD43D35fD2b28Bace53d7FEA1B216` | creation + runtime exact | [HashScan](https://hashscan.io/testnet/contract/0.0.10523825) · [Sourcify](https://sourcify.dev/server/v2/contract/296/0xE1F425F6669AD43D35fD2b28Bace53d7FEA1B216) |
| KycAccessRegistry | `0.0.10523103` | `0xE11f893483E85c93900925c63036db827FEf5fdE` | creation + runtime match | [HashScan](https://hashscan.io/testnet/contract/0.0.10523103) · [Sourcify](https://sourcify.dev/server/v2/contract/296/0xE11f893483E85c93900925c63036db827FEf5fdE) |

`exact_match` means the compiled bytecode and metadata match exactly. Sourcify's `match` result for the registry is still a successful source verification but is not labelled exact; the README intentionally preserves that distinction.

### ATS collateral

These are zero-decimal ATS securities created through the starter pack, not invented UI records. Their names and ISINs are demo fixtures, not claims about real issued debt.

| Series  | Hedera ID                                                           | EVM address                                  | Normal / storm price | Haircut | Concentration cap |
| ------- | ------------------------------------------------------------------- | -------------------------------------------- | -------------------: | ------: | ----------------: |
| USTB-28 | [`0.0.10522810`](https://hashscan.io/testnet/contract/0.0.10522810) | `0xd19c20f6ada94055c944631be9cc7bc0aa761387` |   `1.00 / 0.68 USDC` |      2% |               70% |
| GRNB-30 | [`0.0.10522837`](https://hashscan.io/testnet/contract/0.0.10522837) | `0x7753d71fbf47d1b410e5c7b207b7618e2dde8ae9` |   `0.98 / 0.66 USDC` |      8% |               60% |
| MUNI-31 | [`0.0.10522877`](https://hashscan.io/testnet/contract/0.0.10522877) | `0x51ee375fc22e5fd7debad472bd906dd419a027f3` |   `0.95 / 0.64 USDC` |     15% |               55% |
| NSCR-29 | [`0.0.10522929`](https://hashscan.io/testnet/contract/0.0.10522929) | `0x5b04cbcc315291e821a73f94973a6d1ee8bb020b` |   `1.02 / 0.62 USDC` |     20% |               45% |

Swan's live verifier confirms deployed bytecode, decimals, active state, ATS KYC, registry roles, escrow KYC, holder KYC, balance, and borrower-to-repo transfer permission for all four securities. These ATS-generated diamond contracts are not claimed as separate Sourcify source matches by Swan; their implementation belongs to the upstream ATS deployment.

### Settlement token and native schedule proof

- USDC token ID: [`0.0.429274`](https://hashscan.io/testnet/token/0.0.429274)
- Long-zero EVM address: `0x0000000000000000000000000000000000068cda`
- Decimals: `6`
- Test funds: [Circle faucet](https://faucet.circle.com/)
- Verified coupon schedule: [`0.0.10521260`](https://hashscan.io/testnet/schedule/0.0.10521260)
- Verified close schedule: [`0.0.10521264`](https://hashscan.io/testnet/schedule/0.0.10521264)

The scheduled-close proof used distinct borrower and lender accounts, paid the coupon equivalent, closed the repo through a native schedule, returned ATS collateral, and reconciled USDC. Machine-readable records are committed in [`deployments/hedera-testnet.json`](deployments/hedera-testnet.json), [`deployments/verification.json`](deployments/verification.json), and [`deployments/testnet-evidence.json`](deployments/testnet-evidence.json).

## Run locally

### Requirements

- Node.js `22.21.0` (known working with this starter pack)
- npm
- an EVM-compatible wallet such as MetaMask
- Hedera testnet HBAR for transaction fees
- native Hedera testnet USDC for funding/bids

From the monorepo root:

```bash
source ~/.nvm/nvm.sh
nvm use 22.21.0
npm install
npm run swan:test
npm run swan:build
npm run swan:dev
```

Open `http://localhost:4174`.

RainbowKit supports injected browser wallets immediately. Set a WalletConnect project ID only if QR-code/mobile-wallet connections are required.

## Environment configuration

Create local ignored files:

```bash
cp swan/contracts/.env.example swan/contracts/.env
cp swan/apps/web/.env.example swan/apps/web/.env
```

### Frontend variables

Use these values locally and in Vercel:

```dotenv
VITE_REPO_LIFECYCLE_ADDRESS=0xeB192A3a7aDc5A5667e600F88963324547a003e7
VITE_COMPLIANCE_AUCTION_ADDRESS=0xE1F425F6669AD43D35fD2b28Bace53d7FEA1B216
VITE_SIGNED_PRICE_ORACLE_ADDRESS=0x412B2c3bbE07e9198Bc57BfDD697aeb54d481D9E
VITE_KYC_ACCESS_REGISTRY_ADDRESS=0xE11f893483E85c93900925c63036db827FEf5fdE
VITE_USDC_ADDRESS=0x0000000000000000000000000000000000068cda
VITE_MIRROR_NODE_URL=https://testnet.mirrornode.hedera.com/api/v1
VITE_HEDERA_RPC_URL=https://testnet.hashio.io/api
VITE_WALLETCONNECT_PROJECT_ID=
```

The committed deployment manifest supplies the four ATS bond addresses, so the `VITE_ATS_*` variables are optional overrides. `VITE_SCHEDULED_CALLER_ADDRESS` is optional and should be the connected account's long-zero address when demonstrating native scheduled calls.

All `VITE_*` values are public and embedded in the browser bundle. Never put a private key in a `VITE_*` variable.

### Contract/operator variables

The contract environment contains deployer, reviewer, oracle signer, ATS operator, and native-schedule inputs. Start from [`contracts/.env.example`](contracts/.env.example). At minimum, a new deployment needs a funded ECDSA `DEPLOYER_PRIVATE_KEY`; verification of the existing committed deployment does not need redeployment.

Private keys stay only in the ignored `swan/contracts/.env`. Never commit them or add them to Vercel. Public users do not need to appear in an environment file: they request access through Book and the reviewer approves them on-chain.

## Demo with two wallets

Two wallets are recommended because they show a real borrower/lender relationship. Wallet A is the seeded issuer/borrower/compliance reviewer. Wallet B is the lender and eligible auction participant. Associate both with testnet USDC if necessary, then give Wallet B at least `2.55 USDC`: `2.5` for funding plus `0.05` for the coupon. Each approval is capped at `3 USDC`, but an approval is only a spending limit—it does not spend or mint USDC.

### 1. Obtain compliance access

1. Connect Wallet B and switch RainbowKit to Hedera testnet.
2. Open **Book → ATS access passport** and request **both roles**.
3. Switch to Wallet A.
4. In **Book → Compliance queue**, inspect Wallet B and approve it.
5. Switch back to Wallet B and confirm the passport reads **approved**.

The queue is intentionally a mock compliance boundary: it proves reviewer-controlled, auditable access but does not perform real document or AML verification.

### 2. Build and request the repo as Wallet A

1. Open **Bonds** and select the four default bond lines, one unit each.
2. Click **load basket** to read their live decimals/contracts.
3. Click **approve basket** so `RepoLifecycle` can escrow the selected units.
4. Click **sign fresh prices** last. Prices expire after 180 seconds.
5. Leave principal at `2.5 USDC` and click **request repo** immediately.
6. Save the numeric Repo ID displayed by the app. Contract entity IDs are numbers such as `1`, not transaction hashes.

If `INVALID_BASKET` appears, use all four one-unit defaults; a single concentrated line may exceed its configured cap.

### 3. Fund it as Wallet B

1. Open **Pond** and enter the saved Repo ID.
2. Leave offer rate at `4.10%` or choose another positive rate.
3. Click **approve 3 USDC**.
4. Click **offer rate** before the funding timer ends. This escrows the full `2.5 USDC` principal.
5. After 180 seconds from repo request, click **open after 180s**.
6. Click **read state**; it should show `active` and Wallet A should have received the principal.

The UI label “offer rate” is an action, not a value source: the lender types its annualized quote in the adjacent percentage field.

### 4A. Healthy close path

1. In **Care**, create and verify the coupon schedule using the detailed [`docs/testnet-runbook.md`](docs/testnet-runbook.md).
2. Wallet B authorizes its long-zero scheduled caller, approves coupon USDC, and pays the coupon equivalent.
3. Switch to Wallet A after the ten-minute maturity.
4. Approve enough repo cash for principal plus repo return.
5. Authorize Wallet A's long-zero caller if using native scheduled close.
6. Click **close at 10m**, or allow the scheduled transaction to call close.
7. Confirm state `closed`, lender payment, and returned ATS collateral.

### 4B. Margin cure path

1. As Wallet A, click **price storm** in Care.
2. Click **read state** and confirm `margin call`.
3. Cure within five minutes by approving and adding collateral, substituting eligible collateral, or approving repay cash and clicking **repay 0.5 USDC**.
4. Read state again; sufficient coverage returns it to `active`.

USDC allowances are consumed by `transferFrom`. If repayment or close reports a transfer failure, check Wallet A's balance and click the relevant approval again.

### 4C. Default and liquidation path

1. Trigger **price storm** and do not cure it.
2. After the five-minute cure window, click **declare default**.
3. In **Sale**, Wallet A clicks **refresh sale prices**.
4. Switch to Wallet B—the winning lender—and click **route default** within 180 seconds of the price refresh.
5. Save the generated Auction ID. A multi-line basket creates one auction per collateral line; the UI stores the first.
6. For the lowest-faucet two-wallet path, switch to Wallet A, use part of the `2.5 USDC` principal it received, approve bid cash, enter the default `1.05 USDC` bid, and click **place bid**. To have Wallet B act as both lender and bidder instead, fund it with at least `3.60 USDC` before starting (`2.5` principal + `0.05` coupon + `1.05` bid).
7. After 90 seconds, click **close after 90s**, then **settle DvP**.
8. Inspect HashScan/Mirror Node evidence: the bidder receives the ATS bond, lender recovery is paid first, and defined surplus returns to the borrower.

For a voluntary sale, Wallet A instead signs normal market prices, approves one sale lot, and clicks **voluntary list**. The bidder/close/settle steps are the same.

## One-wallet demo

One wallet can act as borrower, lender, reviewer, and bidder if that address has ATS KYC, collateral, and USDC. This is useful for a quick technical walkthrough, but it does not convincingly demonstrate counterparty separation or economic cash movement because transfers may begin and end at the same address. Use two wallets for judging whenever possible.

## Testing and verification

### Full local suite

```bash
npm run swan:test
npm run swan:build
```

This builds and tests the ATS adapter, repo engine/optimizer, live Hedera adapter, auction engine, and Solidity contracts, then compiles the React app.

### Verify deployed behavior

```bash
npm run verify:testnet --workspace=@swan/contracts
```

This read-only check confirms:

- code exists at the oracle, repo, auction, and KYC registry addresses;
- oracle signer/max-age and contract immutable addresses match the manifest;
- RepoLifecycle and ComplianceAuction both use official testnet USDC;
- RepoLifecycle is the auction's liquidation router;
- reviewer, issuer, registry, and ATS KYC roles are correct; and
- all four ATS bonds have code, expected decimals, active status, escrow KYC, holder KYC, balance, and valid transfer permission.

### Reproduce public source verification

```bash
npm run build --workspace=@swan/contracts
npm run verify:sources:testnet --workspace=@swan/contracts
```

The script reads the exact Hardhat build-info referenced by each `.dbg.json`, submits Standard JSON input plus the creation transaction to Sourcify, waits for the job, and confirms the public lookup result. Re-running it is safe: already-verified contracts are detected before submission.

### Optional live smoke proofs

```bash
npm run smoke:auction:testnet --workspace=@swan/contracts
npm run smoke:repo:testnet --workspace=@swan/contracts
npm run smoke:scheduled-close:testnet --workspace=@swan/contracts
```

These commands write testnet transactions and require funded operator/counterparty balances. The scheduled-close smoke creates a temporary ECDSA lender, associates USDC, grants KYC, schedules coupon and close, and records successful evidence.

Official verification references: [Hedera Standard JSON verification](https://docs.hedera.com/api-reference/verify-contracts/verify-contract-standard-json), [Hedera verified-contract lookup](https://docs.hedera.com/api-reference/contract-lookup/get-verified-contract), and [Sourcify API](https://docs.sourcify.dev/docs/api/).

## Deploy the frontend to Vercel

Import the monorepo and keep **Root Directory** at the repository root (`.`), not `swan/apps/web`. The root is required because the web app imports four Swan workspace packages.

The committed [`../vercel.json`](../vercel.json) already defines:

- framework: Vite;
- install: `npm install --package-lock=false --include=optional --legacy-peer-deps --no-audit --no-fund`;
- build: all Swan packages followed by `@swan/web`; and
- output: `swan/apps/web/dist`.

Add the public frontend environment variables from [Environment configuration](#frontend-variables), then redeploy. Do not override the commands in the Vercel dashboard unless necessary; project-level dashboard overrides take precedence over `vercel.json`. Never add contract/operator private keys to Vercel.

## Repository layout

```text
swan/
  apps/web/                         React/Vite game and live Hedera interface
  packages/ats-client/              ATS compliance/eligibility boundary
  packages/repo/                    deterministic lifecycle, rules, scoring, optimizer
  packages/live/                    ethers wallet/contracts/Mirror Node adapter
  packages/auction/                 deterministic voluntary/default auction engine
  contracts/src/                    Swan Solidity contracts and ATS interfaces
  contracts/scripts/                deploy, verify, smoke, oracle, and schedule scripts
  contracts/test/                   contract lifecycle/security tests
  deployments/hedera-testnet.json   contract IDs, EVM addresses, transaction hashes
  deployments/verification.json     compiler and source-verification receipt
  deployments/testnet-evidence.json scheduled coupon/close proof
  docs/architecture.md              lifecycle and trust-boundary design
  docs/ats-integration.md           ATS adapter notes
  docs/testnet-runbook.md            detailed live operations
```

## Security model and limitations

- **Testnet only:** the deployed addresses, fixture prices, short clocks, and USDC are for demonstration.
- **Fictional instruments:** USTB-28, GRNB-30, MUNI-31, NSCR-29, names, ISINs, prices, coupons, and maturities are synthetic fixtures even though their ATS contracts are genuinely deployed.
- **Mock identity review:** the on-chain access queue records requests and reviewer decisions, not identity documents. Production must integrate a regulated KYC/AML provider and reviewer policy.
- **Central operational roles:** oracle signer, compliance reviewer, schedule verifier, ATS issuer, and KYC role holders are trusted. Production needs key management, separation of duties, rotation, and incident controls.
- **Unaudited contracts:** passing tests and public source verification prove reproducibility and deployment configuration, not absence of vulnerabilities.
- **Oracle design:** signed prices are authenticated but do not prove market quality. Production needs a resilient data policy, multiple sources, outage handling, and governance.
- **Auction structure:** each defaulted basket line becomes a separate lot; aggregate recovery and claim allocation depend on all settlements.
- **Allowance model:** ATS bonds and USDC use approvals; users should approve only required amounts and understand remaining allowances.
- **No legal agreement generation:** Swan demonstrates technical repo mechanics but does not replace GMRA documentation, custody arrangements, tax/accounting treatment, or jurisdiction-specific legal analysis.
- **No mainnet value:** do not send mainnet assets or treat the demo as investment advice.

For the complete operational sequence, troubleshooting, schedule commands, and evidence capture, use the [Hedera testnet runbook](docs/testnet-runbook.md).
