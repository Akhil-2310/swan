// SPDX-License-Identifier: Apache-2.0
pragma solidity >=0.8.18 <0.9.0;

import { IATSSecurity } from "./IATSSecurity.sol";
import { ITestCash } from "./ITestCash.sol";

/**
 * @title IRepoAuction
 * @author Asset Tokenization Studio Team
 * @notice Creates a KYC-gated liquidation auction with a lender-first waterfall.
 * @dev RepoLifecycle is the expected caller and remaining liquidation router.
 */
interface IRepoAuction {
    /**
     * @notice Lists a defaulted ATS line for recovery and records waterfall parties.
     * @param security Collateral series being sold.
     * @param cash Cash token used for bids and settlement.
     * @param collateralOwner Account that currently holds the reserved line.
     * @param beneficiary Lender whose claim is paid first.
     * @param surplusRecipient Borrower who receives any excess proceeds.
     * @param lenderClaim Amount owed to the beneficiary from this lot.
     * @param quantity Security units in the lot.
     * @param reservePrice Minimum acceptable bid.
     * @param biddingDeadline Latest time a bid may be funded.
     * @param oraclePrice Reference price used for sanity bounds.
     * @param sanityToleranceBps Allowed deviation from the oracle, in basis points.
     * @return auctionId Identifier of the created auction.
     */
    function createLiquidationAuctionWithWaterfall(
        IATSSecurity security,
        ITestCash cash,
        address collateralOwner,
        address beneficiary,
        address surplusRecipient,
        uint256 lenderClaim,
        uint256 quantity,
        uint256 reservePrice,
        uint256 biddingDeadline,
        uint256 oraclePrice,
        uint16 sanityToleranceBps
    ) external returns (uint256 auctionId);
}

/**
 * @title IApprovableATSSecurity
 * @author Asset Tokenization Studio Team
 * @notice ATS security that also exposes ERC-20 style approval for reservation.
 */
interface IApprovableATSSecurity is IATSSecurity {
    /**
     * @notice Approves a spender to reserve security units.
     * @param spender Account allowed to call `transferFrom`.
     * @param amount Allowance to set, in native token units.
     * @return success True when the allowance was recorded.
     */
    function approve(address spender, uint256 amount) external returns (bool success);
}
