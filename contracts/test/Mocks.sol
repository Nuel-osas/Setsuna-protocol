// SPDX-License-Identifier: MIT
pragma solidity 0.8.30;

import {ERC20} from "@openzeppelin/contracts/token/ERC20/ERC20.sol";
import {IPerplExchange as E} from "../src/interfaces/IPerplExchange.sol";

contract MockAUSD is ERC20 {
    address public blockedRecipient;
    constructor() ERC20("Test AUSD", "AUSD") {}

    function decimals() public pure override returns (uint8) {
        return 6;
    }

    function mint(address to, uint256 amount) external {
        _mint(to, amount);
    }

    function burn(address from, uint256 amount) external {
        _burn(from, amount);
    }

    function blockRecipient(address who) external {
        blockedRecipient = who;
    }

    function _update(address from, address to, uint256 amount) internal override {
        require(to != blockedRecipient || to == address(0), "recipient blocked");
        super._update(from, to, amount);
    }
}

/// @dev A fault-injection model, not evidence of actual venue behavior. Fork tests supply that evidence.
contract MockPerpl {
    enum Failure {
        None,
        DepositRevert,
        DepositNoop,
        IncreaseRevert,
        IncreaseNoop,
        WrongDelta,
        WrongPosition,
        WrongFree
    }
    MockAUSD public immutable token;
    uint256 public count;
    mapping(address => uint256) public idOf;
    mapping(uint256 => E.AccountInfo) private accounts;
    mapping(uint256 => E.PositionInfoV2) private positions;
    mapping(uint256 => bool) public forwarding;
    uint256 public lockCount;
    uint256 public markTimestamp;
    bool public markValid = true;
    uint256 public factor = 2500;
    Failure public failure;
    address public callback;
    bool public callbackRejected;
    event PositionDoesNotExist(uint256 perpId, uint256 accountId);

    constructor(MockAUSD token_) {
        token = token_;
        markTimestamp = block.timestamp;
    }

    function setFailure(Failure mode) external {
        failure = mode;
    }

    function setLocks(uint256 count_) external {
        lockCount = count_;
    }

    function setMark(bool valid, uint256 timestamp) external {
        markValid = valid;
        markTimestamp = timestamp;
    }

    function setPnl(uint256 id, int256 delta, int256 funding) external {
        positions[id].deltaPnlCNS = delta;
        positions[id].premiumPnlCNS = funding;
        positions[id].pnlCNS = delta + funding;
    }

    function setPosition(uint256 id, E.PositionInfoV2 memory p) external {
        positions[id] = p;
    }

    function setFrozen(uint256 id, uint8 value) external {
        accounts[id].frozen = value;
    }

    function setCallback(address target) external {
        callback = target;
    }

    function createAccount(uint256 amount) external returns (uint256 id) {
        require(idOf[msg.sender] == 0);
        token.transferFrom(msg.sender, address(this), amount);
        id = ++count;
        idOf[msg.sender] = id;
        accounts[id].accountId = id;
        accounts[id].accountAddr = msg.sender;
        accounts[id].balanceCNS = amount;
    }

    function allowOrderForwarding(bool enabled) external {
        forwarding[idOf[msg.sender]] = enabled;
    }

    function depositCollateral(uint256 amount) external {
        require(failure != Failure.DepositRevert, "deposit failure");
        if (failure == Failure.DepositNoop) {
            return;
        }
        if (callback != address(0)) {
            (bool ok, bytes memory reason) = callback.call(abi.encodeWithSignature("topUp()"));
            callbackRejected = !ok && bytes4(reason) == bytes4(keccak256("ReentrancyGuardReentrantCall()"));
        }
        token.transferFrom(msg.sender, address(this), amount);
        accounts[idOf[msg.sender]].balanceCNS += amount;
    }

    function withdrawCollateral(uint256 amount) external {
        accounts[idOf[msg.sender]].balanceCNS -= amount;
        token.transfer(msg.sender, amount);
    }

    function increasePositionCollateral(uint256 perp, uint256 amount) external {
        require(failure != Failure.IncreaseRevert, "increase failure");
        uint256 id = idOf[msg.sender];
        if (failure == Failure.IncreaseNoop || positions[id].lotLNS == 0) {
            emit PositionDoesNotExist(perp, id);
            return;
        }
        positions[id].depositCNS += failure == Failure.WrongDelta ? amount - 1 : amount;
        if (failure == Failure.WrongPosition) {
            ++positions[id].priceResiduePNSQ16;
        }
        accounts[id].balanceCNS -= failure == Failure.WrongFree ? amount - 1 : amount;
    }

    function execOrder(E.OrderDesc memory order) external returns (E.OrderSignature memory) {
        uint256 id = idOf[msg.sender];
        if (order.orderType >= 2) {
            accounts[id].balanceCNS += positions[id].depositCNS;
            delete positions[id];
        } else {
            E.PositionInfoV2 storage p = positions[id];
            p.accountId = id;
            p.positionType = order.orderType;
            p.pricePNS = 1_000_000; // $100,000.
            p.lotLNS = order.lotLNS;
            p.entryBlock = block.number;
            p.depositCNS = 80e6;
            accounts[id].balanceCNS -= 80e6;
        }
        return E.OrderSignature(order.perpId, 0);
    }

    function getAccountById(uint256 id) external view returns (E.AccountInfo memory) {
        return accounts[id];
    }

    function getOrderLocks(uint256) external view returns (E.OrderLock[] memory) {
        return new E.OrderLock[](lockCount);
    }

    function getPositionV2(uint256, uint256 id)
        external
        view
        returns (E.PositionInfoV2 memory, uint256, bool)
    {
        return (positions[id], 968_000, markValid);
    }

    function getPerpetualInfo(uint256) external view returns (E.PerpetualInfo memory p) {
        p.priceDecimals = 1;
        p.lotDecimals = 5;
        p.markTimestamp = markTimestamp;
        p.markPNS = 968_000;
        p.status = 4;
    }

    function getMarginFractions(uint256, uint256)
        external
        view
        returns (uint256, uint256, uint256, uint256, uint256, uint256)
    {
        return (1500, factor, 1500, 30_000_000, 90, 95);
    }
}
