// SPDX-License-Identifier: Apache-2.0
pragma solidity >=0.8.18 <0.9.0;

import { ITestCash } from "../interfaces/ITestCash.sol";

contract MockTestCash is ITestCash {
    mapping(address => uint256) public balanceOf;
    mapping(address => mapping(address => uint256)) public allowance;
    mapping(address => bool) public blockedRecipient;

    function mint(address account, uint256 amount) external {
        balanceOf[account] += amount;
    }

    function approve(address spender, uint256 amount) external returns (bool) {
        allowance[msg.sender][spender] = amount;
        return true;
    }

    function setBlockedRecipient(address account, bool blocked) external {
        blockedRecipient[account] = blocked;
    }

    function transferFrom(address from, address to, uint256 amount) external override returns (bool) {
        if (blockedRecipient[to] || allowance[from][msg.sender] < amount || balanceOf[from] < amount) return false;
        allowance[from][msg.sender] -= amount;
        balanceOf[from] -= amount;
        balanceOf[to] += amount;
        return true;
    }

    function transfer(address to, uint256 amount) external override returns (bool) {
        if (blockedRecipient[to] || balanceOf[msg.sender] < amount) return false;
        balanceOf[msg.sender] -= amount;
        balanceOf[to] += amount;
        return true;
    }
}
