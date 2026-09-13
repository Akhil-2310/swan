// SPDX-License-Identifier: Apache-2.0
pragma solidity >=0.8.18 <0.9.0;

/**
 * @title ITestCash
 * @author Asset Tokenization Studio Team
 * @notice Minimal cash-token transfer surface used by Swan settlement.
 * @dev Live deployments pin this to native Hedera testnet USDC.
 */
interface ITestCash {
    /**
     * @notice Moves cash from an approved holder to a recipient.
     * @param from Source of the cash.
     * @param to Destination of the cash.
     * @param amount Quantity to move, in cash-token units.
     * @return success True when the transfer succeeded.
     */
    function transferFrom(address from, address to, uint256 amount) external returns (bool success);

    /**
     * @notice Moves cash from the caller to a recipient.
     * @param to Destination of the cash.
     * @param amount Quantity to move, in cash-token units.
     * @return success True when the transfer succeeded.
     */
    function transfer(address to, uint256 amount) external returns (bool success);
}
