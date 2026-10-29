// SPDX-License-Identifier: MIT
pragma solidity 0.8.30;

import {IERC20} from "@openzeppelin/contracts/token/ERC20/IERC20.sol";
import {IERC20Permit} from "@openzeppelin/contracts/token/ERC20/extensions/IERC20Permit.sol";
import {SafeERC20} from "@openzeppelin/contracts/token/ERC20/utils/SafeERC20.sol";
import {SetsunaAUSDWrapper} from "./SetsunaAUSDWrapper.sol";

/// @notice The EIP-3009 call AUSD offers: a transfer the holder signed, which only `to` may execute.
interface IReceiveWithAuthorization {
    function receiveWithAuthorization(
        address from,
        address to,
        uint256 value,
        uint256 validAfter,
        uint256 validBefore,
        bytes32 nonce,
        uint8 v,
        bytes32 r,
        bytes32 s
    ) external;
}

/// @title SetsunaAUSDSaver
/// @notice Lets anyone carry out a saver's signed setsAUSD deposit or withdrawal and pay its gas,
/// so the saver needs no MON. Setsuna's relayer uses it to sponsor gas for apps built on the SDK.
/// @dev In: the saver signs an AUSD receiveWithAuthorization naming this contract; only this
/// contract can execute it, and it deposits the AUSD into setsAUSD in the saver's own name.
/// Out: the saver signs a setsAUSD permit for this contract; it redeems those shares and the AUSD
/// goes to the saver. Whoever submits either call, value only ever reaches the saver.
/// `minShares` / `minAssets` are chosen by the submitter; setsAUSD's own 99.8% peg floor bounds
/// them regardless. No owner, no admin, no fee. Holds nothing between calls.
contract SetsunaAUSDSaver {
    using SafeERC20 for IERC20;

    SetsunaAUSDWrapper public immutable wrapper;
    IERC20 public immutable ausd;

    event Saved(address indexed owner, uint256 assets, uint256 shares, address indexed relayer);
    event Withdrawn(address indexed owner, uint256 shares, uint256 assets, address indexed relayer);

    error InvalidConfiguration();

    constructor(SetsunaAUSDWrapper wrapper_) {
        if (address(wrapper_).code.length == 0) revert InvalidConfiguration();
        wrapper = wrapper_;
        ausd = IERC20(wrapper_.asset());
    }

    /// @notice Into savings: `value` AUSD the owner signed over to this contract, saved in their name.
    function save(
        address owner,
        uint256 value,
        uint256 validAfter,
        uint256 validBefore,
        bytes32 nonce,
        uint8 v,
        bytes32 r,
        bytes32 s,
        uint256 minShares
    ) external returns (uint256 shares) {
        IReceiveWithAuthorization(address(ausd)).receiveWithAuthorization(
            owner, address(this), value, validAfter, validBefore, nonce, v, r, s
        );
        ausd.forceApprove(address(wrapper), value);
        shares = wrapper.depositWithMinShares(value, owner, minShares);
        emit Saved(owner, value, shares, msg.sender);
    }

    /// @notice Out of savings: `shares` of the owner's setsAUSD, redeemed to the owner as AUSD.
    function withdraw(
        address owner,
        uint256 shares,
        uint256 deadline,
        uint8 v,
        bytes32 r,
        bytes32 s,
        uint256 minAssets
    ) external returns (uint256 assets) {
        // A permit already used by a front-runner has still set the allowance; carry on.
        try IERC20Permit(address(wrapper)).permit(owner, address(this), shares, deadline, v, r, s) {} catch {}
        assets = wrapper.redeemWithMinAssets(shares, owner, owner, minAssets);
        emit Withdrawn(owner, shares, assets, msg.sender);
    }
}
