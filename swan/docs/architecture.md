# Repo-first architecture

## Lifecycle

```text
DRAFT → FUNDING → ACTIVE ───────────────→ CLOSED
                     │                     repurchase + collateral return
                     └→ MARGIN CALL → ACTIVE
                                      └→ LIQUIDATION → KYC AUCTION
```

`packages/repo` is the deterministic domain layer used by the local arena. `RepoLifecycle.sol` is its on-chain settlement boundary. `ComplianceAuction.sol` remains a reusable voluntary-sale and default-enforcement rail.

## Collateral and funding

For every basket line, borrowing capacity is `oracle price × quantity × (1 − haircut)`. The local optimizer additionally enforces the configured series concentration limit while minimizing gross market value locked. The contract verifies post-haircut capacity, ATS KYC, pause/freeze state, balance, and `canTransferFrom` before reserving every line.

Lenders fund the complete requested cash amount before an offer is valid. Eligible offers rank by lowest repo rate. Opening transfers the winner's cash to the borrower; losing lenders withdraw their escrow independently.

## Margin, coupons, and close

The oracle can reprice any collateral line. Capacity below `outstanding × maintenance ratio` creates a deadline-bound margin call. The borrower can add collateral, substitute a line without reducing maintenance coverage, or partially repay. An uncured call enters liquidation.

Coupon ownership on a token ledger and repo economics are not assumed to be identical. The deal therefore requires an explicit equivalent-payment schedule before close. At maturity, repurchase cash moves to the lender and every ATS line returns to the borrower in one transaction.

## Default waterfall

`RepoLifecycle` is the immutable liquidation router configured in `ComplianceAuction`. It converts a defaulted basket into per-series lots and allocates the lender claim proportionally. Auction settlement pays each allocated lender claim first and sends excess proceeds to the borrower. ATS eligibility is checked again at bid and settlement time.

## Trust boundaries

- ATS remains authoritative for security balances, KYC, pause, freeze, and transfer permission.
- The signed oracle is authoritative for both initial and ongoing prices. Freshness, nonce and signer checks run before its observations can be used.
- Native Hedera testnet USDC (`0.0.429274`, six decimals) represents the live repo cash leg. `MockTestCash` is confined to deterministic contract tests.
- Hedera Scheduled Transactions coordinate coupon-equivalent payment and closing. An independent verifier binds coupon schedule evidence to the repo before scheduled USDC payment can satisfy the closing gate.
- Local `PQ-xxxx` event IDs are deterministic fixture evidence, not Hedera transaction IDs.
