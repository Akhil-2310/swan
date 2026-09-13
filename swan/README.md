# Swan: Virtual Pet for Compliant Collateral

Swan mobilizes ATS-issued bonds as collateral through a virtual-pet repo game. Players construct compliant nests, compete for funding, care for margin and coupon economics, close by repurchase, or route defaulted collateral into a KYC-gated recovery sale.

The auction is a terminal liquidation and voluntary-sale rail—not the product's center. Swan does not use Inco.

## Working vertical slice

- **Collateral Draft:** multi-series ATS inventory, oracle values, per-asset haircuts, coupon and maturity data, liquidity, eligibility, and concentration limits.
- **Basket optimizer:** searches the fixture inventory for the lowest market value that meets the requested post-haircut borrowing capacity.
- **Funding Race:** funded reverse auction in which ATS-eligible lenders compete on repo rate; lowest valid rate wins.
- **Repo opening:** basket locks and the selected lender's native Hedera testnet USDC moves atomically in the contract transaction.
- **Margin Sprint:** oracle repricing, maintenance coverage, cure deadline, collateral top-up, substitution, partial repayment, and default.
- **Coupon and close:** independently verified schedule evidence and actual coupon-equivalent cash movement are required before maturity repurchase releases collateral.
- **Default Auction:** collateral becomes a timed, playable compliance auction; KYC failures are visible, the highest funded bid wins, the lender claim is paid first, and surplus returns to the borrower.
- **Voluntary auction:** the original single-lot secondary sale path remains available through the same auction engine.
- **Signed oracle:** fresh observations are signer-authorized, nonce-protected, and replay-resistant; anyone may relay them.
- **Live adapter:** validates Hedera testnet chain `296`, pins the cash leg to native testnet USDC `0.0.429274`, handles six-decimal amounts and allowances, wraps wallet contract writes, and resolves transaction evidence through Mirror Node.
- **RainbowKit connection:** supplies a wallet modal, automatic account/disconnect synchronization, and one-click switching to Swan's custom Hedera testnet chain through wagmi.
- **Arena score:** grades collateral efficiency, funding quality, risk management, and compliance out of 1,000.
- **Replayable challenges:** seeded bond prices plus Cadet, Pro, and Expert rule sets vary shock severity, maintenance requirements, and decision windows.
- **Real game clocks:** funding closes automatically when its countdown expires; an uncured margin call automatically enters liquidation.
- **Meaningful costs:** optimizer assistance reduces the efficiency score, while collateral additions, substitutions, and repayments consume balance-sheet capital.
- **Challenge results:** successful closing or failure produces a final grade, capital-used result, replay control, and browser-persisted best score per difficulty.
- **Native scheduling:** creates a delayed Hedera `ContractExecuteTransaction` for maturity close with `waitForExpiry=true`.

The arena uses deterministic million-dollar local fixtures and says so in the network badge. The live evidence path is deliberately scaled to a 10 USDC principal because public faucet tokens are limited. Solidity contracts and tests implement the same critical lifecycle, but nothing is represented as Hedera testnet evidence until it has real transaction IDs.

## Run it

Node 22.21 is known to work with the starter pack's Hardhat version.

```bash
source ~/.nvm/nvm.sh
nvm use 22.21.0
npm run swan:test
npm run swan:build
npm run swan:dev
```

Open `http://localhost:4174`.

Installed browser wallets work immediately through RainbowKit. To enable WalletConnect QR codes and mobile wallets, create a free WalletConnect Cloud project and set `VITE_WALLETCONNECT_PROJECT_ID` in `swan/apps/web/.env`; restart the dev server after changing it.

## Demo path

1. Build the basket manually for the best score, or use the assisted optimizer with a 60-point penalty, then open funding.
2. Submit the Unverified Desk offer to demonstrate the lender KYC rejection.
3. Submit Atlas at 4.75% and Meridian at 4.10%, then close the funding race. Meridian wins.
4. Schedule the coupon-equivalent payment.
5. Trigger the −16% oracle shock to start a margin call.
6. Cure with extra collateral, collateral substitution, or a $250,000 partial repayment—or allow the real cure clock to expire.
7. On default, inspect the lender-first liquidation waterfall and KYC auction handoff.

Reset and follow the healthy path to run the scheduled repurchase and collateral return.

## Structure

```text
swan/
  apps/web/                 Repo arena React/Vite app
  packages/ats-client/      ATS eligibility boundary
  packages/repo/            Deterministic repo lifecycle and optimizer
  packages/live/            Hedera wallet, contract and Mirror Node adapter
  packages/auction/         Voluntary/default auction state machine
  contracts/                RepoLifecycle + ComplianceAuction Solidity
  docs/                     Architecture and ATS integration notes
```

## Testnet deployment

Copy `contracts/.env.example` to `contracts/.env`, set a funded Hedera ECDSA key, and run:

```bash
npm run check:testnet --workspace=@swan/contracts
npm run deploy:testnet --workspace=@swan/contracts
npm run swan:ats:seed
npm run verify:testnet --workspace=@swan/contracts
```

The seed command creates or reuses a real ATS bond, grants the required ATS roles and KYC to the holder plus both Swan escrows, and issues demo units. The deployment script pins official Hedera testnet USDC and configures `RepoLifecycle` as the only liquidation router for `ComplianceAuction`.

The deployed testnet IDs and the successful two-counterparty scheduled-close proof are recorded in [`deployments/hedera-testnet.json`](deployments/hedera-testnet.json) and [`deployments/testnet-evidence.json`](deployments/testnet-evidence.json).

Follow the complete [testnet runbook](docs/testnet-runbook.md) for ATS fixture issuance, evidence capture, oracle relay, and scheduled closing.
