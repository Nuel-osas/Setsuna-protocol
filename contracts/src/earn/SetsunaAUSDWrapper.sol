// SPDX-License-Identifier: MIT
pragma solidity 0.8.30;

import {IERC20} from "@openzeppelin/contracts/token/ERC20/IERC20.sol";
import {IERC20Metadata} from "@openzeppelin/contracts/token/ERC20/extensions/IERC20Metadata.sol";
import {ERC20} from "@openzeppelin/contracts/token/ERC20/ERC20.sol";
import {ERC20Permit} from "@openzeppelin/contracts/token/ERC20/extensions/ERC20Permit.sol";
import {IERC4626} from "@openzeppelin/contracts/interfaces/IERC4626.sol";
import {SafeERC20} from "@openzeppelin/contracts/token/ERC20/utils/SafeERC20.sol";
import {Math} from "@openzeppelin/contracts/utils/math/Math.sol";
import {ReentrancyGuard} from "@openzeppelin/contracts/utils/ReentrancyGuard.sol";

/// @notice The parts of a Curve stable-ng pool the wrapper uses.
interface ICurveStablePool {
    function coins(uint256 i) external view returns (address);
    function get_dy(int128 i, int128 j, uint256 dx) external view returns (uint256);
    function exchange(int128 i, int128 j, uint256 dx, uint256 minDy) external returns (uint256);
}

/// @title SetsunaAUSDWrapper
/// @notice Save AUSD in setsUSDC. AUSD in, AUSD out: deposits swap AUSD to USDC on one fixed Curve
/// stable pool and supply setsUSDC; redemptions take USDC out of setsUSDC and swap it back.
/// The shares carry EIP-2612 permit, so a relayer can carry out a holder's signed redemption and
/// the holder never needs gas.
/// @dev Each wrapper share is exactly one setsUSDC share held here, so yield, fee, cap and withdrawal
/// limits are setsUSDC's own. Every swap must return at least MIN_OUT_BPS of one-for-one or it reverts,
/// so a depeg stops deposits and redemptions instead of filling them at a bad rate; `unwrap` always
/// hands back plain setsUSDC. ERC-4626 `mint` and `withdraw` are not offered (max is 0): the swap makes
/// exact-output amounts unknowable in advance. No owner, no admin, no fee, no upgrade.
contract SetsunaAUSDWrapper is ERC20Permit, IERC4626, ReentrancyGuard {
    using SafeERC20 for IERC20;

    /// @notice Least a swap may return, in basis points of the amount put in (99.8%).
    uint256 public constant MIN_OUT_BPS = 9_980;
    /// @notice How far `previewDeposit` rounds down, in basis points (0.01%).
    uint256 public constant PREVIEW_MARGIN_BPS = 1;

    IERC4626 public immutable vault;
    ICurveStablePool public immutable pool;
    IERC20 public immutable ausd;
    IERC20 public immutable usdc;
    int128 public immutable ausdIndex;
    int128 public immutable usdcIndex;
    uint8 private immutable _decimals;

    error InvalidConfiguration();
    error InvalidAmount();
    error InvalidReceiver();
    error Unsupported();
    error InsufficientOutput(uint256 received, uint256 minimum);

    event Wrapped(address indexed caller, address indexed receiver, uint256 shares);
    event Unwrapped(address indexed owner, address indexed receiver, uint256 shares);

    constructor(
        IERC4626 vault_,
        ICurveStablePool pool_,
        IERC20 ausd_,
        int128 ausdIndex_,
        int128 usdcIndex_,
        string memory name_,
        string memory symbol_
    ) ERC20(name_, symbol_) ERC20Permit(name_) {
        if (address(vault_).code.length == 0 || address(pool_).code.length == 0) revert InvalidConfiguration();
        address usdc_ = vault_.asset();
        if (
            ausdIndex_ < 0 || usdcIndex_ < 0 || ausdIndex_ == usdcIndex_
                || pool_.coins(uint256(uint128(ausdIndex_))) != address(ausd_)
                || pool_.coins(uint256(uint128(usdcIndex_))) != usdc_
                || IERC20Metadata(address(ausd_)).decimals() != IERC20Metadata(usdc_).decimals()
        ) revert InvalidConfiguration();
        vault = vault_;
        pool = pool_;
        ausd = ausd_;
        usdc = IERC20(usdc_);
        ausdIndex = ausdIndex_;
        usdcIndex = usdcIndex_;
        _decimals = vault_.decimals();
    }

    /* ── ERC-20 ── */

    function decimals() public view override(ERC20, IERC20Metadata) returns (uint8) {
        return _decimals;
    }

    /* ── ERC-4626 views. USDC is counted one-for-one as AUSD; previews quote the pool. ── */

    function asset() public view returns (address) {
        return address(ausd);
    }

    function totalAssets() public view returns (uint256) {
        return vault.convertToAssets(totalSupply());
    }

    function convertToShares(uint256 assets) public view returns (uint256) {
        return vault.convertToShares(assets);
    }

    function convertToAssets(uint256 shares) public view returns (uint256) {
        return vault.convertToAssets(shares);
    }

    function maxDeposit(address) public view returns (uint256) {
        return vault.maxDeposit(address(this));
    }

    function maxMint(address) public pure returns (uint256) {
        return 0;
    }

    function maxWithdraw(address) public pure returns (uint256) {
        return 0;
    }

    function maxRedeem(address owner) public view returns (uint256) {
        return Math.min(balanceOf(owner), vault.maxRedeem(address(this)));
    }

    /// @dev setsUSDC accrues interest inside `deposit`, so its own preview can run a hair above what a
    /// deposit mints. Rounding down by PREVIEW_MARGIN_BPS keeps this preview at or below the result.
    function previewDeposit(uint256 assets) public view returns (uint256) {
        if (assets == 0) return 0;
        uint256 shares = vault.previewDeposit(pool.get_dy(ausdIndex, usdcIndex, assets));
        return shares - shares * PREVIEW_MARGIN_BPS / 10_000;
    }

    function previewMint(uint256) public pure returns (uint256) {
        revert Unsupported();
    }

    function previewWithdraw(uint256) public pure returns (uint256) {
        revert Unsupported();
    }

    function previewRedeem(uint256 shares) public view returns (uint256) {
        uint256 usdcOut = vault.previewRedeem(shares);
        return usdcOut == 0 ? 0 : pool.get_dy(usdcIndex, ausdIndex, usdcOut);
    }

    /* ── Actions ── */

    function deposit(uint256 assets, address receiver) external nonReentrant returns (uint256) {
        return _deposit(assets, receiver, 0);
    }

    /// @notice `deposit` that also reverts if it would mint fewer than `minShares`.
    function depositWithMinShares(uint256 assets, address receiver, uint256 minShares)
        external
        nonReentrant
        returns (uint256)
    {
        return _deposit(assets, receiver, minShares);
    }

    function redeem(uint256 shares, address receiver, address owner) external nonReentrant returns (uint256) {
        return _redeem(shares, receiver, owner, 0);
    }

    /// @notice `redeem` that also reverts if it would return less than `minAssets` AUSD.
    function redeemWithMinAssets(uint256 shares, address receiver, address owner, uint256 minAssets)
        external
        nonReentrant
        returns (uint256)
    {
        return _redeem(shares, receiver, owner, minAssets);
    }

    function mint(uint256, address) external pure returns (uint256) {
        revert Unsupported();
    }

    function withdraw(uint256, address, address) external pure returns (uint256) {
        revert Unsupported();
    }

    /// @notice Wrap setsUSDC shares the caller already holds, one for one.
    function wrap(uint256 shares, address receiver) external nonReentrant {
        if (shares == 0) revert InvalidAmount();
        if (receiver == address(0)) revert InvalidReceiver();
        IERC20(address(vault)).safeTransferFrom(msg.sender, address(this), shares);
        _mint(receiver, shares);
        emit Wrapped(msg.sender, receiver, shares);
    }

    /// @notice Hand back plain setsUSDC shares, one for one. Works whatever the pool or the peg does.
    function unwrap(uint256 shares, address receiver, address owner) external nonReentrant {
        if (shares == 0) revert InvalidAmount();
        if (receiver == address(0)) revert InvalidReceiver();
        if (msg.sender != owner) _spendAllowance(owner, msg.sender, shares);
        _burn(owner, shares);
        IERC20(address(vault)).safeTransfer(receiver, shares);
        emit Unwrapped(owner, receiver, shares);
    }

    /* ── Internals ── */

    function _deposit(uint256 assets, address receiver, uint256 minShares) private returns (uint256 shares) {
        if (assets == 0) revert InvalidAmount();
        if (receiver == address(0)) revert InvalidReceiver();
        ausd.safeTransferFrom(msg.sender, address(this), assets);
        uint256 usdcIn = _swap(ausd, ausdIndex, usdcIndex, assets);
        usdc.forceApprove(address(vault), usdcIn);
        shares = vault.deposit(usdcIn, address(this));
        if (shares < minShares) revert InsufficientOutput(shares, minShares);
        _mint(receiver, shares);
        emit Deposit(msg.sender, receiver, assets, shares);
    }

    function _redeem(uint256 shares, address receiver, address owner, uint256 minAssets)
        private
        returns (uint256 assets)
    {
        if (shares == 0) revert InvalidAmount();
        if (receiver == address(0)) revert InvalidReceiver();
        if (msg.sender != owner) _spendAllowance(owner, msg.sender, shares);
        _burn(owner, shares);
        uint256 usdcOut = vault.redeem(shares, address(this), address(this));
        assets = _swap(usdc, usdcIndex, ausdIndex, usdcOut);
        if (assets < minAssets) revert InsufficientOutput(assets, minAssets);
        ausd.safeTransfer(receiver, assets);
        emit Withdraw(msg.sender, receiver, owner, assets, shares);
    }

    /// @dev Swaps on the fixed pool; reverts below MIN_OUT_BPS of one-for-one (same decimals).
    function _swap(IERC20 tokenIn, int128 i, int128 j, uint256 amountIn) private returns (uint256 out) {
        uint256 floor = amountIn * MIN_OUT_BPS / 10_000;
        tokenIn.forceApprove(address(pool), amountIn);
        out = pool.exchange(i, j, amountIn, floor);
        tokenIn.forceApprove(address(pool), 0);
        if (out < floor) revert InsufficientOutput(out, floor);
    }
}
