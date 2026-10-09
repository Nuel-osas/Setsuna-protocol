// SPDX-License-Identifier: MIT
pragma solidity 0.8.30;

import {IERC20} from "@openzeppelin/contracts/token/ERC20/IERC20.sol";
import {IERC4626} from "@openzeppelin/contracts/interfaces/IERC4626.sol";
import {SafeERC20} from "@openzeppelin/contracts/token/ERC20/utils/SafeERC20.sol";
import {Math} from "@openzeppelin/contracts/utils/math/Math.sol";
import {ILendingAdapter} from "./ILendingAdapter.sol";

interface IEulerEarn is IERC4626 {
    function cash() external view returns (uint256);
    function totalBorrows() external view returns (uint256);
    function interestFee() external view returns (uint16);
    function interestRateModel() external view returns (address);
    function hookConfig() external view returns (address, uint32);
}

interface IEulerEarnRate {
    function computeInterestRateView(address market, uint256 cash, uint256 borrows)
        external
        view
        returns (uint256);
}

/// @notice Direct WMON lending to one fixed Euler EVK market. No borrowing, collateral or arbitrary calls.
contract EulerMONAdapter is ILendingAdapter {
    using SafeERC20 for IERC20;
    address public immutable override asset;
    address public immutable override vault;
    IEulerEarn public immutable market;
    IEulerEarnRate public immutable rateStrategy;
    error Unauthorized();
    error InvalidVenue();
    error BalanceMismatch();

    modifier onlyVault() {
        if (msg.sender != vault) {
            revert Unauthorized();
        }
        _;
    }

    constructor(address vault_, address asset_, IEulerEarn market_) {
        if (vault_ == address(0) || asset_.code.length == 0 || market_.asset() != asset_) {
            revert InvalidVenue();
        }
        asset = asset_;
        vault = vault_;
        market = market_;
        rateStrategy = IEulerEarnRate(market_.interestRateModel());
        if (address(rateStrategy).code.length == 0 || !_unchanged()) {
            revert InvalidVenue();
        }
    }

    function _unchanged() internal view returns (bool) {
        (address hook, uint32 operations) = market.hookConfig();
        return hook == address(0) && operations == 0 && market.interestRateModel() == address(rateStrategy);
    }

    function totalAssets() public view returns (uint256) {
        return
            IERC20(asset).balanceOf(address(this)) + market.convertToAssets(market.balanceOf(address(this)));
    }

    function availableLiquidity() public view returns (uint256) {
        // maxWithdraw also respects the market's operation controls. Actual token cash is an extra bound.
        return IERC20(asset).balanceOf(address(this))
            + Math.min(
            market.maxWithdraw(address(this)),
            Math.min(market.cash(), IERC20(asset).balanceOf(address(market)))
        );
    }

    function marketSupply() external view returns (uint256) {
        return market.totalAssets();
    }

    function depositCapacity() public view returns (uint256) {
        return _unchanged() ? Math.min(market.maxDeposit(address(this)), type(uint128).max) : 0;
    }

    function supplyApr(int256 delta) external view returns (uint256) {
        if (!_unchanged()) {
            revert InvalidVenue();
        }
        uint256 cash = market.cash();
        cash = delta >= 0 ? cash + uint256(delta) : cash - uint256(-delta);
        uint256 borrows = market.totalBorrows();
        if (cash + borrows == 0) {
            return 0;
        }
        uint256 rate = rateStrategy.computeInterestRateView(address(market), cash, borrows);
        // Euler's borrow rate is per-second RAY. Supply APR excludes the venue's interest fee.
        return Math.mulDiv(
            Math.mulDiv(rate * 365 days, borrows, cash + borrows), 10_000 - market.interestFee(), 10_000
        ) / 1e9;
    }

    function sync() external onlyVault returns (uint256) {
        uint256 cash = IERC20(asset).balanceOf(address(this));
        if (cash > 0) {
            IERC20(asset).safeTransfer(vault, cash);
        }
        return totalAssets();
    }

    function deposit(uint256 assets) external onlyVault {
        if (assets == 0 || assets > depositCapacity()) {
            revert InvalidVenue();
        }
        IERC20 token = IERC20(asset);
        uint256 cash = token.balanceOf(address(this));
        token.safeTransferFrom(vault, address(this), assets);
        if (token.balanceOf(address(this)) != cash + assets) {
            revert BalanceMismatch();
        }
        token.forceApprove(address(market), assets);
        uint256 shares = market.deposit(assets, address(this));
        token.forceApprove(address(market), 0);
        if (shares == 0 || token.balanceOf(address(this)) != cash) {
            revert BalanceMismatch();
        }
    }

    function withdraw(uint256 assets) external onlyVault returns (uint256) {
        IERC20 token = IERC20(asset);
        if (assets == 0 || assets > availableLiquidity()) {
            revert InvalidVenue();
        }
        uint256 cash = token.balanceOf(address(this));
        if (assets > cash) {
            uint256 needed = assets - cash;
            uint256 shares = market.balanceOf(address(this));
            if (needed == market.convertToAssets(shares)) {
                if (market.redeem(shares, address(this), address(this)) != needed) {
                    revert BalanceMismatch();
                }
            } else {
                market.withdraw(needed, address(this), address(this));
            }
            if (token.balanceOf(address(this)) != cash + needed) {
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
