// SPDX-License-Identifier: Apache-2.0
pragma solidity >=0.8.18 <0.9.0;

/**
 * @title MockKycSecurity
 * @author Asset Tokenization Studio Team
 * @notice Test ATS KYC stub that only the access registry may grant.
 */
contract MockKycSecurity {
    mapping(address account => uint8 status) public getKycStatusFor;
    address public registry;

    function setRegistry(address registryAddress) external {
        registry = registryAddress;
    }

    function grantKyc(address account, string memory, uint256, uint256, address) external returns (bool) {
        require(msg.sender == registry, "not registry");
        getKycStatusFor[account] = 1;
        return true;
    }
}
