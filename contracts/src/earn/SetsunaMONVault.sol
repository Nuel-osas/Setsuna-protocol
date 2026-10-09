// SPDX-License-Identifier: MIT
pragma solidity 0.8.30;

import {IERC20} from "@openzeppelin/contracts/token/ERC20/IERC20.sol";
import {SetsunaEarnCore} from "./SetsunaEarnCore.sol";

/// @notice Immutable MON Earn vault. Underlying is WMON; native MON uses the fixed gateway.
contract SetsunaMONVault is SetsunaEarnCore {
    constructor(IERC20 asset_, address guardian_, uint256 depositCap_, uint256 minimumMarketSupply_)
        SetsunaEarnCore(
            asset_, guardian_, depositCap_, minimumMarketSupply_, 18, "Setsuna Earn MON", "setsMON"
        )
    {}
}
