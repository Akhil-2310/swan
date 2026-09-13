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

The deployment order is `SignedPriceOracle → RepoLifecycle → ComplianceAuction`. RepoLifecycle is the auction's immutable liquidation router. Both lifecycle contracts are pinned to native testnet USDC, and the configured compliance reviewer also defaults to the schedule verifier. Copy the three output addresses into the web `.env`.

## 3. Prepare ATS collateral

For the reproducible Swan fixture, run:

```bash
npm run swan:ats:seed
npm run verify:testnet --workspace=@swan/contracts
```

The seed script is resumable. It creates or reuses `Swan Treasury 2027` (`SWAN27`), installs the issuer/SSI/KYC roles, registers the issuer, grants ATS KYC to the holder and both escrow contracts, and ensures the holder has 20 bond units.

For a multi-wallet judging demo, repeat the participant preparation in the starter-pack ATS app:

1. Connect the issuer wallet and create at least two fixed-rate bonds.
2. Issue units to the borrower.
3. Grant ATS KYC to the borrower, lenders, bidders, RepoLifecycle, and ComplianceAuction.
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

Keep the live scenario small enough for faucet balances: use a `10 USDC` principal (`10_000_000` base units), zero-decimal ATS bond quantities, and oracle prices in six-decimal USDC base units per whole bond. `MockTestCash` remains only in local contract tests so balances and transfer failures can be controlled deterministically.

## 4. Execute the evidence path

1. Publish fresh signed prices, approve RepoLifecycle for `11 USDC`, then request a 10-USDC multi-series repo and retain the transaction hash.
2. Submit one rejected ineligible offer and two eligible funded rates.
3. Advance past the funding deadline and open the repo.
4. Relay fresh repo-specific signed prices that create a margin call.
5. Demonstrate a cure, then repeat with a second deal that defaults.
6. Refresh the security price, approve ComplianceAuction for each bid, then create and settle its liquidation auctions above one allocated lender claim to prove borrower surplus.
7. Query `/api/v1/contracts/results/{ethereumTransactionHash}` for every write and replace local `PQ-xxxx` IDs with Mirror Node consensus evidence.

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
