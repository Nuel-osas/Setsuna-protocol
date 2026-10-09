// SPDX-License-Identifier: MIT
pragma solidity 0.8.30;

import {IERC20} from "@openzeppelin/contracts/token/ERC20/IERC20.sol";
import {IERC20Metadata} from "@openzeppelin/contracts/token/ERC20/extensions/IERC20Metadata.sol";
import {IERC4626} from "@openzeppelin/contracts/interfaces/IERC4626.sol";
import {SafeERC20} from "@openzeppelin/contracts/token/ERC20/utils/SafeERC20.sol";
import {Math} from "@openzeppelin/contracts/utils/math/Math.sol";
import {ILendingAdapterV2} from "./ILendingAdapterV2.sol";

// ABI subsets only. No Curvance implementation is vendored into Setsuna.
interface ICurvanceEarn is IERC4626 {
    function centralRegistry() external view returns (address);
    function marketManager() external view returns (address);
    function IRM() external view returns (address);
    function assetsHeld() external view returns (uint256);
    function marketOutstandingDebt() external view returns (uint240);
    function interestFee() external view returns (uint16);
    function getYieldInformation() external view returns (uint256, uint256, uint256, uint256);
    function accrueIfNeeded() external;
}

interface ICurvanceEarnManager {
    function isListed(address) external view returns (bool);
    function redeemPaused() external view returns (uint8);
}

interface ICurvanceEarnRate {
    function linkedToken() external view returns (address);
    function predictedBorrowRate(uint256 cash, uint256 debt) external view returns (uint256);
}

/// @notice Fixed, uncollateralized lender position in a Curvance USDC market.
/// @dev The adapter cannot borrow, post collateral, swap, or change its destination.
contract CurvanceUSDCAdapter is ILendingAdapterV2 {
    using SafeERC20 for IERC20;
    address public immutable override asset;
    address public immutable override vault;
    ICurvanceEarn public immutable market;
    ICurvanceEarnManager public immutable manager;
    ICurvanceEarnRate public immutable rateStrategy;
    address public immutable centralRegistry;
    error Unauthorized();
    error InvalidVenue();
    error BalanceMismatch();

    modifier onlyVault() {
        if (msg.sender != vault) {
            revert Unauthorized();
        }
        _;
    }

    constructor(address vault_, address asset_, ICurvanceEarn market_, address registry_, address manager_) {
        if (
            vault_ == address(0) || asset_.code.length == 0 || IERC20Metadata(asset_).decimals() != 6
                || market_.asset() != asset_ || registry_.code.length == 0 || manager_.code.length == 0
                || market_.centralRegistry() != registry_ || market_.marketManager() != manager_
        ) {
            revert InvalidVenue();
        }
        asset = asset_;
        vault = vault_;
        market = market_;
        centralRegistry = registry_;
        manager = ICurvanceEarnManager(manager_);
        rateStrategy = ICurvanceEarnRate(market_.IRM());
        if (
            address(rateStrategy).code.length == 0 || rateStrategy.linkedToken() != address(market_)
                || !manager.isListed(address(market_))
        ) {
            revert InvalidVenue();
        }
    }

    function _unchanged() internal view returns (bool) {
        return market.IRM() == address(rateStrategy) && market.interestFee() <= 6_000;
    }

    /// @dev Curvance views include pending vesting but not all future fee-share dilution.
    /// The vault MUST sync before pricing a state-changing operation (SetsunaMultiEarnCore does).
    function totalAssets() public view returns (uint256) {
        return
            IERC20(asset).balanceOf(address(this)) + market.convertToAssets(market.balanceOf(address(this)));
    }

    function marketLiquidity() public view returns (uint256) {
        // Curvance's pause encoding is 1 = unpaused, 2 = paused. Fail closed on other values.
        if (manager.redeemPaused() != 1) {
            return 0;
        }
        return Math.min(market.assetsHeld(), IERC20(asset).balanceOf(address(market)));
    }

    function availableLiquidity() public view returns (uint256) {
        return IERC20(asset).balanceOf(address(this))
            + Math.min(market.convertToAssets(market.balanceOf(address(this))), marketLiquidity());
    }

    function marketSupply() external view returns (uint256) {
        return market.totalAssets();
    }

    function depositCapacity() public view returns (uint256) {
        if (!_unchanged() || manager.redeemPaused() != 1 || !manager.isListed(address(market))) {
            return 0;
        }
        // maxDeposit incorporates Curvance's mint pause; a redemption pause blocks new exposure too.
        return Math.min(market.maxDeposit(address(this)), type(uint128).max);
    }

    function supplyApr(int256 delta) external view returns (uint256) {
        if (!_unchanged()) {
            revert InvalidVenue();
        }
        uint256 cash = market.assetsHeld();
        cash = delta >= 0 ? cash + uint256(delta) : cash - uint256(-delta);
        uint256 debt = market.marketOutstandingDebt();
        if (debt == 0) {
            return 0;
        }
        (uint256 vestingRate,,,) = market.getYieldInformation();
        // Conservative estimate: bound the post-allocation model quote by the current vesting rate.
        // Do not use DynamicIRM.supplyRate/borrowRate, which Curvance reserves for frontend queries.
        uint256 rate = Math.min(vestingRate, rateStrategy.predictedBorrowRate(cash, debt));
        return
            Math.mulDiv(
                Math.mulDiv(rate * 365 days, debt, cash + debt), 10_000 - market.interestFee(), 10_000
            );
    }

    function sync() external onlyVault returns (uint256) {
        market.accrueIfNeeded();
        uint256 cash = IERC20(asset).balanceOf(address(this));
        if (cash > 0) {
            IERC20(asset).safeTransfer(vault, cash);
        }
        return totalAssets();
    }

    function deposit(uint256 assets) external onlyVault {
        market.accrueIfNeeded();
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
        market.accrueIfNeeded();
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
