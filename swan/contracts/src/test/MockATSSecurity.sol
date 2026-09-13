// SPDX-License-Identifier: Apache-2.0
pragma solidity >=0.8.18 <0.9.0;

import { IATSSecurity } from "../interfaces/IATSSecurity.sol";

contract MockATSSecurity is IATSSecurity {
    uint8 public override decimals;
    mapping(address => uint256) public override balanceOf;
    mapping(address => mapping(address => uint256)) public allowance;
    mapping(address => bool) public frozen;
    mapping(address => uint8) public kyc;
    bool public override paused;
    bool public override isInternalKycActivated = true;

    function setDecimals(uint8 value) external {
        decimals = value;
    }

    function setInternalKycActivated(bool value) external {
        isInternalKycActivated = value;
    }

    function mint(address account, uint256 amount) external {
        balanceOf[account] += amount;
    }

    function approve(address spender, uint256 amount) external returns (bool) {
        allowance[msg.sender][spender] = amount;
        return true;
    }

    function setPaused(bool value) external {
        paused = value;
    }

    function setFrozen(address account, bool value) external {
        frozen[account] = value;
    }

    function setKyc(address account, bool value) external {
        kyc[account] = value ? 1 : 0;
    }

    function transferFrom(address from, address to, uint256 amount) external override returns (bool) {
        if (allowance[from][msg.sender] < amount) return false;
        (bool allowed, , ) = _canMove(from, to, amount);
        if (!allowed) return false;
        allowance[from][msg.sender] -= amount;
        balanceOf[from] -= amount;
        balanceOf[to] += amount;
        return true;
    }

    function transfer(address to, uint256 amount) external override returns (bool) {
        (bool allowed, , ) = _canMove(msg.sender, to, amount);
        if (!allowed) return false;
        balanceOf[msg.sender] -= amount;
        balanceOf[to] += amount;
        return true;
    }

    function isFrozen(address account) external view override returns (bool) {
        return frozen[account];
    }

    function getKycStatusFor(address account) external view override returns (uint8) {
        return kyc[account];
    }

    function canTransferFrom(
        address from,
        address to,
        uint256 amount,
        bytes calldata
    ) external view override returns (bool, bytes1, bytes32) {
        return _canMove(from, to, amount);
    }

    function _canMove(address from, address to, uint256 amount) private view returns (bool, bytes1, bytes32) {
        if (paused) return (false, 0x54, "PAUSED");
        if (frozen[from] || frozen[to]) return (false, 0x55, "FROZEN");
        if (isInternalKycActivated && (kyc[from] != 1 || kyc[to] != 1)) {
            return (false, 0x56, "KYC_NOT_GRANTED");
        }
        if (balanceOf[from] < amount) return (false, 0x52, "INSUFFICIENT_BALANCE");
        return (true, 0x51, "TRANSFER_ALLOWED");
    }
}
