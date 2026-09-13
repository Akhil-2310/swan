// SPDX-License-Identifier: Apache-2.0
pragma solidity >=0.8.18 <0.9.0;

import { IATSSecurity } from "./interfaces/IATSSecurity.sol";
import { ITestCash } from "./interfaces/ITestCash.sol";
import { IApprovableATSSecurity, IRepoAuction } from "./interfaces/IRepoAuction.sol";
import { IPriceOracle } from "./interfaces/IPriceOracle.sol";

/**
 * @title RepoLifecycle
 * @author Asset Tokenization Studio Team
 * @notice Settles ATS-collateralised reverse repo from funding through close or default.
 * @dev ATS remains authoritative for KYC, freeze, pause, and transfer permission.
 */
contract RepoLifecycle {
    enum RepoState {
        None,
        Funding,
        Active,
        MarginCall,
        Closed,
        Liquidation,
        Cancelled
    }

    struct CollateralInput {
        IATSSecurity security;
        uint256 quantity;
        uint256 oraclePrice;
        uint16 haircutBps;
        uint16 maxConcentrationBps;
    }

    struct CollateralLine {
        IATSSecurity security;
        uint256 quantity;
        uint256 oraclePrice;
        uint256 tokenScale;
        uint16 haircutBps;
        uint16 maxConcentrationBps;
    }

    struct Repo {
        RepoState state;
        address borrower;
        address lender;
        ITestCash cash;
        uint256 principal;
        uint256 outstanding;
        uint256 fundingDeadline;
        uint256 maturity;
        uint256 marginDeadline;
        uint256 openedAt;
        uint16 maintenanceBps;
        uint16 winningRateBps;
        address bestLender;
        uint16 bestRateBps;
        bool couponEquivalentScheduled;
        bytes32 couponScheduleHash;
        bool couponEquivalentPaid;
        address scheduledBorrowerCaller;
        address scheduledLenderCaller;
    }

    struct Offer {
        uint16 rateBps;
        bool funded;
        bool consumed;
    }

    uint256 private constant _BPS = 10_000;
    uint8 private constant _KYC_GRANTED = 1;

    address public immutable oracle;
    ITestCash public immutable settlementCash;
    address public immutable scheduleVerifier;
    uint256 public immutable marginWindow;
    uint256 public nextRepoId = 1;

    mapping(uint256 repoId => Repo repo) public repos;
    mapping(uint256 repoId => CollateralLine[] collateral) private _collateral;
    mapping(uint256 repoId => mapping(address lender => Offer offer)) public offers;

    uint256 private _guard = 1;

    event RepoRequested(uint256 indexed repoId, address indexed borrower, uint256 principal, uint256 capacity);
    event FundingOffered(uint256 indexed repoId, address indexed lender, uint16 rateBps);
    event RepoOpened(uint256 indexed repoId, address indexed lender, uint16 rateBps, uint256 principal);
    event CollateralRepriced(uint256 indexed repoId, uint256 indexed collateralIndex, uint256 price, uint256 capacity);
    event MarginCalled(uint256 indexed repoId, uint256 capacity, uint256 requiredCapacity, uint256 deadline);
    event MarginCured(uint256 indexed repoId, uint256 capacity, uint256 outstanding);
    event PartialRepayment(uint256 indexed repoId, uint256 amount, uint256 outstanding);
    event CollateralSubstituted(
        uint256 indexed repoId,
        uint256 indexed collateralIndex,
        address previousSecurity,
        address replacementSecurity
    );
    event CouponEquivalentScheduled(uint256 indexed repoId, bytes32 indexed scheduleHash);
    event CouponEquivalentPaid(uint256 indexed repoId, uint256 amount);
    event ScheduledCallerAuthorized(uint256 indexed repoId, address indexed party, address indexed scheduledCaller);
    event RepoCancelled(uint256 indexed repoId);
    event RepoClosed(uint256 indexed repoId, uint256 repurchaseAmount);
    event RepoDefaulted(uint256 indexed repoId, uint256 lenderClaim);
    event LiquidationAuctionCreated(
        uint256 indexed repoId,
        uint256 indexed auctionId,
        uint256 collateralIndex,
        uint256 claim
    );

    error Unauthorized();
    error InvalidConfiguration();
    error InvalidState(RepoState expected, RepoState actual);
    error FundingStillOpen();
    error FundingClosed();
    error MarginWindowOpen();
    error MaturityNotReached();
    error KycNotGranted(address account);
    error SecurityPaused();
    error AccountFrozen(address account);
    error TransferNotAllowed(bytes1 status, bytes32 reason);
    error TransferFailed();
    error InsufficientCapacity();
    error ConcentrationExceeded(uint256 collateralIndex);
    error OfferAlreadyFunded();
    error InvalidRate();
    error NoFundingOffer();
    error NoRefund();
    error CouponTreatmentRequired();
    error ReentrantCall();
    error UnsupportedCashToken();
    error OraclePriceMismatch(address security, uint256 supplied, uint256 authenticated);
    error CouponAlreadyPaid();
    error UnsupportedSecurityDecimals(uint8 decimals);

    modifier nonReentrant() {
        if (_guard != 1) revert ReentrantCall();
        _guard = 2;
        _;
        _guard = 1;
    }

    constructor(address oracleAddress, address cashAddress, address verifier, uint256 marginWindowSeconds) {
        if (
            oracleAddress == address(0) ||
            cashAddress == address(0) ||
            verifier == address(0) ||
            marginWindowSeconds == 0
        ) revert InvalidConfiguration();
        oracle = oracleAddress;
        settlementCash = ITestCash(cashAddress);
        scheduleVerifier = verifier;
        marginWindow = marginWindowSeconds;
    }

    function requestRepo(
        ITestCash cash,
        uint256 principal,
        uint256 fundingDeadline,
        uint256 maturity,
        uint16 maintenanceBps,
        CollateralInput[] calldata basket
    ) external nonReentrant returns (uint256 repoId) {
        if (
            principal == 0 ||
            fundingDeadline <= block.timestamp ||
            maturity <= fundingDeadline ||
            maintenanceBps < _BPS ||
            basket.length == 0
        ) revert InvalidConfiguration();
        if (address(cash) != address(settlementCash)) revert UnsupportedCashToken();

        repoId = nextRepoId++;
        Repo storage repo = repos[repoId];
        repo.state = RepoState.Funding;
        repo.borrower = msg.sender;
        repo.cash = cash;
        repo.principal = principal;
        repo.outstanding = principal;
        repo.fundingDeadline = fundingDeadline;
        repo.maturity = maturity;
        repo.maintenanceBps = maintenanceBps;

        for (uint256 i = 0; i < basket.length; i++) {
            CollateralInput calldata item = basket[i];
            (uint256 authenticatedPrice, ) = IPriceOracle(oracle).priceOf(address(item.security));
            if (
                address(item.security) == address(0) ||
                item.quantity == 0 ||
                item.oraclePrice == 0 ||
                item.haircutBps >= _BPS ||
                item.maxConcentrationBps == 0 ||
                item.maxConcentrationBps > _BPS
            ) {
                revert InvalidConfiguration();
            }
            if (item.oraclePrice != authenticatedPrice) {
                revert OraclePriceMismatch(address(item.security), item.oraclePrice, authenticatedPrice);
            }
            uint256 tokenScale = _tokenScale(item.security);
            _checkTransfer(item.security, msg.sender, address(this), item.quantity);
            if (!item.security.transferFrom(msg.sender, address(this), item.quantity)) revert TransferFailed();
            _collateral[repoId].push(
                CollateralLine(
                    item.security,
                    item.quantity,
                    item.oraclePrice,
                    tokenScale,
                    item.haircutBps,
                    item.maxConcentrationBps
                )
            );
        }

        uint256 capacity = collateralCapacity(repoId);
        if (capacity < principal) revert InsufficientCapacity();
        _checkConcentration(repoId);
        emit RepoRequested(repoId, msg.sender, principal, capacity);
    }

    function offerFunding(uint256 repoId, uint16 rateBps) external nonReentrant {
        Repo storage repo = repos[repoId];
        _requireState(repo, RepoState.Funding);
        if (block.timestamp >= repo.fundingDeadline) revert FundingClosed();
        if (rateBps == 0) revert InvalidRate();
        if (offers[repoId][msg.sender].funded) revert OfferAlreadyFunded();

        CollateralLine[] storage basket = _collateral[repoId];
        for (uint256 i = 0; i < basket.length; i++) {
            _checkTransfer(basket[i].security, address(this), msg.sender, basket[i].quantity);
        }
        if (!repo.cash.transferFrom(msg.sender, address(this), repo.principal)) revert TransferFailed();

        offers[repoId][msg.sender] = Offer(rateBps, true, false);
        if (repo.bestLender == address(0) || rateBps < repo.bestRateBps) {
            repo.bestLender = msg.sender;
            repo.bestRateBps = rateBps;
        }
        emit FundingOffered(repoId, msg.sender, rateBps);
    }

    function openRepo(uint256 repoId) external nonReentrant {
        Repo storage repo = repos[repoId];
        _requireState(repo, RepoState.Funding);
        if (block.timestamp < repo.fundingDeadline) revert FundingStillOpen();
        if (repo.bestLender == address(0)) revert NoFundingOffer();

        repo.state = RepoState.Active;
        repo.lender = repo.bestLender;
        repo.winningRateBps = repo.bestRateBps;
        repo.openedAt = block.timestamp;
        offers[repoId][repo.lender].consumed = true;
        if (!repo.cash.transfer(repo.borrower, repo.principal)) revert TransferFailed();
        emit RepoOpened(repoId, repo.lender, repo.winningRateBps, repo.principal);
    }

    function reclaimUnfundedRepo(uint256 repoId) external nonReentrant {
        Repo storage repo = repos[repoId];
        _requireState(repo, RepoState.Funding);
        if (msg.sender != repo.borrower) revert Unauthorized();
        if (block.timestamp < repo.fundingDeadline) revert FundingStillOpen();
        if (repo.bestLender != address(0)) revert NoRefund();
        repo.state = RepoState.Cancelled;
        CollateralLine[] storage basket = _collateral[repoId];
        for (uint256 i = 0; i < basket.length; i++) {
            if (!basket[i].security.transfer(repo.borrower, basket[i].quantity)) revert TransferFailed();
        }
        emit RepoCancelled(repoId);
    }

    function withdrawLosingOffer(uint256 repoId) external nonReentrant {
        Repo storage repo = repos[repoId];
        Offer storage offer = offers[repoId][msg.sender];
        if (repo.state == RepoState.Funding || !offer.funded || offer.consumed) revert NoRefund();
        offer.consumed = true;
        if (!repo.cash.transfer(msg.sender, repo.principal)) revert TransferFailed();
    }

    function reprice(uint256 repoId, uint256 collateralIndex, uint256 newPrice) external {
        if (msg.sender != oracle) revert Unauthorized();
        _applyPrice(repoId, collateralIndex, newPrice);
    }

    function refreshPrice(uint256 repoId, uint256 collateralIndex) external {
        if (collateralIndex >= _collateral[repoId].length) revert InvalidConfiguration();
        (uint256 price, ) = IPriceOracle(oracle).priceOf(address(_collateral[repoId][collateralIndex].security));
        _applyPrice(repoId, collateralIndex, price);
    }

    function addCollateral(uint256 repoId, uint256 collateralIndex, uint256 quantity) external nonReentrant {
        Repo storage repo = repos[repoId];
        _requireState(repo, RepoState.MarginCall);
        if (msg.sender != repo.borrower || quantity == 0 || collateralIndex >= _collateral[repoId].length)
            revert Unauthorized();
        CollateralLine storage line = _collateral[repoId][collateralIndex];
        _checkTransfer(line.security, repo.borrower, address(this), quantity);
        if (!line.security.transferFrom(repo.borrower, address(this), quantity)) revert TransferFailed();
        line.quantity += quantity;
        _checkConcentration(repoId);
        _tryCure(repoId, repo);
    }

    function partiallyRepay(uint256 repoId, uint256 amount) external nonReentrant {
        Repo storage repo = repos[repoId];
        _requireState(repo, RepoState.MarginCall);
        if (msg.sender != repo.borrower || amount == 0 || amount >= repo.outstanding) revert Unauthorized();
        if (!repo.cash.transferFrom(repo.borrower, repo.lender, amount)) revert TransferFailed();
        repo.outstanding -= amount;
        emit PartialRepayment(repoId, amount, repo.outstanding);
        _tryCure(repoId, repo);
    }

    function substituteCollateral(
        uint256 repoId,
        uint256 collateralIndex,
        CollateralInput calldata replacement
    ) external nonReentrant {
        Repo storage repo = repos[repoId];
        if (repo.state != RepoState.Active && repo.state != RepoState.MarginCall) {
            revert InvalidState(RepoState.Active, repo.state);
        }
        if (
            msg.sender != repo.borrower ||
            collateralIndex >= _collateral[repoId].length ||
            address(replacement.security) == address(0) ||
            replacement.quantity == 0 ||
            replacement.oraclePrice == 0 ||
            replacement.haircutBps >= _BPS ||
            replacement.maxConcentrationBps == 0 ||
            replacement.maxConcentrationBps > _BPS
        ) revert Unauthorized();

        (uint256 authenticatedPrice, ) = IPriceOracle(oracle).priceOf(address(replacement.security));
        if (replacement.oraclePrice != authenticatedPrice) {
            revert OraclePriceMismatch(address(replacement.security), replacement.oraclePrice, authenticatedPrice);
        }

        _checkTransfer(replacement.security, repo.borrower, address(this), replacement.quantity);
        if (!replacement.security.transferFrom(repo.borrower, address(this), replacement.quantity)) {
            revert TransferFailed();
        }
        CollateralLine storage current = _collateral[repoId][collateralIndex];
        IATSSecurity previousSecurity = current.security;
        uint256 previousQuantity = current.quantity;
        current.security = replacement.security;
        current.quantity = replacement.quantity;
        current.oraclePrice = replacement.oraclePrice;
        current.tokenScale = _tokenScale(replacement.security);
        current.haircutBps = replacement.haircutBps;
        current.maxConcentrationBps = replacement.maxConcentrationBps;
        if (collateralCapacity(repoId) < (repo.outstanding * repo.maintenanceBps) / _BPS) {
            revert InsufficientCapacity();
        }
        _checkConcentration(repoId);
        if (!previousSecurity.transfer(repo.borrower, previousQuantity)) revert TransferFailed();
        emit CollateralSubstituted(repoId, collateralIndex, address(previousSecurity), address(replacement.security));
        if (repo.state == RepoState.MarginCall) _tryCure(repoId, repo);
    }

    function verifyCouponEquivalentSchedule(uint256 repoId, bytes32 scheduleHash) external {
        Repo storage repo = repos[repoId];
        if (msg.sender != scheduleVerifier || scheduleHash == bytes32(0)) revert Unauthorized();
        if (repo.state != RepoState.Active && repo.state != RepoState.MarginCall)
            revert InvalidState(RepoState.Active, repo.state);
        repo.couponEquivalentScheduled = true;
        repo.couponScheduleHash = scheduleHash;
        emit CouponEquivalentScheduled(repoId, scheduleHash);
    }

    function authorizeScheduledCaller(uint256 repoId, address scheduledCaller) external {
        if (scheduledCaller == address(0)) revert InvalidConfiguration();
        Repo storage repo = repos[repoId];
        bool authorized;
        if (msg.sender == repo.borrower) {
            repo.scheduledBorrowerCaller = scheduledCaller;
            emit ScheduledCallerAuthorized(repoId, msg.sender, scheduledCaller);
            authorized = true;
        }
        if (msg.sender == repo.lender) {
            repo.scheduledLenderCaller = scheduledCaller;
            emit ScheduledCallerAuthorized(repoId, msg.sender, scheduledCaller);
            authorized = true;
        }
        if (!authorized) revert Unauthorized();
    }

    function payCouponEquivalent(uint256 repoId, uint256 amount) external nonReentrant {
        Repo storage repo = repos[repoId];
        if ((msg.sender != repo.lender && msg.sender != repo.scheduledLenderCaller) || amount == 0) {
            revert Unauthorized();
        }
        if (repo.state != RepoState.Active && repo.state != RepoState.MarginCall)
            revert InvalidState(RepoState.Active, repo.state);
        if (!repo.couponEquivalentScheduled) revert CouponTreatmentRequired();
        if (repo.couponEquivalentPaid) revert CouponAlreadyPaid();
        if (!repo.cash.transferFrom(repo.lender, repo.borrower, amount)) revert TransferFailed();
        repo.couponEquivalentPaid = true;
        emit CouponEquivalentPaid(repoId, amount);
    }

    function closeRepo(uint256 repoId) external nonReentrant {
        Repo storage repo = repos[repoId];
        _requireState(repo, RepoState.Active);
        if (msg.sender != repo.borrower && msg.sender != repo.scheduledBorrowerCaller) revert Unauthorized();
        if (block.timestamp < repo.maturity) revert MaturityNotReached();
        if (!repo.couponEquivalentScheduled || !repo.couponEquivalentPaid) revert CouponTreatmentRequired();

        uint256 amount = lenderClaim(repoId);
        if (!repo.cash.transferFrom(repo.borrower, repo.lender, amount)) revert TransferFailed();
        repo.state = RepoState.Closed;
        CollateralLine[] storage basket = _collateral[repoId];
        for (uint256 i = 0; i < basket.length; i++) {
            if (!basket[i].security.transfer(repo.borrower, basket[i].quantity)) revert TransferFailed();
        }
        emit RepoClosed(repoId, amount);
    }

    function declareDefault(uint256 repoId) external {
        Repo storage repo = repos[repoId];
        bool uncuredMargin = repo.state == RepoState.MarginCall && block.timestamp >= repo.marginDeadline;
        bool missedMaturity = (repo.state == RepoState.Active || repo.state == RepoState.MarginCall) &&
            block.timestamp >= repo.maturity;
        if (!uncuredMargin && !missedMaturity) revert MarginWindowOpen();
        repo.state = RepoState.Liquidation;
        emit RepoDefaulted(repoId, lenderClaim(repoId));
    }

    function createLiquidationAuctions(
        uint256 repoId,
        IRepoAuction auction,
        uint256 biddingDeadline,
        uint16 sanityToleranceBps
    ) external nonReentrant returns (uint256[] memory auctionIds) {
        Repo storage repo = repos[repoId];
        _requireState(repo, RepoState.Liquidation);
        if (msg.sender != repo.lender || biddingDeadline <= block.timestamp) revert Unauthorized();
        CollateralLine[] storage basket = _collateral[repoId];
        auctionIds = new uint256[](basket.length);
        uint256 totalCapacity = collateralCapacity(repoId);
        uint256 remainingClaim = lenderClaim(repoId);
        for (uint256 i = 0; i < basket.length; i++) {
            CollateralLine storage line = basket[i];
            uint256 lineCapacity = _lineCapacity(line);
            uint256 allocatedClaim = i + 1 == basket.length
                ? remainingClaim
                : (lenderClaim(repoId) * lineCapacity) / totalCapacity;
            remainingClaim -= allocatedClaim;
            if (!IApprovableATSSecurity(address(line.security)).approve(address(auction), line.quantity))
                revert TransferFailed();
            uint256 auctionId = auction.createLiquidationAuctionWithWaterfall(
                line.security,
                repo.cash,
                address(this),
                repo.lender,
                repo.borrower,
                allocatedClaim,
                line.quantity,
                _lineGrossValue(line),
                biddingDeadline,
                _lineGrossValue(line),
                sanityToleranceBps
            );
            auctionIds[i] = auctionId;
            emit LiquidationAuctionCreated(repoId, auctionId, i, allocatedClaim);
        }
    }

    function collateralCount(uint256 repoId) external view returns (uint256) {
        return _collateral[repoId].length;
    }

    function collateralAt(uint256 repoId, uint256 index) external view returns (CollateralLine memory) {
        return _collateral[repoId][index];
    }

    function collateralCapacity(uint256 repoId) public view returns (uint256 capacity) {
        CollateralLine[] storage basket = _collateral[repoId];
        for (uint256 i = 0; i < basket.length; i++) capacity += _lineCapacity(basket[i]);
    }

    function lenderClaim(uint256 repoId) public view returns (uint256) {
        Repo storage repo = repos[repoId];
        if (repo.openedAt == 0) return repo.outstanding;
        uint256 duration = repo.maturity - repo.openedAt;
        uint256 interest = (repo.outstanding * repo.winningRateBps * duration) / (_BPS * 365 days);
        return repo.outstanding + interest;
    }

    function _applyPrice(uint256 repoId, uint256 collateralIndex, uint256 newPrice) private {
        Repo storage repo = repos[repoId];
        if (repo.state != RepoState.Active && repo.state != RepoState.MarginCall) {
            revert InvalidState(RepoState.Active, repo.state);
        }
        if (newPrice == 0 || collateralIndex >= _collateral[repoId].length) revert InvalidConfiguration();
        _collateral[repoId][collateralIndex].oraclePrice = newPrice;
        uint256 capacity = collateralCapacity(repoId);
        uint256 requiredCapacity = (repo.outstanding * repo.maintenanceBps) / _BPS;
        emit CollateralRepriced(repoId, collateralIndex, newPrice, capacity);
        if (capacity < requiredCapacity) {
            repo.state = RepoState.MarginCall;
            repo.marginDeadline = block.timestamp + marginWindow;
            emit MarginCalled(repoId, capacity, requiredCapacity, repo.marginDeadline);
        } else if (repo.state == RepoState.MarginCall) {
            repo.state = RepoState.Active;
            repo.marginDeadline = 0;
            emit MarginCured(repoId, capacity, repo.outstanding);
        }
    }

    function _tryCure(uint256 repoId, Repo storage repo) private {
        uint256 capacity = collateralCapacity(repoId);
        if (capacity >= (repo.outstanding * repo.maintenanceBps) / _BPS) {
            repo.state = RepoState.Active;
            repo.marginDeadline = 0;
            emit MarginCured(repoId, capacity, repo.outstanding);
        }
    }

    function _lineCapacity(CollateralLine storage line) private view returns (uint256) {
        return (_lineGrossValue(line) * (_BPS - line.haircutBps)) / _BPS;
    }

    function _lineGrossValue(CollateralLine storage line) private view returns (uint256) {
        return (line.oraclePrice * line.quantity) / line.tokenScale;
    }

    function _checkConcentration(uint256 repoId) private view {
        CollateralLine[] storage basket = _collateral[repoId];
        uint256 grossValue;
        for (uint256 i = 0; i < basket.length; i++) grossValue += _lineGrossValue(basket[i]);
        for (uint256 i = 0; i < basket.length; i++) {
            uint256 seriesValue;
            for (uint256 j = 0; j < basket.length; j++) {
                if (address(basket[j].security) == address(basket[i].security)) {
                    seriesValue += _lineGrossValue(basket[j]);
                }
            }
            uint256 shareBps = (seriesValue * _BPS) / grossValue;
            if (shareBps > basket[i].maxConcentrationBps) revert ConcentrationExceeded(i);
        }
    }

    function _checkTransfer(IATSSecurity security, address from, address to, uint256 quantity) private view {
        if (security.paused()) revert SecurityPaused();
        if (security.isFrozen(from)) revert AccountFrozen(from);
        if (security.isFrozen(to)) revert AccountFrozen(to);
        _requireInternalKycIfActive(security, from);
        _requireInternalKycIfActive(security, to);
        (bool allowed, bytes1 status, bytes32 reason) = security.canTransferFrom(from, to, quantity, "");
        if (!allowed) revert TransferNotAllowed(status, reason);
    }

    function _requireInternalKycIfActive(IATSSecurity security, address account) private view {
        if (security.isInternalKycActivated() && security.getKycStatusFor(account) != _KYC_GRANTED) {
            revert KycNotGranted(account);
        }
    }

    function _tokenScale(IATSSecurity security) private view returns (uint256) {
        uint8 securityDecimals = security.decimals();
        if (securityDecimals > 18) revert UnsupportedSecurityDecimals(securityDecimals);
        return 10 ** securityDecimals;
    }

    function _requireState(Repo storage repo, RepoState expected) private view {
        if (repo.state != expected) revert InvalidState(expected, repo.state);
    }
}
