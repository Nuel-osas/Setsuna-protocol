// SPDX-License-Identifier: MIT
pragma solidity 0.8.30;

import {ERC4626} from "@openzeppelin/contracts/token/ERC20/extensions/ERC4626.sol";
import {Math} from "@openzeppelin/contracts/utils/math/Math.sol";

/// @notice Fixed performance fee on yield, paid as newly minted vault shares.
/// @dev Deposits and withdrawals are never charged. `feeBase` is a high-water
/// mark in assets: gains are charged only above it, and a loss is not charged
/// again while it is being recovered. Conversions include fee shares that are
/// owed but not yet minted, so previews match what a transaction will do.
abstract contract SetsunaPerformanceFee is ERC4626 {
    uint256 public constant MAX_PERFORMANCE_FEE_BPS = 2_000;
    uint256 private constant FEE_BPS_DENOMINATOR = 10_000;

    address public immutable feeRecipient;
    uint256 public immutable performanceFeeBps;
    uint256 public feeBase;

    error InvalidFeeConfiguration();

    event PerformanceFeeAccrued(uint256 gainAssets, uint256 feeAssets, uint256 feeShares);

    constructor(address feeRecipient_, uint256 performanceFeeBps_) {
        if (performanceFeeBps_ > MAX_PERFORMANCE_FEE_BPS || (performanceFeeBps_ != 0 && feeRecipient_ == address(0)))
        {
            revert InvalidFeeConfiguration();
        }
        feeRecipient = feeRecipient_;
        performanceFeeBps = performanceFeeBps_;
    }

    /// @notice Fee shares owed at `nav` that have not been minted yet.
    function pendingFeeShares(uint256 nav) public view returns (uint256 shares, uint256 feeAssets) {
        uint256 supply = totalSupply();
        if (performanceFeeBps == 0 || supply == 0 || nav <= feeBase) {
            return (0, 0);
        }
        feeAssets = Math.mulDiv(nav - feeBase, performanceFeeBps, FEE_BPS_DENOMINATOR);
        if (feeAssets == 0) {
            return (0, 0);
        }
        // Minted so the recipient's new shares are worth exactly feeAssets at nav.
        shares = Math.mulDiv(feeAssets, supply + 10 ** _decimalsOffset(), nav - feeAssets + 1);
    }

    /// @dev Call with a freshly computed NAV, before any share conversion.
    function _accrueFee(uint256 nav) internal {
        (uint256 shares, uint256 feeAssets) = pendingFeeShares(nav);
        if (shares != 0) {
            _mint(feeRecipient, shares);
            emit PerformanceFeeAccrued(nav - feeBase, feeAssets, shares);
        }
        // Raise the mark on gains; an empty vault restarts it. Losses never lower it.
        if (nav > feeBase || totalSupply() == 0) {
            feeBase = nav;
        }
    }

    /// @dev New money is principal, not yield.
    function _addFeeBase(uint256 assets) internal {
        feeBase += assets;
    }

    /// @dev Exits remove principal pro rata, so an unrecovered loss stays proportionally owed.
    /// Rounding down keeps the mark at or above the remaining principal.
    function _removeFeeBase(uint256 assets, uint256 navBefore) internal {
        if (navBefore == 0) {
            return;
        }
        uint256 removed = Math.mulDiv(feeBase, Math.min(assets, navBefore), navBefore);
        feeBase -= removed;
    }

    function _convertToShares(uint256 assets, Math.Rounding rounding) internal view override returns (uint256) {
        uint256 nav = totalAssets();
        (uint256 pending,) = pendingFeeShares(nav);
        return Math.mulDiv(assets, totalSupply() + pending + 10 ** _decimalsOffset(), nav + 1, rounding);
    }

    function _convertToAssets(uint256 shares, Math.Rounding rounding) internal view override returns (uint256) {
        uint256 nav = totalAssets();
        (uint256 pending,) = pendingFeeShares(nav);
        return Math.mulDiv(shares, nav + 1, totalSupply() + pending + 10 ** _decimalsOffset(), rounding);
    }
}
