# Hedera testnet runbook

## 1. Supply credentials

Create ignored files from the two examples:

```bash
cp swan/contracts/.env.example swan/contracts/.env
cp swan/apps/web/.env.example swan/apps/web/.env
```

The deployment account must be an ECDSA Hedera testnet account with HBAR. Never commit either private key. Validate RPC, chain ID, signer, and balance:

```bash
npm run check:testnet --workspace=@swan/contracts
```

The web app uses RainbowKit with Hedera testnet as its only supported chain. Installed EIP-1193/EIP-6963 browser wallets require no additional configuration. For WalletConnect QR and mobile-wallet support, put a WalletConnect Cloud project ID in `VITE_WALLETCONNECT_PROJECT_ID` inside the ignored `swan/apps/web/.env` file.

## 2. Deploy Swan

```bash
npm run deploy:testnet --workspace=@swan/contracts
```

The deployment order is `SignedPriceOracle → RepoLifecycle → ComplianceAuction`. RepoLifecycle is the auction's immutable liquidation router. Both lifecycle contracts are pinned to native testnet USDC, and the configured compliance reviewer also defaults to the schedule verifier. The committed testnet manifest is the web app's default; environment addresses are optional overrides.

## 3. Prepare ATS collateral

For the reproducible Swan fixture, run:

```bash
npm run swan:ats:seed
npm run swan:kyc:deploy
npm run verify:testnet --workspace=@swan/contracts
```

The seed script is resumable. It creates or reuses the four live arena series—`USTB-28`, `GRNB-30`, `MUNI-31`, and `NSCR-29`—installs the issuer/SSI/KYC roles, registers the issuer, grants ATS KYC to the holder and both escrow contracts, and ensures the holder has 20 units of every bond. The registry deployment then receives the narrowly scoped ATS KYC role on every series. Both commands record addresses in `deployments/hedera-testnet.json`, which the Book screen imports automatically.

Do not put public user wallets in `.env`. After connecting, any wallet can open **Book → ATS access passport** and request repo, bidder, or combined access. Requests are public, but approval is reviewer-only:

1. Wallet B submits **both roles** and waits in the on-chain queue.
2. Switch RainbowKit to the configured compliance wallet (Wallet A).
3. In **Compliance queue**, verify the wallet against the demo's off-chain identity policy and click **approve**.
4. Switch back to Wallet B. Its passport reads **approved** across all four bonds and lender/bidder actions unlock.

The registry stores only the applicant wallet, requested role bits, timestamp, and status. It does not store documents or personally identifiable information. For production, connect approval to a real identity and AML provider; the included queue is the auditable hackathon review boundary.

For a multi-wallet judging demo, the seeded issuer wallet already owns the bonds and acts as borrower/reviewer. Use a second wallet for the competing lender and bidder:

1. Connect the issuer wallet and create at least two fixed-rate bonds.
2. Issue units to the borrower.
3. Grant public participants ATS KYC through Swan's access passport and reviewer queue.
4. Keep one lender/bidder without KYC for the negative path.
5. Approve RepoLifecycle for each basket quantity, or use the ATS clearing workflow after confirming its testnet reclaim semantics.
6. Confirm `paused() == false`, neither side is frozen, and `canTransferFrom` succeeds.
7. For each ATS security, set `SECURITY_ADDRESS` and its six-decimal USDC unit price in `ORACLE_PRICE`, then run `npm run oracle:submit:testnet --workspace=@swan/contracts` immediately before repo entry.

Use Circle's native Hedera testnet USDC instead of deploying a cash token:

- Token ID: `0.0.429274`
- EVM address: `0x0000000000000000000000000000000000068cda`
- Decimals: `6`
- Faucet: [Circle testnet faucet](https://faucet.circle.com/)

Associate each participating wallet with the token before requesting faucet funds if the wallet has no available automatic-association slot. The web app pins this exact token address and exposes explicit allowance transactions for RepoLifecycle and ComplianceAuction.

Keep the live scenario small enough for faucet balances: the Book defaults use a `2.5 USDC` principal (`2_500_000` base units), at most `3 USDC` per approval, one zero-decimal unit from each ATS series, and oracle prices in six-decimal USDC base units per whole bond. The live demo uses a three-minute price-freshness window and a three-minute lender funding window. Approve the basket before signing prices, then request the repo while those prices remain fresh. `MockTestCash` remains only in local contract tests so balances and transfer failures can be controlled deterministically.

## 4. Execute the evidence path

The live journey now follows the product navigation: use **Book** for ATS access and audit evidence, **Bonds** for collateral entry, **Pond** for funding, **Care** for margin/coupon/close, and **Sale** for voluntary or liquidation auctions. The practice game remains above each live lane, while every button inside a `live · Hedera testnet` panel writes to or reads from the deployed contracts.

1. In Bonds, load and approve each bond quantity, publish fresh signed prices, then request the 2.5-USDC multi-series repo and retain the generated Repo ID.
2. Submit one rejected ineligible offer and two eligible funded rates.
3. Advance past the funding deadline and open the repo.
4. Relay fresh repo-specific signed prices that create a margin call.
5. Switch to the borrower, approve RepoLifecycle for repayment cash, and demonstrate a partial-repayment cure. Reapprove before closing because each `transferFrom` consumes allowance.
6. Repeat with a second deal that defaults.
7. In Sale, Wallet A refreshes all security prices at their liquidation values. Within three minutes, Wallet B routes the default into ComplianceAuction. An eligible bidder approves bid cash, bids, then closes and settles after 90 seconds.
8. Query `/api/v1/contracts/results/{ethereumTransactionHash}` for every write and replace local `PQ-xxxx` IDs with Mirror Node consensus evidence.

Automated testnet proofs are available after supplying the required balances:

```bash
npm run smoke:auction:testnet --workspace=@swan/contracts
npm run smoke:repo:testnet --workspace=@swan/contracts
npm run smoke:scheduled-close:testnet --workspace=@swan/contracts
```

The scheduled-close smoke creates a temporary ECDSA lender, explicitly registers its EVM alias, associates it with USDC, grants ATS KYC, and proves the native scheduled coupon and repurchase with distinct counterparties. Successful schedule IDs and execution hashes are saved in `swan/deployments/testnet-evidence.json`.

## 5. Schedule coupon treatment and closing

The lender approves the coupon amount to RepoLifecycle. In Swan's Book screen, enter the lender's long-zero EVM address and click **authorize caller** before creating the native schedule. For account `0.0.N`, the long-zero address is the 20-byte hexadecimal encoding of `N` (for example, `0.0.10499008` is `0x0000000000000000000000000000000000a033c0`). Then schedule and verify the equivalent payment:

```bash
npm run schedule:coupon:testnet --workspace=@swan/contracts
COUPON_SCHEDULE_ID=0.0.x npm run schedule:verify:testnet --workspace=@swan/contracts
```

The verifier transaction binds the Hedera schedule ID to the repo. The scheduled transaction is sent from the lender's long-zero address, while wallet transactions use its ECDSA alias; the explicit authorization binds those identities. When the schedule executes, `payCouponEquivalent` moves real USDC from lender to borrower and marks coupon treatment paid.

The borrower must approve enough USDC for principal plus repo return and authorize its own long-zero scheduled caller in the Book screen. Then set `OPERATOR_ID`, `OPERATOR_PRIVATE_KEY`, `REPO_CONTRACT_ID`, `REPO_ID`, and an ISO `REPO_CLOSE_AT` no more than 62 days away:

```bash
npm run schedule:close:testnet --workspace=@swan/contracts
```

The script creates a Hedera `ContractExecuteTransaction` schedule with `waitForExpiry=true` and prints its schedule ID and Mirror Node URL. `closeRepo` accepts only the borrower alias or the borrower-authorized long-zero scheduled caller.

Hedera documentation: [scheduled transactions](https://docs.hedera.com/hedera/core-concepts/scheduled-transaction), [contract result evidence](https://docs.hedera.com/api-reference/contracts/get-the-contract-result-from-a-contract-on-the-network-for-a-given-transactionid-or-ethereum-transaction-hash).
