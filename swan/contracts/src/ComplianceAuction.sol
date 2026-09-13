// SPDX-License-Identifier: Apache-2.0
pragma solidity >=0.8.18 <0.9.0;

import { IATSSecurity } from "./interfaces/IATSSecurity.sol";
import { ITestCash } from "./interfaces/ITestCash.sol";
import { IPriceOracle } from "./interfaces/IPriceOracle.sol";

/**
 * @title ComplianceAuction
 * @author Asset Tokenization Studio Team
 * @notice Runs KYC-gated voluntary and liquidation auctions with atomic security-for-cash DvP.
 * @dev Liquidation lots pay the lender claim first and return surplus to the borrower.
 */
contract ComplianceAuction {
    enum AuctionKind {
        Voluntary,
        Liquidation
    }

    enum AuctionState {
        None,
        Open,
        Closed,
        Settled,
        Cancelled,
        FailedNoValidBid
    }

    struct Auction {
        AuctionKind kind;
        AuctionState state;
        IATSSecurity security;
        ITestCash cash;
        address seller;
        address beneficiary;
        address surplusRecipient;
        uint256 lenderClaim;
        uint256 quantity;
        uint256 reservePrice;
        uint256 biddingDeadline;
        uint256 oraclePrice;
        uint16 sanityToleranceBps;
        address highestBidder;
        uint256 highestBid;
        bool oracleExceptionApproved;
    }

    struct Bid {
        uint256 amount;
        bool withdrawn;
    }

    uint256 private constant _BPS = 10_000;
    uint8 private constant _KYC_GRANTED = 1;

    address public immutable complianceReviewer;
    address public immutable liquidationRouter;
    ITestCash public immutable settlementCash;
    IPriceOracle public immutable priceOracle;
    uint256 public nextAuctionId = 1;

    mapping(uint256 auctionId => Auction auction) public auctions;
    mapping(uint256 auctionId => mapping(address bidder => Bid bid)) public bids;
    mapping(uint256 auctionId => address[] bidders) private _auctionBidders;

    uint256 private _guard = 1;

    event AuctionListed(
        uint256 indexed auctionId,
        AuctionKind indexed kind,
        address indexed seller,
        address beneficiary,
        address security,
        address cash,
        uint256 quantity,
        uint256 reservePrice,
        uint256 biddingDeadline,
        uint256 oraclePrice
    );
    event BidFunded(uint256 indexed auctionId, address indexed bidder, uint256 amount);
    event AuctionClosed(uint256 indexed auctionId, address indexed winner, uint256 winningBid);
    event AuctionCancelled(uint256 indexed auctionId);
    event AuctionFailedNoValidBid(uint256 indexed auctionId);
    event BidRefundWithdrawn(uint256 indexed auctionId, address indexed bidder, uint256 amount);
    event OracleExceptionApproved(uint256 indexed auctionId, address indexed reviewer, uint256 winningBid);
    event AuctionSettled(
        uint256 indexed auctionId,
        address indexed winner,
        address indexed beneficiary,
        uint256 quantity,
        uint256 cashAmount
    );
    event LiquidationWaterfallPaid(uint256 indexed auctionId, uint256 lenderRecovery, uint256 borrowerSurplus);

    error Unauthorized();
    error InvalidConfiguration();
    error InvalidState(AuctionState expected, AuctionState actual);
    error AuctionStillActive();
    error BiddingEnded();
    error SecurityPaused();
    error AccountFrozen(address account);
    error KycNotGranted(address account);
    error InsufficientSecurityBalance();
    error TransferNotAllowed(bytes1 status, bytes32 reason);
    error AssetTransferFailed();
    error CashTransferFailed();
    error BidNotHigher();
    error BidAlreadyPlaced();
    error FundedBidsExist();
    error NoRefundAvailable();
    error OracleReviewRequired();
    error PriceWithinOracleBounds();
    error ReentrantCall();
    error UnsupportedCashToken();
    error OraclePriceMismatch(uint256 supplied, uint256 authenticated);
    error UnsupportedSecurityDecimals(uint8 decimals);

    modifier nonReentrant() {
        if (_guard != 1) revert ReentrantCall();
        _guard = 2;
        _;
        _guard = 1;
    }

    constructor(address reviewer, address repoLiquidationRouter, address cashAddress, address oracleAddress) {
        if (
            reviewer == address(0) ||
            repoLiquidationRouter == address(0) ||
            cashAddress == address(0) ||
            oracleAddress == address(0)
        ) revert InvalidConfiguration();
        complianceReviewer = reviewer;
        liquidationRouter = repoLiquidationRouter;
        settlementCash = ITestCash(cashAddress);
        priceOracle = IPriceOracle(oracleAddress);
    }

    function createVoluntaryAuction(
        IATSSecurity security,
        ITestCash cash,
        uint256 quantity,
        uint256 reservePrice,
        uint256 biddingDeadline,
        uint256 oraclePrice,
        uint16 sanityToleranceBps
    ) external nonReentrant returns (uint256 auctionId) {
        auctionId = _createAuction(
            AuctionKind.Voluntary,
            security,
            cash,
            msg.sender,
            msg.sender,
            quantity,
            reservePrice,
            biddingDeadline,
            oraclePrice,
            sanityToleranceBps
        );
    }

    function createLiquidationAuction(
        IATSSecurity security,
        ITestCash cash,
        address collateralOwner,
        address beneficiary,
        uint256 quantity,
        uint256 reservePrice,
        uint256 biddingDeadline,
        uint256 oraclePrice,
        uint16 sanityToleranceBps
    ) external nonReentrant returns (uint256 auctionId) {
        if (msg.sender != liquidationRouter) revert Unauthorized();
        auctionId = _createAuction(
            AuctionKind.Liquidation,
            security,
            cash,
            collateralOwner,
            beneficiary,
            quantity,
            reservePrice,
            biddingDeadline,
            oraclePrice,
            sanityToleranceBps
        );
    }

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
    ) external nonReentrant returns (uint256 auctionId) {
        if (msg.sender != liquidationRouter) revert Unauthorized();
        if (surplusRecipient == address(0) || lenderClaim == 0) revert InvalidConfiguration();
        auctionId = _createAuction(
            AuctionKind.Liquidation,
            security,
            cash,
            collateralOwner,
            beneficiary,
            quantity,
            reservePrice,
            biddingDeadline,
            oraclePrice,
            sanityToleranceBps
        );
        auctions[auctionId].surplusRecipient = surplusRecipient;
        auctions[auctionId].lenderClaim = lenderClaim;
    }

    function bid(uint256 auctionId, uint256 amount) external nonReentrant {
        Auction storage auction = auctions[auctionId];
        if (auction.state != AuctionState.Open) revert InvalidState(AuctionState.Open, auction.state);
        if (block.timestamp >= auction.biddingDeadline) revert BiddingEnded();
        if (auction.security.paused()) revert SecurityPaused();
        if (auction.security.isFrozen(msg.sender)) revert AccountFrozen(msg.sender);
        _requireInternalKycIfActive(auction.security, msg.sender);
        if (bids[auctionId][msg.sender].amount != 0) revert BidAlreadyPlaced();
        if (amount <= auction.highestBid) revert BidNotHigher();

        (bool allowed, bytes1 status, bytes32 reason) = auction.security.canTransferFrom(
            address(this),
            msg.sender,
            auction.quantity,
            ""
        );
        if (!allowed) {
            revert TransferNotAllowed(status, reason);
        }
        if (!auction.cash.transferFrom(msg.sender, address(this), amount)) revert CashTransferFailed();

        bids[auctionId][msg.sender] = Bid({ amount: amount, withdrawn: false });
        _auctionBidders[auctionId].push(msg.sender);
        auction.highestBidder = msg.sender;
        auction.highestBid = amount;
        emit BidFunded(auctionId, msg.sender, amount);
    }

    function close(uint256 auctionId) external nonReentrant {
        Auction storage auction = auctions[auctionId];
        if (auction.state != AuctionState.Open) revert InvalidState(AuctionState.Open, auction.state);
        if (block.timestamp < auction.biddingDeadline) revert AuctionStillActive();

        if (auction.highestBidder == address(0) || auction.highestBid < auction.reservePrice) {
            auction.state = AuctionState.FailedNoValidBid;
            if (!auction.security.transfer(auction.seller, auction.quantity)) revert AssetTransferFailed();
            emit AuctionFailedNoValidBid(auctionId);
            return;
        }

        auction.state = AuctionState.Closed;
        emit AuctionClosed(auctionId, auction.highestBidder, auction.highestBid);
    }

    function approveOracleException(uint256 auctionId) external {
        if (msg.sender != complianceReviewer) revert Unauthorized();
        Auction storage auction = auctions[auctionId];
        if (auction.state != AuctionState.Closed) revert InvalidState(AuctionState.Closed, auction.state);
        if (!_outsideOracleBounds(auction)) revert PriceWithinOracleBounds();
        auction.oracleExceptionApproved = true;
        emit OracleExceptionApproved(auctionId, msg.sender, auction.highestBid);
    }

    function settle(uint256 auctionId) external nonReentrant {
        Auction storage auction = auctions[auctionId];
        if (auction.state != AuctionState.Closed) revert InvalidState(AuctionState.Closed, auction.state);
        if (auction.security.paused()) revert SecurityPaused();
        if (auction.security.isFrozen(auction.highestBidder)) revert AccountFrozen(auction.highestBidder);
        _requireInternalKycIfActive(auction.security, auction.highestBidder);
        if (_outsideOracleBounds(auction) && !auction.oracleExceptionApproved) revert OracleReviewRequired();

        (bool allowed, bytes1 status, bytes32 reason) = auction.security.canTransferFrom(
            address(this),
            auction.highestBidder,
            auction.quantity,
            ""
        );
        if (!allowed) revert TransferNotAllowed(status, reason);

        auction.state = AuctionState.Settled;
        bids[auctionId][auction.highestBidder].withdrawn = true;
        if (!auction.security.transfer(auction.highestBidder, auction.quantity)) revert AssetTransferFailed();
        uint256 lenderRecovery = auction.highestBid;
        uint256 borrowerSurplus;
        if (
            auction.kind == AuctionKind.Liquidation &&
            auction.lenderClaim != 0 &&
            auction.highestBid > auction.lenderClaim
        ) {
            lenderRecovery = auction.lenderClaim;
            borrowerSurplus = auction.highestBid - lenderRecovery;
        }
        if (!auction.cash.transfer(auction.beneficiary, lenderRecovery)) revert CashTransferFailed();
        if (borrowerSurplus != 0 && !auction.cash.transfer(auction.surplusRecipient, borrowerSurplus)) {
            revert CashTransferFailed();
        }

        if (auction.kind == AuctionKind.Liquidation && auction.lenderClaim != 0) {
            emit LiquidationWaterfallPaid(auctionId, lenderRecovery, borrowerSurplus);
        }

        emit AuctionSettled(
            auctionId,
            auction.highestBidder,
            auction.beneficiary,
            auction.quantity,
            auction.highestBid
        );
    }

    function withdrawRefund(uint256 auctionId) external nonReentrant {
        Auction storage auction = auctions[auctionId];
        Bid storage fundedBid = bids[auctionId][msg.sender];
        bool refundableState = auction.state == AuctionState.Settled ||
            auction.state == AuctionState.FailedNoValidBid ||
            auction.state == AuctionState.Cancelled;
        bool isUnsettledLoser = auction.state == AuctionState.Closed && msg.sender != auction.highestBidder;
        if (!refundableState && !isUnsettledLoser) revert NoRefundAvailable();
        if (auction.state == AuctionState.Settled && msg.sender == auction.highestBidder) revert NoRefundAvailable();
        if (fundedBid.amount == 0 || fundedBid.withdrawn) revert NoRefundAvailable();

        uint256 amount = fundedBid.amount;
        fundedBid.withdrawn = true;
        if (!auction.cash.transfer(msg.sender, amount)) revert CashTransferFailed();
        emit BidRefundWithdrawn(auctionId, msg.sender, amount);
    }

    function cancel(uint256 auctionId) external nonReentrant {
        Auction storage auction = auctions[auctionId];
        if (auction.state != AuctionState.Open) revert InvalidState(AuctionState.Open, auction.state);
        if (msg.sender != auction.seller) revert Unauthorized();
        if (_auctionBidders[auctionId].length != 0) revert FundedBidsExist();
        auction.state = AuctionState.Cancelled;
        if (!auction.security.transfer(auction.seller, auction.quantity)) revert AssetTransferFailed();
        emit AuctionCancelled(auctionId);
    }

    function bidderCount(uint256 auctionId) external view returns (uint256) {
        return _auctionBidders[auctionId].length;
    }

    function isOutsideOracleBounds(uint256 auctionId) external view returns (bool) {
        return _outsideOracleBounds(auctions[auctionId]);
    }

    function _createAuction(
        AuctionKind kind,
        IATSSecurity security,
        ITestCash cash,
        address seller,
        address beneficiary,
        uint256 quantity,
        uint256 reservePrice,
        uint256 biddingDeadline,
        uint256 oraclePrice,
        uint16 sanityToleranceBps
    ) private returns (uint256 auctionId) {
        if (address(cash) != address(settlementCash)) revert UnsupportedCashToken();
        if (
            address(security) == address(0) ||
            address(cash) == address(0) ||
            seller == address(0) ||
            beneficiary == address(0) ||
            quantity == 0 ||
            reservePrice == 0 ||
            oraclePrice == 0 ||
            biddingDeadline <= block.timestamp ||
            sanityToleranceBps >= _BPS
        ) revert InvalidConfiguration();
        uint8 securityDecimals = security.decimals();
        if (securityDecimals > 18) revert UnsupportedSecurityDecimals(securityDecimals);
        (uint256 unitPrice, ) = priceOracle.priceOf(address(security));
        uint256 authenticatedPrice = (unitPrice * quantity) / (10 ** securityDecimals);
        if (oraclePrice != authenticatedPrice) revert OraclePriceMismatch(oraclePrice, authenticatedPrice);
        if (security.paused()) revert SecurityPaused();
        if (security.isFrozen(seller)) revert AccountFrozen(seller);
        _requireInternalKycIfActive(security, seller);
        if (security.balanceOf(seller) < quantity) revert InsufficientSecurityBalance();

        (bool allowed, bytes1 status, bytes32 reason) = security.canTransferFrom(seller, address(this), quantity, "");
        if (!allowed) revert TransferNotAllowed(status, reason);
        if (!security.transferFrom(seller, address(this), quantity)) revert AssetTransferFailed();

        auctionId = nextAuctionId++;
        auctions[auctionId] = Auction({
            kind: kind,
            state: AuctionState.Open,
            security: security,
            cash: cash,
            seller: seller,
            beneficiary: beneficiary,
            surplusRecipient: address(0),
            lenderClaim: 0,
            quantity: quantity,
            reservePrice: reservePrice,
            biddingDeadline: biddingDeadline,
            oraclePrice: oraclePrice,
            sanityToleranceBps: sanityToleranceBps,
            highestBidder: address(0),
            highestBid: 0,
            oracleExceptionApproved: false
        });

        emit AuctionListed(
            auctionId,
            kind,
            seller,
            beneficiary,
            address(security),
            address(cash),
            quantity,
            reservePrice,
            biddingDeadline,
            oraclePrice
        );
    }

    function _requireInternalKycIfActive(IATSSecurity security, address account) private view {
        if (security.isInternalKycActivated() && security.getKycStatusFor(account) != _KYC_GRANTED) {
            revert KycNotGranted(account);
        }
    }

    function _outsideOracleBounds(Auction storage auction) private view returns (bool) {
        if (auction.highestBid == 0) return false;
        uint256 lower = (auction.oraclePrice * (_BPS - auction.sanityToleranceBps)) / _BPS;
        uint256 upper = (auction.oraclePrice * (_BPS + auction.sanityToleranceBps)) / _BPS;
        return auction.highestBid < lower || auction.highestBid > upper;
    }
}
