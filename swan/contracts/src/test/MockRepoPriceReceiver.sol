// SPDX-License-Identifier: Apache-2.0
pragma solidity >=0.8.18 <0.9.0;

import { IRepoPriceReceiver } from "../SignedPriceOracle.sol";

contract MockRepoPriceReceiver is IRepoPriceReceiver {
    uint256 public repoId;
    uint256 public collateralIndex;
    uint256 public price;

    function reprice(uint256 nextRepoId, uint256 nextCollateralIndex, uint256 nextPrice) external {
        repoId = nextRepoId;
        collateralIndex = nextCollateralIndex;
        price = nextPrice;
    }
}
