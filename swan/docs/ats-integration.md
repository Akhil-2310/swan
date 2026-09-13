# ATS integration map

Swan uses the smallest interface that matches ATS v8 facets in this monorepo.

| Swan check/action                   | ATS v8 facet/API                                                                       |
| ----------------------------------- | -------------------------------------------------------------------------------------- |
| Available units                     | `IBalanceTracker.balanceOf(account)`                                                   |
| Internal/external pause aggregation | `IPause.paused()`                                                                      |
| Address or partial freeze           | `IFreeze.isFrozen(account)`                                                            |
| KYC eligibility                     | `IKyc.getKycStatusFor(account)`                                                        |
| Explainable transfer preflight      | `IComplianceFacet.canTransferFrom(from, to, value, data)`                              |
| Reserve/settle basket lines         | `ITransfer.transferFrom` / `ITransfer.transfer`                                        |
| Clearing alternative                | `IClearingByPartition.clearingTransferFromByPartition` and approval/reclaim operations |

The TypeScript adapter in `packages/ats-client` intentionally exposes these concepts without coupling auction policy to wallet setup. It can be backed by ATS SDK request classes (`GetKycStatusForRequest`, `PauseRequest`, balance queries, and clearing requests) or direct ethers reads.

## Testnet sequence

1. Create or load one ATS bond and activate KYC.
2. Grant KYC to the borrower, eligible lenders/bidders, RepoLifecycle, and ComplianceAuction addresses.
3. Keep one lender and one bidder without KYC as negative fixtures.
4. Issue several bond series to the borrower and approve or clear the chosen quantities into RepoLifecycle.
5. Associate eligible lenders with native Hedera testnet USDC `0.0.429274`, fund them from Circle's testnet faucet, and approve RepoLifecycle for the scaled live principal.
6. Open the reverse auction, select the lowest funded rate, reprice collateral, cure or default, and exercise closing/liquidation.
7. For default, settle one auction above the allocated lender claim and verify borrower surplus.
8. Read balances, events, and rejected transaction results from Mirror Node and attach those real transaction IDs to the UI timeline.

No UI event is labeled testnet evidence until it has a real transaction identifier.
