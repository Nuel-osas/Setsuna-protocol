// SPDX-License-Identifier: MIT
pragma solidity 0.8.30;

import {IERC20} from "@openzeppelin/contracts/token/ERC20/IERC20.sol";
import {IPerplExchange} from "./interfaces/IPerplExchange.sol";
import {SetsunaAccount} from "./SetsunaAccount.sol";

/// @notice Fixed venue/token/market, one immutable-owner account per wallet.
contract SetsunaFactory {
    IPerplExchange public immutable exchange;
    IERC20 public immutable collateral;
    uint256 public immutable perpId;
    mapping(address => address) public accountOf;
    error AccountAlreadyExists();
    event AccountCreated(address indexed owner, address indexed account, uint256 perpId);

    constructor(IPerplExchange exchange_, IERC20 collateral_, uint256 perpId_) {
        exchange = exchange_;
        collateral = collateral_;
        perpId = perpId_;
    }

    function createAccount() external returns (address account) {
        if (accountOf[msg.sender] != address(0)) {
            revert AccountAlreadyExists();
        }
        account = address(new SetsunaAccount(msg.sender, exchange, collateral, perpId));
        accountOf[msg.sender] = account;
        emit AccountCreated(msg.sender, account, perpId);
    }
}
