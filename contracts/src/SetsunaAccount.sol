// SPDX-License-Identifier: MIT
pragma solidity 0.8.30;

import {IERC20} from "@openzeppelin/contracts/token/ERC20/IERC20.sol";
import {IERC20Metadata} from "@openzeppelin/contracts/token/ERC20/extensions/IERC20Metadata.sol";
import {SafeERC20} from "@openzeppelin/contracts/token/ERC20/utils/SafeERC20.sol";
import {ReentrancyGuard} from "@openzeppelin/contracts/utils/ReentrancyGuard.sol";
import {Math} from "@openzeppelin/contracts/utils/math/Math.sol";
import {SafeCast} from "@openzeppelin/contracts/utils/math/SafeCast.sol";
import {IPerplExchange} from "./interfaces/IPerplExchange.sol";
import {PerplRisk} from "./PerplRisk.sol";

/// @notice One owner, one Perpl market, one active capped margin policy.
/// @dev No delegatecall, generic execution, delegated trading or upgrades.
contract SetsunaAccount is ReentrancyGuard {
    using SafeERC20 for IERC20;

    enum Status {
        Ready,
        Inactive,
        NoPosition,
        BindingChanged,
        OutstandingOrders,
        VenueUnavailable,
        InvalidMark,
        StaleMark,
        NotTriggered,
        BelowMinimum,
        InsufficientBudget,
        InsolventReserve
    }

    struct PolicyConfig {
        uint256 capCNS;
        uint256 minTopUpCNS;
        uint256 feeMaxCNS;
        uint16 triggerBufferBps;
        uint16 targetBufferBps;
        uint16 feeBps;
        uint32 maxMarkAgeSec;
    }

    struct Policy {
        PolicyConfig config;
        uint256 usedCNS;
        bytes32 binding;
        bool active;
    }

    struct Quote {
        Status status;
        uint256 policyId;
        uint256 amountCNS;
        uint256 feeCNS;
        uint256 protocolFeeCNS;
        uint256 spendableCNS;
        uint256 maintenanceCNS;
        int256 equityCNS;
        uint256 triggerEquityCNS;
        uint256 targetEquityCNS;
        uint256 markTimestamp;
    }

    address public immutable owner;
    IPerplExchange public immutable exchange;
    IERC20 public immutable collateral;
    uint256 public immutable perpId;
    /// @notice Fixed Setsuna fee on each top-up, paid from the reserve to a fixed treasury.
    uint256 public constant MAX_PROTOCOL_FEE_BPS = 500;
    address public immutable protocolFeeRecipient;
    uint256 public immutable protocolFeeBps;
    uint256 public accountId;
    uint256 public reserveCNS;
    uint256 public positionNonce;
    uint256 public currentPolicyId;
    mapping(uint256 => Policy) private _policies;
    uint256[] private _orderIds;
    uint256 public constant MAX_OPEN_ORDERS = 64;

    error Unauthorized();
    error InvalidConfiguration();
    error NotInitialized();
    error AlreadyInitialized();
    error PolicyAlreadyActive();
    error CannotArm(Status reason);
    error UnsupportedOrder();
    error UnexpectedDelta();
    error ReserveInsolvent();

    event Initialized(uint256 indexed accountId, uint256 tradingCNS);
    event ReserveFunded(uint256 amountCNS, uint256 reserveCNS);
    event ReserveWithdrawn(uint256 amountCNS, uint256 reserveCNS);
    event TradingDeposited(uint256 amountCNS);
    event TradingWithdrawn(uint256 amountCNS);
    event OrderSubmitted(uint256 indexed positionNonce, uint8 orderType, uint256 lotLNS);
    event LimitOrderPlaced(uint256 indexed orderId, uint8 side, uint256 pricePNS, uint256 lotLNS);
    event LimitOrderCancelled(uint256 indexed orderId);
    event PolicyArmed(uint256 indexed policyId, bytes32 binding, PolicyConfig config);
    event PolicyRevoked(uint256 indexed policyId, uint256 usedCNS);
    event CapChanged(uint256 indexed policyId, uint256 capCNS, uint256 usedCNS);
    event Refused(uint256 indexed policyId, Status reason);
    event ProtocolFeePaid(uint256 indexed policyId, address indexed recipient, uint256 feeCNS);
    event ToppedUp(
        uint256 indexed policyId,
        address indexed rescuer,
        uint256 amountCNS,
        uint256 feeCNS,
        uint256 usedCNS,
        uint256 reserveCNS
    );

    modifier onlyOwner() {
        if (msg.sender != owner) {
            revert Unauthorized();
        }
        _;
    }

    constructor(
        address owner_,
        IPerplExchange exchange_,
        IERC20 collateral_,
        uint256 perpId_,
        address protocolFeeRecipient_,
        uint256 protocolFeeBps_
    ) {
        if (
            owner_ == address(0) || address(exchange_).code.length == 0
                || address(collateral_).code.length == 0 || perpId_ == 0
                || IERC20Metadata(address(collateral_)).decimals() != 6
                || protocolFeeBps_ > MAX_PROTOCOL_FEE_BPS
                || (protocolFeeBps_ != 0 && protocolFeeRecipient_ == address(0))
        ) {
            revert InvalidConfiguration();
        }
        owner = owner_;
        exchange = exchange_;
        collateral = collateral_;
        perpId = perpId_;
        protocolFeeRecipient = protocolFeeRecipient_;
        protocolFeeBps = protocolFeeBps_;
    }

    function initialize(uint256 initialTradingCNS) external onlyOwner nonReentrant {
        if (accountId != 0) {
            revert AlreadyInitialized();
        }
        uint256 beforeTokens = collateral.balanceOf(address(this));
        _pullExact(initialTradingCNS);
        collateral.forceApprove(address(exchange), initialTradingCNS);
        uint256 id = exchange.createAccount(initialTradingCNS);
        collateral.forceApprove(address(exchange), 0);
        IPerplExchange.AccountInfo memory info = exchange.getAccountById(id);
        if (
            id == 0 || info.accountId != id || info.accountAddr != address(this)
                || info.balanceCNS != initialTradingCNS || collateral.balanceOf(address(this)) != beforeTokens
        ) {
            revert UnexpectedDelta();
        }
        accountId = id;
        exchange.allowOrderForwarding(false);
        _assertSolvent();
        emit Initialized(id, initialTradingCNS);
    }

    function fundReserve(uint256 amountCNS) external onlyOwner nonReentrant {
        _pullExact(amountCNS);
        reserveCNS += amountCNS;
        _assertSolvent();
        emit ReserveFunded(amountCNS, reserveCNS);
    }

    function withdrawReserve(uint256 amountCNS) external onlyOwner nonReentrant {
        if (amountCNS == 0 || amountCNS > reserveCNS) {
            revert InvalidConfiguration();
        }
        reserveCNS -= amountCNS;
        _transferExact(owner, amountCNS);
        _assertSolvent();
        emit ReserveWithdrawn(amountCNS, reserveCNS);
    }

    /// @notice Supplies NEW wallet funds. No part of the tracked reserve funds trading.
    function depositTrading(uint256 amountCNS) external onlyOwner nonReentrant {
        _requireInitialized();
        uint256 beforeTokens = collateral.balanceOf(address(this));
        uint256 beforeFree = exchange.getAccountById(accountId).balanceCNS;
        _pullExact(amountCNS);
        _depositExact(amountCNS);
        if (
            collateral.balanceOf(address(this)) != beforeTokens
                || exchange.getAccountById(accountId).balanceCNS != beforeFree + amountCNS
        ) {
            revert UnexpectedDelta();
        }
        _assertSolvent();
        emit TradingDeposited(amountCNS);
    }

    /// @notice Subject to Perpl's withdrawal allowance. This cannot remove position collateral.
    function withdrawTrading(uint256 amountCNS) external onlyOwner nonReentrant {
        _requireInitialized();
        if (amountCNS == 0) {
            revert InvalidConfiguration();
        }
        uint256 beforeFree = exchange.getAccountById(accountId).balanceCNS;
        uint256 beforeTokens = collateral.balanceOf(address(this));
        exchange.withdrawCollateral(amountCNS);
        if (
            amountCNS > beforeFree || exchange.getAccountById(accountId).balanceCNS != beforeFree - amountCNS
                || collateral.balanceOf(address(this)) != beforeTokens + amountCNS
        ) {
            revert UnexpectedDelta();
        }
        _transferExact(owner, amountCNS);
        _assertSolvent();
        emit TradingWithdrawn(amountCNS);
    }

    function orderTypesVersion() external pure returns (uint256) {
        return 1;
    }

    function executeOrder(IPerplExchange.OrderDesc calldata order) external onlyOwner nonReentrant {
        _requireInitialized();
        if (
            order.perpId != perpId || order.orderType > 3 || (order.immediateOrCancel && order.fillOrKill)
                || (order.postOnly && (order.immediateOrCancel || order.fillOrKill)) || order.orderId != 0
                || order.amountCNS != 0 || order.lotLNS == 0 || order.pricePNS == 0
        ) {
            revert UnsupportedOrder();
        }
        _compactOrders();
        bool resting = !order.immediateOrCancel && !order.fillOrKill;
        if (resting && _orderIds.length >= MAX_OPEN_ORDERS) {
            revert UnsupportedOrder();
        }
        _revoke();
        ++positionNonce; // Even a successful zero-fill IOC invalidates the old authorization.
        uint256 beforeTokens = collateral.balanceOf(address(this));
        IPerplExchange.OrderSignature memory signature = exchange.execOrder(order);
        if (resting && signature.orderId != 0) {
            IPerplExchange.Order memory placed = exchange.getOrder(perpId, signature.orderId);
            if (placed.accountId == accountId && placed.lotLNS != 0) {
                _orderIds.push(signature.orderId);
                emit LimitOrderPlaced(signature.orderId, order.orderType, order.pricePNS, order.lotLNS);
            }
        }
        if (collateral.balanceOf(address(this)) != beforeTokens) {
            revert UnexpectedDelta();
        }
        _assertSolvent();
        emit OrderSubmitted(positionNonce, order.orderType, order.lotLNS);
    }

    function getOpenOrders() external view returns (IPerplExchange.Order[] memory orders) {
        orders = new IPerplExchange.Order[](_orderIds.length);
        uint256 count;
        for (uint256 i; i < _orderIds.length; ++i) {
            IPerplExchange.Order memory order = exchange.getOrder(perpId, _orderIds[i]);
            if (order.accountId == accountId && order.lotLNS != 0) {
                orders[count++] = order;
            }
        }
        assembly ("memory-safe") { mstore(orders, count) }
    }

    function cancelOrder(uint256 orderId) external onlyOwner nonReentrant {
        _requireInitialized();
        IPerplExchange.Order memory existing = exchange.getOrder(perpId, orderId);
        if (existing.accountId != accountId || existing.lotLNS == 0) {
            revert UnsupportedOrder();
        }
        _revoke();
        ++positionNonce;
        IPerplExchange.OrderDesc memory order;
        order.perpId = perpId;
        order.orderType = 4; // Perpl's onchain Cancel enum (distinct from the REST enum).
        order.orderId = orderId;
        uint256 beforeTokens = collateral.balanceOf(address(this));
        exchange.execOrder(order);
        existing = exchange.getOrder(perpId, orderId);
        if (existing.accountId == accountId && existing.lotLNS != 0) {
            revert UnsupportedOrder();
        }
        if (collateral.balanceOf(address(this)) != beforeTokens) {
            revert UnexpectedDelta();
        }
        _compactOrders();
        _assertSolvent();
        emit LimitOrderCancelled(orderId);
    }

    function _compactOrders() private {
        uint256 i;
        while (i < _orderIds.length) {
            IPerplExchange.Order memory order = exchange.getOrder(perpId, _orderIds[i]);
            if (order.accountId != accountId || order.lotLNS == 0) {
                _orderIds[i] = _orderIds[_orderIds.length - 1];
                _orderIds.pop();
            } else {
                ++i;
            }
        }
    }

    function armPolicy(PolicyConfig calldata config) external onlyOwner nonReentrant returns (uint256 id) {
        _requireInitialized();
        if (_policies[currentPolicyId].active) {
            revert PolicyAlreadyActive();
        }
        if (
            config.capCNS == 0 || config.minTopUpCNS == 0 || config.minTopUpCNS > config.capCNS
                || config.targetBufferBps <= config.triggerBufferBps || config.triggerBufferBps == 0
                || config.feeBps > 1_000 || config.maxMarkAgeSec == 0 || config.maxMarkAgeSec > 300
                || (config.feeBps != 0 && config.feeMaxCNS == 0)
        ) {
            revert InvalidConfiguration();
        }
        (IPerplExchange.PositionInfoV2 memory p,, bool markValid) = exchange.getPositionV2(perpId, accountId);
        if (p.accountId != accountId || p.lotLNS == 0) {
            revert CannotArm(Status.NoPosition);
        }
        if (exchange.getOrderLocks(accountId).length != 0) {
            revert CannotArm(Status.OutstandingOrders);
        }
        if (exchange.getAccountById(accountId).frozen != 0) {
            revert CannotArm(Status.VenueUnavailable);
        }
        IPerplExchange.PerpetualInfo memory market = exchange.getPerpetualInfo(perpId);
        if (!markValid) {
            revert CannotArm(Status.InvalidMark);
        }
        if (!_fresh(market.markTimestamp, config.maxMarkAgeSec)) {
            revert CannotArm(Status.StaleMark);
        }
        _assertSolvent();
        id = ++currentPolicyId;
        _policies[id] = Policy(config, 0, _binding(p), true);
        emit PolicyArmed(id, _policies[id].binding, config);
    }

    function revokePolicy() external onlyOwner nonReentrant {
        _revoke();
    }

    function setCap(uint256 capCNS) external onlyOwner nonReentrant {
        Policy storage p = _policies[currentPolicyId];
        if (!p.active || capCNS < p.usedCNS) {
            revert InvalidConfiguration();
        }
        p.config.capCNS = capCNS;
        emit CapChanged(currentPolicyId, capCNS, p.usedCNS);
    }

    function getPolicy(uint256 id) external view returns (Policy memory) {
        return _policies[id];
    }

    function previewTopUp() public view returns (Quote memory q) {
        q.policyId = currentPolicyId;
        Policy storage policy = _policies[currentPolicyId];
        if (!policy.active) {
            q.status = Status.Inactive;
            return q;
        }
        q.spendableCNS = Math.min(reserveCNS, policy.config.capCNS - policy.usedCNS);
        if (collateral.balanceOf(address(this)) < reserveCNS) {
            q.status = Status.InsolventReserve;
            return q;
        }
        (IPerplExchange.PositionInfoV2 memory p,, bool markValid) = exchange.getPositionV2(perpId, accountId);
        if (p.accountId != accountId || p.lotLNS == 0) {
            q.status = Status.NoPosition;
            return q;
        }
        if (_binding(p) != policy.binding) {
            q.status = Status.BindingChanged;
            return q;
        }
        if (exchange.getOrderLocks(accountId).length != 0) {
            q.status = Status.OutstandingOrders;
            return q;
        }
        if (exchange.getAccountById(accountId).frozen != 0) {
            q.status = Status.VenueUnavailable;
            return q;
        }
        if (!markValid) {
            q.status = Status.InvalidMark;
            return q;
        }
        IPerplExchange.PerpetualInfo memory market = exchange.getPerpetualInfo(perpId);
        q.markTimestamp = market.markTimestamp;
        if (!_fresh(market.markTimestamp, policy.config.maxMarkAgeSec)) {
            q.status = Status.StaleMark;
            return q;
        }
        (, uint256 factorHdths,,,,) = exchange.getMarginFractions(perpId, p.lotLNS);
        q.maintenanceCNS = PerplRisk.maintenance(p, market.priceDecimals, market.lotDecimals, factorHdths);
        q.equityCNS = PerplRisk.equity(p);
        q.triggerEquityCNS = PerplRisk.threshold(q.maintenanceCNS, policy.config.triggerBufferBps);
        q.targetEquityCNS = PerplRisk.threshold(q.maintenanceCNS, policy.config.targetBufferBps);
        if (q.equityCNS >= SafeCast.toInt256(q.triggerEquityCNS)) {
            q.status = Status.NotTriggered;
            return q;
        }
        q.amountCNS = SafeCast.toUint256(SafeCast.toInt256(q.targetEquityCNS) - q.equityCNS);
        if (q.amountCNS < policy.config.minTopUpCNS) {
            q.status = Status.BelowMinimum;
            return q;
        }
        q.feeCNS = Math.min(Math.mulDiv(q.amountCNS, policy.config.feeBps, 10_000), policy.config.feeMaxCNS);
        q.protocolFeeCNS = Math.mulDiv(q.amountCNS, protocolFeeBps, 10_000);
        // Both fees come out of the same capped budget as the margin itself.
        if (q.amountCNS + q.feeCNS + q.protocolFeeCNS > q.spendableCNS) {
            q.status = Status.InsufficientBudget;
            return q;
        }
        q.status = Status.Ready;
    }

    /// @notice Anyone may execute; all eligibility and amount calculations are enforced here.
    function topUp() external nonReentrant returns (Status) {
        Quote memory q = previewTopUp();
        if (q.status != Status.Ready) {
            emit Refused(q.policyId, q.status);
            return q.status;
        }
        (IPerplExchange.PositionInfoV2 memory before,,) = exchange.getPositionV2(perpId, accountId);
        uint256 freeBefore = exchange.getAccountById(accountId).balanceCNS;
        uint256 tokensBefore = collateral.balanceOf(address(this));
        _depositExact(q.amountCNS);
        exchange.increasePositionCollateral(perpId, q.amountCNS);
        (IPerplExchange.PositionInfoV2 memory after_,, bool markValid) =
            exchange.getPositionV2(perpId, accountId);
        if (
            after_.accountId != accountId || after_.depositCNS != before.depositCNS + q.amountCNS
                || _binding(after_) != _binding(before)
                || exchange.getAccountById(accountId).balanceCNS != freeBefore
                || collateral.balanceOf(address(this)) != tokensBefore - q.amountCNS || !markValid
                || PerplRisk.equity(after_) < SafeCast.toInt256(q.targetEquityCNS)
        ) {
            revert UnexpectedDelta();
        }
        Policy storage policy = _policies[q.policyId];
        uint256 spent = q.amountCNS + q.feeCNS + q.protocolFeeCNS;
        policy.usedCNS += spent;
        reserveCNS -= spent;
        // A blocked/reverting/incorrect fee transfer rolls back the entire rescue as well.
        if (q.feeCNS != 0) {
            _transferExact(msg.sender, q.feeCNS);
        }
        if (q.protocolFeeCNS != 0) {
            _transferExact(protocolFeeRecipient, q.protocolFeeCNS);
        }
        if (collateral.balanceOf(address(this)) != tokensBefore - spent) {
            revert UnexpectedDelta();
        }
        _assertSolvent();
        emit ToppedUp(q.policyId, msg.sender, q.amountCNS, q.feeCNS, policy.usedCNS, reserveCNS);
        if (q.protocolFeeCNS != 0) {
            emit ProtocolFeePaid(q.policyId, protocolFeeRecipient, q.protocolFeeCNS);
        }
        return Status.Ready;
    }

    function _pullExact(uint256 amount) private {
        if (amount == 0) {
            revert InvalidConfiguration();
        }
        uint256 before_ = collateral.balanceOf(address(this));
        collateral.safeTransferFrom(owner, address(this), amount);
        if (collateral.balanceOf(address(this)) != before_ + amount) {
            revert UnexpectedDelta();
        }
    }

    function _depositExact(uint256 amount) private {
        collateral.forceApprove(address(exchange), amount);
        exchange.depositCollateral(amount);
        collateral.forceApprove(address(exchange), 0);
    }

    function _transferExact(address recipient, uint256 amount) private {
        uint256 before_ = collateral.balanceOf(recipient);
        collateral.safeTransfer(recipient, amount);
        if (collateral.balanceOf(recipient) != before_ + amount) {
            revert UnexpectedDelta();
        }
    }

    function _binding(IPerplExchange.PositionInfoV2 memory p) private view returns (bytes32) {
        return keccak256(
            abi.encode(
                accountId,
                perpId,
                positionNonce,
                p.positionType,
                p.lotLNS,
                p.pricePNS,
                p.priceResiduePNSQ16,
                p.entryBlock
            )
        );
    }

    function _fresh(uint256 timestamp, uint256 maxAge) private view returns (bool) {
        return timestamp != 0 && timestamp <= block.timestamp && block.timestamp - timestamp <= maxAge;
    }

    function _revoke() private {
        Policy storage policy = _policies[currentPolicyId];
        if (policy.active) {
            policy.active = false;
            emit PolicyRevoked(currentPolicyId, policy.usedCNS);
        }
    }

    function _requireInitialized() private view {
        if (accountId == 0) {
            revert NotInitialized();
        }
    }

    function _assertSolvent() private view {
        if (collateral.balanceOf(address(this)) < reserveCNS) {
            revert ReserveInsolvent();
        }
    }
}
