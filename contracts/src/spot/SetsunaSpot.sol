// SPDX-License-Identifier: MIT
pragma solidity 0.8.30;

import {IERC20} from "@openzeppelin/contracts/token/ERC20/IERC20.sol";
import {SafeERC20} from "@openzeppelin/contracts/token/ERC20/utils/SafeERC20.sol";
import {ReentrancyGuard} from "@openzeppelin/contracts/utils/ReentrancyGuard.sol";

interface IKuruSpotMarket {
    function getMarketParams() external view returns (
        uint32, uint96, address, uint256, address, uint256, uint32, uint96, uint96, uint256, uint256
    );
    function placeAndExecuteMarketBuy(uint96 quoteSize, uint256 minOut, bool margin, bool fillOrKill)
        external payable returns (uint256);
    function placeAndExecuteMarketSell(uint96 size, uint256 minOut, bool margin, bool fillOrKill)
        external payable returns (uint256);
}

/// @notice Fixed native MON/USDC Kuru route. No admin, arbitrary calls, shares, or retained approvals.
/// @dev The external Kuru market is upgradeable; this wrapper does not remove venue governance risk.
contract SetsunaSpot is ReentrancyGuard {
    using SafeERC20 for IERC20;
    IKuruSpotMarket public immutable market;
    IERC20 public immutable usdc;
    uint256 public immutable pricePrecision;
    uint256 public immutable sizePrecision;

    error InvalidMarket();
    error InvalidAmount();
    error Expired();
    error UnexpectedDelta();
    error NativeTransferFailed();
    event Swapped(address indexed owner, bool monToUSDC, uint256 amountIn, uint256 amountOut);

    constructor(IKuruSpotMarket market_, IERC20 usdc_) {
        (uint32 p, uint96 s, address base, uint256 bd, address quote, uint256 qd,,,,,) = market_.getMarketParams();
        if (base != address(0) || bd != 18 || quote != address(usdc_) || qd != 6 || p == 0 || s == 0) {
            revert InvalidMarket();
        }
        market = market_;
        usdc = usdc_;
        pricePrecision = p;
        sizePrecision = s;
    }

    // Kuru's MarginAccount pays native output; accept it only during a guarded swap.
    receive() external payable {
        if (!_reentrancyGuardEntered()) revert NativeTransferFailed();
    }

    function sellMON(uint256 minOut, uint256 deadline) external payable nonReentrant returns (uint256 out) {
        _check(minOut, deadline);
        uint96 size = _units(msg.value, sizePrecision, 1e18);
        uint256 nativeBefore = address(this).balance - msg.value;
        uint256 tokenBefore = usdc.balanceOf(address(this));
        out = market.placeAndExecuteMarketSell{value: msg.value}(size, minOut, false, true);
        if (out < minOut || usdc.balanceOf(address(this)) != tokenBefore + out || address(this).balance != nativeBefore) {
            revert UnexpectedDelta();
        }
        uint256 ownerBefore = usdc.balanceOf(msg.sender);
        usdc.safeTransfer(msg.sender, out);
        if (usdc.balanceOf(msg.sender) != ownerBefore + out || usdc.balanceOf(address(this)) != tokenBefore) {
            revert UnexpectedDelta();
        }
        emit Swapped(msg.sender, true, msg.value, out);
    }

    function buyMON(uint256 amount, uint256 minOut, uint256 deadline) external nonReentrant returns (uint256 out) {
        _check(minOut, deadline);
        uint96 quote = _units(amount, pricePrecision, 1e6);
        uint256 nativeBefore = address(this).balance;
        uint256 tokenBefore = usdc.balanceOf(address(this));
        usdc.safeTransferFrom(msg.sender, address(this), amount);
        if (usdc.balanceOf(address(this)) != tokenBefore + amount) revert UnexpectedDelta();
        usdc.forceApprove(address(market), amount);
        out = market.placeAndExecuteMarketBuy(quote, minOut, false, true);
        usdc.forceApprove(address(market), 0);
        if (out < minOut || address(this).balance != nativeBefore + out || usdc.balanceOf(address(this)) != tokenBefore) {
            revert UnexpectedDelta();
        }
        (bool paid,) = payable(msg.sender).call{value: out}("");
        if (!paid) revert NativeTransferFailed();
        if (address(this).balance != nativeBefore) revert UnexpectedDelta();
        emit Swapped(msg.sender, false, amount, out);
    }

    function _check(uint256 minOut, uint256 deadline) private view {
        if (block.timestamp > deadline) revert Expired();
        if (minOut == 0) revert InvalidAmount();
        // Fail closed if an upgrade changes the pair or input precision.
        (uint32 p, uint96 s, address base, uint256 bd, address quote, uint256 qd,,,,,) = market.getMarketParams();
        if (base != address(0) || quote != address(usdc) || bd != 18 || qd != 6 || p != pricePrecision || s != sizePrecision) {
            revert InvalidMarket();
        }
    }

    function _units(uint256 amount, uint256 precision, uint256 decimals) private pure returns (uint96) {
        if (amount == 0 || amount > type(uint96).max) revert InvalidAmount();
        uint256 units = amount * precision / decimals;
        // Never silently donate input dust to a precision conversion.
        if (units == 0 || units > type(uint96).max || units * decimals / precision != amount) revert InvalidAmount();
        return uint96(units);
    }
}
