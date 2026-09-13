// SPDX-License-Identifier: Apache-2.0
pragma solidity >=0.8.18 <0.9.0;

/**
 * @title IATSSecurity
 * @author Asset Tokenization Studio Team
 * @notice Minimal ATS security surface used by Swan repo and auction settlement.
 * @dev Maps to ATS v8 balance, freeze, pause, KYC, and transfer-preflight facets.
 */
interface IATSSecurity {
    /**
     * @notice Moves a reserved quantity from one ATS holder to another.
     * @param from Source of the security units.
     * @param to Destination of the security units.
     * @param amount Quantity to move, in native token units.
     * @return success True when the ATS transfer succeeded.
     */
    function transferFrom(address from, address to, uint256 amount) external returns (bool success);

    /**
     * @notice Moves a quantity from the caller to another ATS holder.
     * @param to Destination of the security units.
     * @param amount Quantity to move, in native token units.
     * @return success True when the ATS transfer succeeded.
     */
    function transfer(address to, uint256 amount) external returns (bool success);

    /**
     * @notice Returns the security's display decimals for quantity scaling.
     * @return tokenDecimals Decimal places used by the ATS token.
     */
    function decimals() external view returns (uint8 tokenDecimals);

    /**
     * @notice Returns the ATS balance of an account.
     * @param account Holder whose balance is queried.
     * @return amount Balance in native token units.
     */
    function balanceOf(address account) external view returns (uint256 amount);

    /**
     * @notice Reports whether the security is paused.
     * @return isPaused True when transfers must be rejected.
     */
    function paused() external view returns (bool isPaused);

    /**
     * @notice Reports whether an account is frozen.
     * @param account Address to inspect.
     * @return frozen True when the account cannot send or receive.
     */
    function isFrozen(address account) external view returns (bool frozen);

    /**
     * @notice Returns the ATS KYC status code for an account.
     * @param account Address to inspect.
     * @return status Non-zero granted status required when internal KYC is active.
     */
    function getKycStatusFor(address account) external view returns (uint8 status);

    /**
     * @notice Reports whether the security enforces internal KYC.
     * @return active True when KYC status must be granted for transfers.
     */
    function isInternalKycActivated() external view returns (bool active);

    /**
     * @notice Explains whether a transfer would be allowed by ATS compliance.
     * @param from Source of the security units.
     * @param to Destination of the security units.
     * @param amount Quantity that would move.
     * @param data Optional compliance payload.
     * @return allowed True when the transfer may proceed.
     * @return status ATS status byte for the decision.
     * @return reason Machine-readable reason identifier.
     */
    function canTransferFrom(
        address from,
        address to,
        uint256 amount,
        bytes calldata data
    ) external view returns (bool allowed, bytes1 status, bytes32 reason);
}
