// SPDX-License-Identifier: Apache-2.0
pragma solidity >=0.8.18 <0.9.0;

/**
 * @title IPriceOracle
 * @author Asset Tokenization Studio Team
 * @notice Read surface for authenticated security prices used by Swan.
 * @dev Callers must treat a missing or stale observation as unusable.
 */
interface IPriceOracle {
    /**
     * @notice Returns the latest usable price for a security.
     * @param security ATS token whose observation is requested.
     * @return price Authenticated price in cash-token units.
     * @return observedAt Unix timestamp of the observation.
     */
    function priceOf(address security) external view returns (uint256 price, uint256 observedAt);
}
