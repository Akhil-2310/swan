// SPDX-License-Identifier: Apache-2.0
pragma solidity >=0.8.18 <0.9.0;

import { IPriceOracle } from "./interfaces/IPriceOracle.sol";

/**
 * @title IRepoPriceReceiver
 * @author Asset Tokenization Studio Team
 * @notice Receives a signed oracle observation into a live repo.
 */
interface IRepoPriceReceiver {
    /**
     * @notice Applies a new collateral price to an open repo.
     * @param repoId Repo that owns the collateral line.
     * @param collateralIndex Basket index being repriced.
     * @param newPrice Authenticated price in cash-token units.
     */
    function reprice(uint256 repoId, uint256 collateralIndex, uint256 newPrice) external;
}

/**
 * @title SignedPriceOracle
 * @author Asset Tokenization Studio Team
 * @notice Relays signer-authorised prices into Swan repos and security observations.
 * @dev Nonces are strictly incremental and observations expire after `maxAge`.
 */
contract SignedPriceOracle is IPriceOracle {
    struct Observation {
        uint256 price;
        uint256 observedAt;
    }

    uint256 private constant _SECP256K1_HALF_ORDER = 0x7fffffffffffffffffffffffffffffff5d576e7357a4501ddfe92f46681b20a0;
    address public immutable priceSigner;
    uint256 public immutable maxAge;
    uint256 public nextNonce;
    mapping(address security => Observation observation) public observations;

    event PriceSubmitted(
        address indexed repo,
        uint256 indexed repoId,
        uint256 indexed collateralIndex,
        uint256 price,
        uint256 observedAt,
        uint256 nonce
    );
    event SecurityPriceSubmitted(address indexed security, uint256 price, uint256 observedAt, uint256 nonce);

    error InvalidConfiguration();
    error InvalidPrice();
    error StalePrice();
    error FuturePrice();
    error InvalidNonce();
    error InvalidSignature();
    error PriceUnavailable();

    constructor(address signer, uint256 maxAgeSeconds) {
        if (signer == address(0) || maxAgeSeconds == 0) revert InvalidConfiguration();
        priceSigner = signer;
        maxAge = maxAgeSeconds;
    }

    function submitPrice(
        IRepoPriceReceiver repo,
        uint256 repoId,
        uint256 collateralIndex,
        uint256 price,
        uint256 observedAt,
        uint256 nonce,
        bytes calldata signature
    ) external {
        if (address(repo) == address(0) || price == 0) revert InvalidPrice();
        if (observedAt > block.timestamp) revert FuturePrice();
        if (block.timestamp - observedAt > maxAge) revert StalePrice();
        if (nonce != nextNonce) revert InvalidNonce();

        bytes32 observationHash = keccak256(
            abi.encode(address(this), block.chainid, address(repo), repoId, collateralIndex, price, observedAt, nonce)
        );
        bytes32 signedHash = keccak256(abi.encodePacked("\x19Ethereum Signed Message:\n32", observationHash));
        if (_recover(signedHash, signature) != priceSigner) revert InvalidSignature();

        nextNonce = nonce + 1;
        repo.reprice(repoId, collateralIndex, price);
        emit PriceSubmitted(address(repo), repoId, collateralIndex, price, observedAt, nonce);
    }

    function submitSecurityPrice(
        address security,
        uint256 price,
        uint256 observedAt,
        uint256 nonce,
        bytes calldata signature
    ) external {
        if (security == address(0) || price == 0) revert InvalidPrice();
        _validateObservation(observedAt, nonce);
        bytes32 observationHash = securityPayloadHash(security, price, observedAt, nonce);
        bytes32 signedHash = keccak256(abi.encodePacked("\x19Ethereum Signed Message:\n32", observationHash));
        if (_recover(signedHash, signature) != priceSigner) revert InvalidSignature();

        nextNonce = nonce + 1;
        observations[security] = Observation(price, observedAt);
        emit SecurityPriceSubmitted(security, price, observedAt, nonce);
    }

    function priceOf(address security) external view override returns (uint256 price, uint256 observedAt) {
        Observation memory observation = observations[security];
        if (observation.price == 0) revert PriceUnavailable();
        if (block.timestamp - observation.observedAt > maxAge) revert StalePrice();
        return (observation.price, observation.observedAt);
    }

    function payloadHash(
        address repo,
        uint256 repoId,
        uint256 collateralIndex,
        uint256 price,
        uint256 observedAt,
        uint256 nonce
    ) external view returns (bytes32) {
        return
            keccak256(
                abi.encode(address(this), block.chainid, repo, repoId, collateralIndex, price, observedAt, nonce)
            );
    }

    function securityPayloadHash(
        address security,
        uint256 price,
        uint256 observedAt,
        uint256 nonce
    ) public view returns (bytes32) {
        return
            keccak256(
                abi.encode(address(this), block.chainid, "SWAN_SECURITY_PRICE", security, price, observedAt, nonce)
            );
    }

    function _validateObservation(uint256 observedAt, uint256 nonce) private view {
        if (observedAt > block.timestamp) revert FuturePrice();
        if (block.timestamp - observedAt > maxAge) revert StalePrice();
        if (nonce != nextNonce) revert InvalidNonce();
    }

    function _recover(bytes32 digest, bytes calldata signature) private pure returns (address signer) {
        if (signature.length != 65) revert InvalidSignature();
        bytes32 r;
        bytes32 s;
        uint8 v;
        assembly {
            r := calldataload(signature.offset)
            s := calldataload(add(signature.offset, 32))
            v := byte(0, calldataload(add(signature.offset, 64)))
        }
        if (uint256(s) > _SECP256K1_HALF_ORDER) revert InvalidSignature();
        if (v < 27) v += 27;
        if (v != 27 && v != 28) revert InvalidSignature();
        signer = ecrecover(digest, v, r, s);
        if (signer == address(0)) revert InvalidSignature();
    }
}
