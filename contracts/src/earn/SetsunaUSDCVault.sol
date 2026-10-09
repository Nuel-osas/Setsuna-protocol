// SPDX-License-Identifier: MIT
pragma solidity 0.8.30;
import {IERC20} from "@openzeppelin/contracts/token/ERC20/IERC20.sol";
import {SetsunaMultiEarnCore} from "./SetsunaMultiEarnCore.sol";

/// @notice setsUSDC v2: one share token backed by up to four fixed lending destinations.
contract SetsunaUSDCVault is SetsunaMultiEarnCore {
    constructor(IERC20 asset_, address guardian_, uint256 cap_, uint256 minimum_)
        SetsunaMultiEarnCore(asset_, guardian_, cap_, minimum_, 6, "Setsuna Earn USDC", "setsUSDC")
    {}
}
