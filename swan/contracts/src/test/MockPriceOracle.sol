// SPDX-License-Identifier: Apache-2.0
pragma solidity >=0.8.18 <0.9.0;

import { IPriceOracle } from "../interfaces/IPriceOracle.sol";

contract MockPriceOracle is IPriceOracle {
    mapping(address => uint256) public prices;

    function setPrice(address security, uint256 price) external {
        prices[security] = price;
    }

    function priceOf(address security) external view returns (uint256 price, uint256 observedAt) {
        price = prices[security];
        require(price != 0, "PRICE_NOT_SET");
        observedAt = block.timestamp;
    }
}
