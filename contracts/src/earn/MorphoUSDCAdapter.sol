// SPDX-License-Identifier: MIT
pragma solidity 0.8.30;

import {IERC20} from "@openzeppelin/contracts/token/ERC20/IERC20.sol";
import {SafeERC20} from "@openzeppelin/contracts/token/ERC20/utils/SafeERC20.sol";
import {Math} from "@openzeppelin/contracts/utils/math/Math.sol";
import {ILendingAdapter} from "./ILendingAdapter.sol";
import {IMorphoEarn, IMorphoEarnRate} from "./VenueInterfaces.sol";

/// @notice Direct lending into one immutable Morpho market. No curator vault or swap authority.
contract MorphoUSDCAdapter is ILendingAdapter {
    using SafeERC20 for IERC20;
    address public immutable override asset;
    address public immutable override vault;
    IMorphoEarn public immutable morpho;
    bytes32 public immutable marketId;
    IMorphoEarn.Params private _params;
    error Unauthorized();
    error InvalidMarket();
    error BalanceMismatch();
    modifier onlyVault() {
        if (msg.sender != vault) {
            revert Unauthorized();
        }
        _;
    }

    constructor(address vault_, address asset_, IMorphoEarn morpho_, bytes32 marketId_) {
        IMorphoEarn.Params memory p = morpho_.idToMarketParams(marketId_);
        if (
            vault_ == address(0) || p.loanToken != asset_ || p.irm.code.length == 0
                || p.oracle.code.length == 0 || p.collateralToken.code.length == 0
                || keccak256(abi.encode(p)) != marketId_ || morpho_.market(marketId_).lastUpdate == 0
        ) {
            revert InvalidMarket();
        }
        asset = asset_;
        vault = vault_;
        morpho = morpho_;
        marketId = marketId_;
        _params = p;
    }

    function marketParams() external view returns (IMorphoEarn.Params memory) {
        return _params;
    }

    /// @dev Matches Morpho's third-order accrual and virtual shares, including fee-share dilution.
    function expectedMarket() public view returns (IMorphoEarn.Market memory m) {
        m = morpho.market(marketId);
        uint256 elapsed = block.timestamp - m.lastUpdate;
        if (elapsed == 0) {
            return m;
        }
        uint256 first = IMorphoEarnRate(_params.irm).borrowRateView(_params, m) * elapsed;
        uint256 second = Math.mulDiv(first, first, 2e18);
        uint256 third = Math.mulDiv(second, first, 3e18);
        uint256 interest = Math.mulDiv(m.totalBorrowAssets, first + second + third, 1e18);
        uint256 supplied = uint256(m.totalSupplyAssets) + interest;
        uint256 borrowed = uint256(m.totalBorrowAssets) + interest;
        uint256 fee = Math.mulDiv(interest, m.fee, 1e18);
        uint256 shares = uint256(m.totalSupplyShares)
            + Math.mulDiv(fee, uint256(m.totalSupplyShares) + 1e6, supplied - fee + 1);
        if (supplied > type(uint128).max || borrowed > type(uint128).max || shares > type(uint128).max) {
            revert InvalidMarket();
        }
        m.totalSupplyAssets = uint128(supplied);
        m.totalBorrowAssets = uint128(borrowed);
        m.totalSupplyShares = uint128(shares);
        m.lastUpdate = uint128(block.timestamp);
    }

    function _claim(IMorphoEarn.Market memory m) internal view returns (uint256) {
        (uint256 shares,,) = morpho.position(marketId, address(this));
        return Math.mulDiv(shares, uint256(m.totalSupplyAssets) + 1, uint256(m.totalSupplyShares) + 1e6);
    }

    function totalAssets() public view returns (uint256) {
        return IERC20(asset).balanceOf(address(this)) + _claim(expectedMarket());
    }

    function availableLiquidity() public view returns (uint256) {
        IMorphoEarn.Market memory m = expectedMarket();
        uint256 marketCash = uint256(m.totalSupplyAssets) - m.totalBorrowAssets;
        return IERC20(asset).balanceOf(address(this))
            + Math.min(_claim(m), Math.min(marketCash, IERC20(asset).balanceOf(address(morpho))));
    }

    function marketLiquidity() external view returns (uint256) {
        IMorphoEarn.Market memory m = expectedMarket();
        return Math.min(
            uint256(m.totalSupplyAssets) - m.totalBorrowAssets, IERC20(asset).balanceOf(address(morpho))
        );
    }

    function marketSupply() external view returns (uint256) {
        return expectedMarket().totalSupplyAssets;
    }

    function depositCapacity() external view returns (uint256) {
        return type(uint128).max - uint256(expectedMarket().totalSupplyAssets);
    }

    function supplyApr(int256 delta) external view returns (uint256) {
        IMorphoEarn.Market memory m = expectedMarket();
        uint256 supply = delta >= 0
            ? uint256(m.totalSupplyAssets) + uint256(delta)
            : uint256(m.totalSupplyAssets) - uint256(-delta);
        if (supply == 0) {
            return 0;
        }
        if (supply > type(uint128).max || supply < m.totalBorrowAssets) {
            revert InvalidMarket();
        }
        m.totalSupplyAssets = uint128(supply);
        uint256 borrowRate = IMorphoEarnRate(_params.irm).borrowRateView(_params, m);
        return
            Math.mulDiv(Math.mulDiv(borrowRate * 365 days, m.totalBorrowAssets, supply), 1e18 - m.fee, 1e18);
    }

    function sync() external onlyVault returns (uint256) {
        morpho.accrueInterest(_params);
        uint256 cash = IERC20(asset).balanceOf(address(this));
        if (cash > 0) {
            IERC20(asset).safeTransfer(vault, cash);
        }
        return totalAssets();
    }

    function deposit(uint256 assets) external onlyVault {
        if (assets == 0) {
            revert InvalidMarket();
        }
        IERC20 token = IERC20(asset);
        uint256 beforeCash = token.balanceOf(address(this));
        token.safeTransferFrom(vault, address(this), assets);
        if (token.balanceOf(address(this)) != beforeCash + assets) {
            revert BalanceMismatch();
        }
        token.forceApprove(address(morpho), assets);
        (uint256 supplied, uint256 shares) = morpho.supply(_params, assets, 0, address(this), "");
        token.forceApprove(address(morpho), 0);
        if (supplied != assets || shares == 0 || token.balanceOf(address(this)) != beforeCash) {
            revert BalanceMismatch();
        }
    }

    function withdraw(uint256 assets) external onlyVault returns (uint256) {
        IERC20 token = IERC20(asset);
        if (assets > availableLiquidity()) {
            revert InvalidMarket();
        }
        uint256 cash = token.balanceOf(address(this));
        if (assets > cash) {
            uint256 needed = assets - cash;
            (uint256 shares,,) = morpho.position(marketId, address(this));
            bool full = needed == _claim(expectedMarket());
            (uint256 received,) =
                morpho.withdraw(_params, full ? 0 : needed, full ? shares : 0, address(this), address(this));
            if (received != needed || token.balanceOf(address(this)) != cash + received) {
                revert BalanceMismatch();
            }
        }
        uint256 beforeVault = token.balanceOf(vault);
        token.safeTransfer(vault, assets);
        if (token.balanceOf(vault) != beforeVault + assets) {
            revert BalanceMismatch();
        }
        return assets;
    }
}
