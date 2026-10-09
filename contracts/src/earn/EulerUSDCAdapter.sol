// SPDX-License-Identifier: MIT
pragma solidity 0.8.30;
import {IERC20Metadata} from "@openzeppelin/contracts/token/ERC20/extensions/IERC20Metadata.sol";
import {Math} from "@openzeppelin/contracts/utils/math/Math.sol";
import {EulerMONAdapter, IEulerEarn} from "./EulerMONAdapter.sol";

/// @notice Reuses Setsuna's asset-denominated EVK accounting with a six-decimal USDC guard.
contract EulerUSDCAdapter is EulerMONAdapter {
    constructor(address vault_, address asset_, IEulerEarn market_) EulerMONAdapter(vault_, asset_, market_) {
        if (IERC20Metadata(asset_).decimals() != 6) {
            revert InvalidVenue();
        }
    }

    function marketLiquidity() external view returns (uint256) {
        return Math.min(market.cash(), IERC20Metadata(asset).balanceOf(address(market)));
    }
}
