// SPDX-License-Identifier: MIT
pragma solidity 0.8.30;

import {IERC20} from "@openzeppelin/contracts/token/ERC20/IERC20.sol";
import {SafeERC20} from "@openzeppelin/contracts/token/ERC20/utils/SafeERC20.sol";
import {Math} from "@openzeppelin/contracts/utils/math/Math.sol";
import {ILendingAdapter} from "./ILendingAdapter.sol";
import {IAaveEarnPool, IAaveEarnData, IAaveEarnReceipt} from "./VenueInterfaces.sol";

/// @notice Fixed USDC reserve on Neverland (Aave v3.0 rate model), immutable vault authority, no arbitrary recipient or executor.
contract NeverlandUSDCAdapter is ILendingAdapter {
    using SafeERC20 for IERC20;
    address public immutable override asset;
    address public immutable override vault;
    IAaveEarnPool public immutable pool;
    IAaveEarnData public immutable dataProvider;
    IERC20 public immutable receipt;
    INeverlandUSDCRate public immutable rateStrategy;
    error Unauthorized();
    error InvalidVenue();
    error BalanceMismatch();
    modifier onlyVault() {
        if (msg.sender != vault) {
            revert Unauthorized();
        }
        _;
    }

    constructor(address vault_, address asset_, IAaveEarnPool pool_, IAaveEarnData data_, IERC20 receipt_) {
        if (
            vault_ == address(0) || asset_.code.length == 0 || address(pool_).code.length == 0
                || IAaveEarnReceipt(address(receipt_)).UNDERLYING_ASSET_ADDRESS() != asset_
                || IAaveEarnReceipt(address(receipt_)).POOL() != address(pool_)
        ) {
            revert InvalidVenue();
        }
        asset = asset_;
        vault = vault_;
        pool = pool_;
        dataProvider = data_;
        receipt = receipt_;
        rateStrategy = INeverlandUSDCRate(data_.getInterestRateStrategyAddress(asset_));
        if (address(rateStrategy).code.length == 0 || (pool_.getConfiguration(asset_) >> 48) & 255 != 6) {
            revert InvalidVenue();
        }
    }

    function totalAssets() public view returns (uint256) {
        return IERC20(asset).balanceOf(address(this)) + receipt.balanceOf(address(this));
    }

    function availableLiquidity() public view returns (uint256) {
        uint256 cash = IERC20(asset).balanceOf(address(this));
        uint256 config = pool.getConfiguration(asset);
        if (config & (1 << 56) == 0 || config & (1 << 60) != 0) {
            return cash;
        }
        return cash + Math.min(receipt.balanceOf(address(this)), IERC20(asset).balanceOf(address(receipt)));
    }

    function marketLiquidity() external view returns (uint256) {
        return IERC20(asset).balanceOf(address(receipt));
    }

    function marketSupply() public view returns (uint256) {
        return dataProvider.getReserveData(asset).totalAToken;
    }

    function depositCapacity() public view returns (uint256) {
        uint256 config = pool.getConfiguration(asset);
        if (
            config & (1 << 56) == 0 || config & ((1 << 57) | (1 << 60)) != 0
                || dataProvider.getInterestRateStrategyAddress(asset) != address(rateStrategy)
        ) {
            return 0;
        }
        uint256 cap = (config >> 116) & ((1 << 36) - 1);
        if (cap == 0) {
            return type(uint128).max;
        }
        IAaveEarnData.Reserve memory r = dataProvider.getReserveData(asset);
        uint256 used = r.totalAToken
            + Math.mulDiv(
                r.accruedToTreasuryScaled, pool.getReserveNormalizedIncome(asset), 1e27, Math.Rounding.Ceil
            ) + 2;
        return cap * 1e6 > used ? cap * 1e6 - used : 0;
    }

    function supplyApr(int256 delta) external view returns (uint256) {
        if (dataProvider.getInterestRateStrategyAddress(asset) != address(rateStrategy)) {
            revert InvalidVenue();
        }
        IAaveEarnData.Reserve memory r = dataProvider.getReserveData(asset);
        INeverlandUSDCRate.Params memory p = INeverlandUSDCRate.Params({
            unbacked: r.unbacked,
            liquidityAdded: delta > 0 ? uint256(delta) : 0,
            liquidityTaken: delta < 0 ? uint256(-delta) : 0,
            totalStableDebt: r.totalStableDebt,
            totalVariableDebt: r.totalVariableDebt,
            averageStableBorrowRate: r.averageStableBorrowRate,
            reserveFactor: (pool.getConfiguration(asset) >> 64) & 65535,
            reserve: asset,
            aToken: address(receipt)
        });
        (uint256 supplyRate,,) = rateStrategy.calculateInterestRates(p);
        return supplyRate / 1e9;
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
        uint256 beforeCash = token.balanceOf(address(this));
        token.safeTransferFrom(vault, address(this), assets);
        if (token.balanceOf(address(this)) != beforeCash + assets) {
            revert BalanceMismatch();
        }
        token.forceApprove(address(pool), assets);
        pool.supply(asset, assets, address(this), 0);
        token.forceApprove(address(pool), 0);
        if (token.balanceOf(address(this)) != beforeCash) {
            revert BalanceMismatch();
        }
    }

    function withdraw(uint256 assets) external onlyVault returns (uint256) {
        IERC20 token = IERC20(asset);
        uint256 cash = token.balanceOf(address(this));
        if (assets > availableLiquidity()) {
            revert InvalidVenue();
        }
        if (assets > cash) {
            uint256 needed = assets - cash;
            uint256 received = pool.withdraw(
                asset, needed == receipt.balanceOf(address(this)) ? type(uint256).max : needed, address(this)
            );
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

    /// @dev Neverland's deployed v3.0 strategy differs from Aave's virtual-balance ABI.
    interface INeverlandUSDCRate {
        struct Params {
            uint256 unbacked;
            uint256 liquidityAdded;
            uint256 liquidityTaken;
            uint256 totalStableDebt;
            uint256 totalVariableDebt;
            uint256 averageStableBorrowRate;
            uint256 reserveFactor;
            address reserve;
            address aToken;
        }
        function calculateInterestRates(Params calldata) external view returns (uint256, uint256, uint256);
    }
