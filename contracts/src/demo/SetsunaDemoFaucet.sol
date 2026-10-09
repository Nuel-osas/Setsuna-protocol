// SPDX-License-Identifier: MIT
pragma solidity 0.8.30;

import {IERC20} from "@openzeppelin/contracts/token/ERC20/IERC20.sol";
import {SafeERC20} from "@openzeppelin/contracts/token/ERC20/utils/SafeERC20.sol";
import {ReentrancyGuard} from "@openzeppelin/contracts/utils/ReentrancyGuard.sol";

/// @notice Synthetic funds only. Cannot be deployed or used on Monad mainnet.
/// @dev A fixed dispatcher pays transaction gas so an empty wallet can receive funds.
contract SetsunaDemoFaucet is ReentrancyGuard {
    using SafeERC20 for IERC20;

    uint256 public constant DEMO_CHAIN_ID = 31337;
    uint256 public constant MON_AMOUNT = 101 ether;
    uint256 public constant TOKEN_AMOUNT = 1_000e6;
    uint256 public constant COOLDOWN = 1 days;
    uint256 public constant MAX_CLAIMS = 100;
    IERC20 public constant USDC = IERC20(0x754704Bc059F8C67012fEd69BC8A327a5aafb603);
    IERC20 public constant AUSD = IERC20(0x00000000eFE302BEAA2b3e6e1b18d08D69a9012a);
    address public immutable dispatcher;
    uint256 public claims;
    mapping(address => uint256) public nextClaimAt;

    error WrongChain();
    error Unauthorized();
    error InvalidRecipient();
    error ClaimUnavailable();
    error TransferFailed();
    event DemoFundsClaimed(address indexed recipient, uint256 nextClaimAt);

    constructor(address dispatcher_) {
        if (block.chainid != DEMO_CHAIN_ID) revert WrongChain();
        if (dispatcher_ == address(0)) revert InvalidRecipient();
        dispatcher = dispatcher_;
    }

    receive() external payable {}

    function claim(address recipient) external nonReentrant {
        if (block.chainid != DEMO_CHAIN_ID) revert WrongChain();
        if (msg.sender != dispatcher) revert Unauthorized();
        if (recipient == address(0) || recipient == address(this) || recipient == dispatcher) {
            revert InvalidRecipient();
        }
        if (block.timestamp < nextClaimAt[recipient] || claims >= MAX_CLAIMS) revert ClaimUnavailable();
        nextClaimAt[recipient] = block.timestamp + COOLDOWN;
        ++claims;
        USDC.safeTransfer(recipient, TOKEN_AMOUNT);
        AUSD.safeTransfer(recipient, TOKEN_AMOUNT);
        (bool sent,) = recipient.call{value: MON_AMOUNT}("");
        if (!sent) revert TransferFailed();
        emit DemoFundsClaimed(recipient, nextClaimAt[recipient]);
    }
}
