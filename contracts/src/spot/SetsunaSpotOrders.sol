// SPDX-License-Identifier: MIT
pragma solidity 0.8.30;

import {IERC20} from "@openzeppelin/contracts/token/ERC20/IERC20.sol";
import {SafeERC20} from "@openzeppelin/contracts/token/ERC20/utils/SafeERC20.sol";
import {ReentrancyGuard} from "@openzeppelin/contracts/utils/ReentrancyGuard.sol";
import {Math} from "@openzeppelin/contracts/utils/math/Math.sol";
import {IKuruSpotMarket} from "./SetsunaSpot.sol";

interface IKuruLimitMarket is IKuruSpotMarket {
    struct Order {
        address ownerAddress;
        uint96 size;
        uint40 prev;
        uint40 next;
        uint40 flippedId;
        uint32 price;
        uint32 flippedPrice;
        bool isBuy;
    }
    function addBuyOrder(uint32 price, uint96 size, bool postOnly) external;
    function addSellOrder(uint32 price, uint96 size, bool postOnly) external;
    function batchCancelOrders(uint40[] calldata ids) external;
    function s_orderIdCounter() external view returns (uint40);
    function s_orders(uint40 id) external view returns (Order memory);
}

interface IKuruMargin {
    function verifiedMarket(address market) external view returns (bool);
    function deposit(address user, address token, uint256 amount) external payable;
    function withdraw(uint256 amount, address token) external;
    function getBalance(address user, address token) external view returns (uint256);
}

/// @notice Each wallet owns its own Kuru balance and order account. No pooled user funds.
contract SetsunaSpotOrderAccount is ReentrancyGuard {
    using SafeERC20 for IERC20;
    address public immutable owner;
    IKuruLimitMarket public immutable market;
    IKuruMargin public immutable margin;
    IERC20 public immutable usdc;
    uint256 public immutable pricePrecision;
    uint256 public immutable sizePrecision;
    uint40[] private _ids;
    error Unauthorized();
    error InvalidOrder();
    error TransferFailed();
    event LimitPlaced(uint40 indexed orderId, bool isBuy, uint32 price, uint96 size);
    event LimitCancelled(uint40 indexed orderId);
    event Withdrawn(address indexed token, uint256 amount);
    modifier onlyOwner() {
        if (msg.sender != owner) {
            revert Unauthorized();
        }
        _;
    }

    constructor(address owner_, IKuruLimitMarket market_, IKuruMargin margin_, IERC20 usdc_) {
        owner = owner_;
        market = market_;
        margin = margin_;
        usdc = usdc_;
        (uint32 p, uint96 s, address base, uint256 bd, address quote, uint256 qd,,,,,) =
            market_.getMarketParams();
        if (
            owner_ == address(0) || base != address(0) || bd != 18 || quote != address(usdc_) || qd != 6
                || p == 0 || s == 0 || !margin_.verifiedMarket(address(market_))
        ) {
            revert InvalidOrder();
        }
        pricePrecision = p;
        sizePrecision = s;
    }

    receive() external payable {
        if (msg.sender != address(margin)) {
            revert Unauthorized();
        }
    }

    function placeLimit(
        bool isBuy,
        uint32 price,
        uint96 size,
        bool postOnly,
        uint256 maxWalletFunding,
        uint256 deadline
    ) external payable onlyOwner nonReentrant {
        (
            uint32 p,
            uint96 s,
            address base,
            uint256 bd,
            address quote,
            uint256 qd,
            uint32 tick,
            uint96 minSize,
            uint96 maxSize,,
        ) = market.getMarketParams();
        if (
            block.timestamp > deadline || price == 0 || size == 0 || tick == 0 || price % tick != 0
                || size < minSize || size > maxSize || p != pricePrecision || s != sizePrecision
                || base != address(0) || bd != 18 || quote != address(usdc) || qd != 6
        ) {
            revert InvalidOrder();
        }
        _compact();
        if (_ids.length >= 64) {
            revert InvalidOrder();
        }
        address token = isBuy ? address(usdc) : address(0);
        uint256 required = isBuy
            ? Math.mulDiv(uint256(price) * size, 1e6, pricePrecision * sizePrecision, Math.Rounding.Ceil)
            : Math.mulDiv(size, 1e18, sizePrecision, Math.Rounding.Ceil);
        uint256 available = margin.getBalance(address(this), token);
        uint256 funding = required > available ? required - available : 0;
        if (funding > maxWalletFunding || msg.value != (isBuy ? 0 : funding)) {
            revert InvalidOrder();
        }
        if (funding != 0) {
            if (isBuy) {
                usdc.safeTransferFrom(owner, address(this), funding);
                usdc.forceApprove(address(margin), funding);
            }
            margin.deposit{value: isBuy ? 0 : funding}(address(this), token, funding);
            if (isBuy) {
                usdc.forceApprove(address(margin), 0);
            }
        }
        uint40 beforeId = market.s_orderIdCounter();
        if (isBuy) {
            market.addBuyOrder(price, size, postOnly);
        } else {
            market.addSellOrder(price, size, postOnly);
        }
        // Matching flipped orders may allocate IDs for other owners. Inspect the
        // bounded allocation range, rather than assuming the last ID is ours.
        uint40 afterId = market.s_orderIdCounter();
        if (afterId < beforeId || afterId - beforeId > 256) {
            revert InvalidOrder();
        }
        uint40 placedId;
        for (uint256 i = uint256(beforeId) + 1; i <= afterId; ++i) {
            IKuruLimitMarket.Order memory order = market.s_orders(uint40(i));
            if (order.ownerAddress == address(this) && order.size != 0) {
                if (_ids.length >= 64) {
                    revert InvalidOrder();
                }
                _ids.push(uint40(i));
                placedId = uint40(i);
            }
        }
        emit LimitPlaced(placedId, isBuy, price, size);
    }

    function getOpenOrders()
        external
        view
        returns (uint40[] memory ids, IKuruLimitMarket.Order[] memory orders)
    {
        ids = new uint40[](_ids.length);
        orders = new IKuruLimitMarket.Order[](_ids.length);
        uint256 count;
        for (uint256 i; i < _ids.length; ++i) {
            IKuruLimitMarket.Order memory order = market.s_orders(_ids[i]);
            if (order.ownerAddress == address(this) && order.size != 0) {
                ids[count] = _ids[i];
                orders[count++] = order;
            }
        }
        assembly ("memory-safe") {
            mstore(ids, count)
            mstore(orders, count)
        }
    }

    function cancelOrder(uint40 id) external onlyOwner nonReentrant {
        IKuruLimitMarket.Order memory order = market.s_orders(id);
        if (order.ownerAddress != address(this) || order.size == 0) {
            revert InvalidOrder();
        }
        uint40[] memory ids = new uint40[](1);
        ids[0] = id;
        market.batchCancelOrders(ids);
        order = market.s_orders(id);
        if (order.ownerAddress == address(this) && order.size != 0) {
            revert InvalidOrder();
        }
        _compact();
        emit LimitCancelled(id);
    }

    function withdraw(address token, uint256 amount) external onlyOwner nonReentrant {
        if ((token != address(0) && token != address(usdc)) || amount == 0) {
            revert InvalidOrder();
        }
        margin.withdraw(amount, token);
        if (token == address(0)) {
            (bool ok,) = payable(owner).call{value: amount}("");
            if (!ok) {
                revert TransferFailed();
            }
        } else {
            usdc.safeTransfer(owner, amount);
        }
        emit Withdrawn(token, amount);
    }

    function _compact() private {
        uint256 i;
        while (i < _ids.length) {
            IKuruLimitMarket.Order memory order = market.s_orders(_ids[i]);
            if (order.ownerAddress != address(this) || order.size == 0) {
                _ids[i] = _ids[_ids.length - 1];
                _ids.pop();
            } else {
                ++i;
            }
        }
    }
}

contract SetsunaSpotOrders {
    IKuruLimitMarket public immutable market;
    IKuruMargin public immutable margin;
    IERC20 public immutable usdc;
    mapping(address => address) public accountOf;
    event AccountCreated(address indexed owner, address indexed account);

    constructor(IKuruLimitMarket market_, IKuruMargin margin_, IERC20 usdc_) {
        market = market_;
        margin = margin_;
        usdc = usdc_;
    }

    function createAccount() external returns (address account) {
        require(accountOf[msg.sender] == address(0), "ACCOUNT_EXISTS");
        account = address(new SetsunaSpotOrderAccount(msg.sender, market, margin, usdc));
        accountOf[msg.sender] = account;
        emit AccountCreated(msg.sender, account);
    }
}
