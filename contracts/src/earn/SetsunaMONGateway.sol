// SPDX-License-Identifier: MIT
pragma solidity 0.8.30;

import {IERC20} from "@openzeppelin/contracts/token/ERC20/IERC20.sol";
import {SafeERC20} from "@openzeppelin/contracts/token/ERC20/utils/SafeERC20.sol";
import {ReentrancyGuard} from "@openzeppelin/contracts/utils/ReentrancyGuard.sol";
import {SetsunaMONVault} from "./SetsunaMONVault.sol";

interface IWrappedMON is IERC20 {
    function deposit() external payable;
    function withdraw(uint256 amount) external;
}

/// @notice Atomic native MON entry/exit for a single fixed setsMON vault. No custody or admin powers.
contract SetsunaMONGateway is ReentrancyGuard {
    using SafeERC20 for IERC20;
    SetsunaMONVault public immutable vault;
    IWrappedMON public immutable wrappedMON;
    error InvalidConfiguration();
    error InvalidAmount();
    error InvalidReceiver();
    error BalanceMismatch();
    error NativeTransferFailed();
    error UnexpectedNativeTransfer();
    event NativeDeposited(address indexed caller, address indexed receiver, uint256 assets, uint256 shares);
    event NativeRedeemed(address indexed owner, address indexed receiver, uint256 assets, uint256 shares);

    constructor(SetsunaMONVault vault_) {
        if (address(vault_).code.length == 0 || !vault_.initialized() || vault_.decimals() != 24) {
            revert InvalidConfiguration();
        }
        vault = vault_;
        wrappedMON = IWrappedMON(vault_.asset());
    }

    receive() external payable {
        if (msg.sender != address(wrappedMON)) {
            revert UnexpectedNativeTransfer();
        }
    }

    function depositMON(address receiver, uint256 minShares, uint256 deadline)
        external
        payable
        nonReentrant
        returns (uint256 shares)
    {
        if (msg.value == 0) {
            revert InvalidAmount();
        }
        if (receiver == address(0) || receiver == address(this)) {
            revert InvalidReceiver();
        }
        uint256 beforeWrapped = wrappedMON.balanceOf(address(this));
        wrappedMON.deposit{value: msg.value}();
        if (wrappedMON.balanceOf(address(this)) != beforeWrapped + msg.value) {
            revert BalanceMismatch();
        }
        IERC20(address(wrappedMON)).forceApprove(address(vault), msg.value);
        shares = vault.depositWithMinShares(msg.value, receiver, minShares, deadline);
        IERC20(address(wrappedMON)).forceApprove(address(vault), 0);
        if (wrappedMON.balanceOf(address(this)) != beforeWrapped) {
            revert BalanceMismatch();
        }
        emit NativeDeposited(msg.sender, receiver, msg.value, shares);
    }

    /// @dev Caller approves exactly their selected setsMON shares to this gateway first.
    ///      There is no owner argument: nobody can use another depositor's gateway approval.
    function redeemMON(uint256 shares, address payable receiver, uint256 minAssets, uint256 deadline)
        external
        nonReentrant
        returns (uint256 assets)
    {
        if (shares == 0) {
            revert InvalidAmount();
        }
        if (receiver == address(0) || receiver == address(this)) {
            revert InvalidReceiver();
        }
        uint256 beforeWrapped = wrappedMON.balanceOf(address(this));
        uint256 beforeNative = address(this).balance;
        assets = vault.redeemWithMinAssets(shares, address(this), msg.sender, minAssets, deadline);
        if (assets == 0 || wrappedMON.balanceOf(address(this)) != beforeWrapped + assets) {
            revert BalanceMismatch();
        }
        wrappedMON.withdraw(assets);
        if (
            wrappedMON.balanceOf(address(this)) != beforeWrapped
                || address(this).balance != beforeNative + assets
        ) {
            revert BalanceMismatch();
        }
        (bool paid,) = receiver.call{value: assets}("");
        if (!paid) {
            revert NativeTransferFailed();
        }
        emit NativeRedeemed(msg.sender, receiver, assets, shares);
    }
}
