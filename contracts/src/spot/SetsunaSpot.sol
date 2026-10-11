// SPDX-License-Identifier: MIT
pragma solidity 0.8.30;

import {IERC20} from "@openzeppelin/contracts/token/ERC20/IERC20.sol";
import {SafeERC20} from "@openzeppelin/contracts/token/ERC20/utils/SafeERC20.sol";
import {ReentrancyGuard} from "@openzeppelin/contracts/utils/ReentrancyGuard.sol";
import {Math} from "@openzeppelin/contracts/utils/math/Math.sol";

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
/// A fixed fee on each swap's output goes to a fixed treasury; `minOut` bounds what the caller receives.
/// @dev The external Kuru market is upgradeable; this wrapper does not remove venue governance risk.
contract SetsunaSpot is ReentrancyGuard {
    using SafeERC20 for IERC20;
    IKuruSpotMarket public immutable market;
    IERC20 public immutable usdc;
    uint256 public immutable pricePrecision;
    uint256 public immutable sizePrecision;
    uint256 public constant MAX_FEE_BPS = 100;
    address public immutable feeRecipient;
    uint256 public immutable feeBps;

    error InvalidMarket();
    error InvalidAmount();
    error Expired();
    error UnexpectedDelta();
    error NativeTransferFailed();
    event Swapped(address indexed owner, bool monToUSDC, uint256 amountIn, uint256 amountOut);
    event SwapFee(address indexed owner, bool monToUSDC, uint256 fee);

    constructor(IKuruSpotMarket market_, IERC20 usdc_, address feeRecipient_, uint256 feeBps_) {
        if (feeBps_ > MAX_FEE_BPS || (feeBps_ != 0 && feeRecipient_ == address(0))) {
            revert InvalidAmount();
        }
        (uint32 p, uint96 s, address base, uint256 bd, address quote, uint256 qd,,,,,) = market_.getMarketParams();
        if (base != address(0) || bd != 18 || quote != address(usdc_) || qd != 6 || p == 0 || s == 0) {
            revert InvalidMarket();
        }
        market = market_;
        usdc = usdc_;
        feeRecipient = feeRecipient_;
        feeBps = feeBps_;
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
        uint256 gross = market.placeAndExecuteMarketSell{value: msg.value}(size, _grossMin(minOut), false, true);
        if (usdc.balanceOf(address(this)) != tokenBefore + gross || address(this).balance != nativeBefore) {
            revert UnexpectedDelta();
        }
        uint256 fee = _fee(gross);
        out = gross - fee;
        if (out < minOut) revert UnexpectedDelta();
        uint256 ownerBefore = usdc.balanceOf(msg.sender);
        usdc.safeTransfer(msg.sender, out);
        if (fee != 0) usdc.safeTransfer(feeRecipient, fee);
        if (usdc.balanceOf(msg.sender) != ownerBefore + out || usdc.balanceOf(address(this)) != tokenBefore) {
            revert UnexpectedDelta();
        }
        emit Swapped(msg.sender, true, msg.value, out);
        if (fee != 0) emit SwapFee(msg.sender, true, fee);
    }

    function buyMON(uint256 amount, uint256 minOut, uint256 deadline) external nonReentrant returns (uint256 out) {
        _check(minOut, deadline);
        uint96 quote = _units(amount, pricePrecision, 1e6);
        uint256 nativeBefore = address(this).balance;
        uint256 tokenBefore = usdc.balanceOf(address(this));
        usdc.safeTransferFrom(msg.sender, address(this), amount);
        if (usdc.balanceOf(address(this)) != tokenBefore + amount) revert UnexpectedDelta();
        usdc.forceApprove(address(market), amount);
        uint256 gross = market.placeAndExecuteMarketBuy(quote, _grossMin(minOut), false, true);
        usdc.forceApprove(address(market), 0);
        if (address(this).balance != nativeBefore + gross || usdc.balanceOf(address(this)) != tokenBefore) {
            revert UnexpectedDelta();
        }
        uint256 fee = _fee(gross);
        out = gross - fee;
        if (out < minOut) revert UnexpectedDelta();
        (bool paid,) = payable(msg.sender).call{value: out}("");
        if (!paid) revert NativeTransferFailed();
        if (fee != 0) {
            (bool feePaid,) = payable(feeRecipient).call{value: fee}("");
            if (!feePaid) revert NativeTransferFailed();
        }
        if (address(this).balance != nativeBefore) revert UnexpectedDelta();
        emit Swapped(msg.sender, false, amount, out);
        if (fee != 0) emit SwapFee(msg.sender, false, fee);
    }

    function _fee(uint256 gross) private view returns (uint256) {
        return gross * feeBps / 10_000;
    }

    /// @dev The venue minimum that still leaves at least `minOut` after the fee.
    function _grossMin(uint256 minOut) private view returns (uint256) {
        return Math.mulDiv(minOut, 10_000, 10_000 - feeBps, Math.Rounding.Ceil);
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
