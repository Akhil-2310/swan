// SPDX-License-Identifier: Apache-2.0
pragma solidity >=0.8.18 <0.9.0;

/**
 * @title IATSKycSecurity
 * @author Asset Tokenization Studio Team
 * @notice ATS KYC grant surface used by the Swan access registry.
 */
interface IATSKycSecurity {
    /**
     * @notice Grants KYC on an ATS security for an approved applicant.
     * @param account Wallet receiving KYC.
     * @param vcId Off-chain credential identifier; not stored by Swan.
     * @param validFrom Start of the KYC window.
     * @param validTo End of the KYC window.
     * @param issuer ATS identity issuer recorded on the grant.
     * @return success True when ATS accepted the grant.
     */
    function grantKyc(
        address account,
        string memory vcId,
        uint256 validFrom,
        uint256 validTo,
        address issuer
    ) external returns (bool success);

    /**
     * @notice Returns the ATS KYC status code for an account.
     * @param account Wallet to inspect.
     * @return status Non-zero granted status required for transfers.
     */
    function getKycStatusFor(address account) external view returns (uint8 status);
}

/**
 * @title KycAccessRegistry
 * @author Asset Tokenization Studio Team
 * @notice Public access-request queue and reviewer-controlled batch ATS KYC approval.
 * @dev The registry stores no personal data. It must receive ATS KYC_ROLE on every configured security.
 */
contract KycAccessRegistry {
    enum RequestStatus {
        None,
        Pending,
        Approved,
        Rejected
    }

    struct AccessRequest {
        address applicant;
        uint64 submittedAt;
        uint8 roles;
        RequestStatus status;
    }

    uint8 public constant ROLE_LENDER = 1;
    uint8 public constant ROLE_BIDDER = 2;
    uint8 private constant _KYC_GRANTED = 1;

    address public immutable reviewer;
    address public immutable issuer;
    IATSKycSecurity[] private _securities;
    address[] private _applicants;
    mapping(address applicant => AccessRequest request) public requests;

    uint256 private _guard = 1;

    event AccessRequested(address indexed applicant, uint8 roles, uint256 submittedAt);
    event AccessApproved(address indexed applicant, address indexed reviewer, uint256 validTo);
    event AccessRejected(address indexed applicant, address indexed reviewer);

    error Unauthorized();
    error InvalidConfiguration();
    error InvalidRoles();
    error RequestAlreadyPending();
    error ApplicantAlreadyApproved();
    error RequestNotPending();
    error KycGrantFailed(address security);
    error ReentrantCall();

    modifier onlyReviewer() {
        if (msg.sender != reviewer) revert Unauthorized();
        _;
    }

    modifier nonReentrant() {
        if (_guard != 1) revert ReentrantCall();
        _guard = 2;
        _;
        _guard = 1;
    }

    constructor(address reviewerAddress, address issuerAddress, address[] memory securities) {
        if (reviewerAddress == address(0) || issuerAddress == address(0) || securities.length == 0) {
            revert InvalidConfiguration();
        }
        reviewer = reviewerAddress;
        issuer = issuerAddress;
        for (uint256 i = 0; i < securities.length; i++) {
            if (securities[i] == address(0)) revert InvalidConfiguration();
            _securities.push(IATSKycSecurity(securities[i]));
        }
    }

    function requestAccess(uint8 roles) external {
        if (roles == 0 || roles > (ROLE_LENDER | ROLE_BIDDER)) revert InvalidRoles();
        AccessRequest storage request = requests[msg.sender];
        if (request.status == RequestStatus.Pending) revert RequestAlreadyPending();
        if (request.status == RequestStatus.Approved && isFullyKyc(msg.sender)) revert ApplicantAlreadyApproved();
        if (request.applicant == address(0)) {
            request.applicant = msg.sender;
            _applicants.push(msg.sender);
        }
        request.submittedAt = uint64(block.timestamp);
        request.roles = roles;
        request.status = RequestStatus.Pending;
        emit AccessRequested(msg.sender, roles, block.timestamp);
    }

    function approve(address applicant, string calldata vcId, uint256 validTo) external onlyReviewer nonReentrant {
        AccessRequest storage request = requests[applicant];
        if (request.status != RequestStatus.Pending) revert RequestNotPending();
        if (bytes(vcId).length == 0 || validTo <= block.timestamp) revert InvalidConfiguration();
        request.status = RequestStatus.Approved;
        for (uint256 i = 0; i < _securities.length; i++) {
            if (_securities[i].getKycStatusFor(applicant) != _KYC_GRANTED) {
                if (!_securities[i].grantKyc(applicant, vcId, block.timestamp, validTo, issuer)) {
                    revert KycGrantFailed(address(_securities[i]));
                }
            }
        }
        emit AccessApproved(applicant, msg.sender, validTo);
    }

    function reject(address applicant) external onlyReviewer {
        AccessRequest storage request = requests[applicant];
        if (request.status != RequestStatus.Pending) revert RequestNotPending();
        request.status = RequestStatus.Rejected;
        emit AccessRejected(applicant, msg.sender);
    }

    function securityCount() external view returns (uint256) {
        return _securities.length;
    }

    function securityAt(uint256 index) external view returns (address) {
        return address(_securities[index]);
    }

    function applicantCount() external view returns (uint256) {
        return _applicants.length;
    }

    function applicantAt(uint256 index) external view returns (address) {
        return _applicants[index];
    }

    function isFullyKyc(address applicant) public view returns (bool) {
        for (uint256 i = 0; i < _securities.length; i++) {
            if (_securities[i].getKycStatusFor(applicant) != _KYC_GRANTED) return false;
        }
        return true;
    }
}
