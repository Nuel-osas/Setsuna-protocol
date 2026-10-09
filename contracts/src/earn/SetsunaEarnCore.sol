// SPDX-License-Identifier: MIT
pragma solidity 0.8.30;

import {IERC20, ERC20} from "@openzeppelin/contracts/token/ERC20/ERC20.sol";
import {ERC4626} from "@openzeppelin/contracts/token/ERC20/extensions/ERC4626.sol";
import {SafeERC20} from "@openzeppelin/contracts/token/ERC20/utils/SafeERC20.sol";
import {ReentrancyGuard} from "@openzeppelin/contracts/utils/ReentrancyGuard.sol";
import {Math} from "@openzeppelin/contracts/utils/math/Math.sol";
import {ILendingAdapter} from "./ILendingAdapter.sol";

/// @notice Fixed two-destination lending vault. Public executors cannot choose weights, calls or recipients.
/// @dev Prototype: immutable policy; no fees, swaps, leverage, upgrades, or adapter replacement.
abstract contract SetsunaEarnCore is ERC4626, ReentrancyGuard {
    using SafeERC20 for IERC20;

    uint256 public constant BPS = 10_000;
    uint256 public constant BUFFER_BPS = 1_000;
    uint256 public constant DESTINATION_CAP_BPS = 6_000;
    uint256 public constant MOVE_BPS = 1_000; // Sum of deposits AND withdrawals per rebalance.
    uint256 public constant COOLDOWN = 10 minutes;
    uint256 public constant OBSERVATION_INTERVAL = 5 minutes;
    uint256 public constant MAX_OBSERVATION_AGE = 30 minutes;
    uint256 public constant MAX_RATE_CHANGE_BPS = 1_000;
    uint256 public constant MAX_APR = 1e18;
    uint256 public immutable MIN_ANNUAL_GAIN; // 0.001 underlying tokens/year; not a gas estimate.
    uint256 public constant ROUNDING_BUDGET = 4; // Underlying base units, never a percent of NAV.

    address public immutable initializer;
    address public immutable guardian;
    uint256 public immutable depositCap;
    uint256 public immutable minimumMarketSupply;
    ILendingAdapter[2] public adapters;
    bool[2] public disabled;
    bool public initialized;
    bool public depositsPaused;
    uint256[2] public cachedPosition;
    uint256 public cachedIdle;
    uint256 public lastAccountingAt;
    uint256 public lastRebalanceAt;

    struct Observation {
        uint256 timestamp;
        uint256 blockNumber;
        uint256[2] rates;
    }
    Observation private _previous;
    Observation private _latest;

    struct Plan {
        uint256 nav;
        uint256[2] positions;
        uint256[2] target;
        uint256[2] withdrawals;
        uint256[2] deposits;
        uint256[2] rates;
        uint256 annualIncomeBefore;
        uint256 annualIncomeAfter;
        uint256 grossMovement;
        bool repairsLimits;
    }

    error Unauthorized();
    error InvalidConfiguration();
    error NotInitialized();
    error UnhealthyAccounting();
    error InvalidAmount();
    error BalanceMismatch();
    error InsufficientLiquidity();
    error DeadlineExpired();
    error SlippageExceeded();
    error ObservationTooSoon();
    error RatesNotReady();
    error RateChanged(uint256 destination);
    error CooldownActive();
    error NoMovement();
    error NoImprovement();
    error AccountingLoss();
    error LimitViolation();

    event Initialized(address indexed destination0, address indexed destination1);
    event AccountingUpdated(uint256 assets, uint256 idle);
    event RatesObserved(uint256 timestamp, uint256 destination0Apr, uint256 destination1Apr);
    event Rebalanced(
        address indexed caller,
        uint256[2] withdrawals,
        uint256[2] deposits,
        uint256 annualIncomeBefore,
        uint256 annualIncomeAfter,
        bool repairsLimits
    );
    event DepositsPaused();
    event DestinationDisabled(uint256 indexed destination);

    constructor(
        IERC20 asset_,
        address guardian_,
        uint256 depositCap_,
        uint256 minimumMarketSupply_,
        uint8 assetDecimals_,
        string memory name_,
        string memory symbol_
    ) ERC20(name_, symbol_) ERC4626(asset_) {
        if (
            guardian_ == address(0) || depositCap_ == 0
                || depositCap_ > 1_000_000 * 10 ** uint256(assetDecimals_) || minimumMarketSupply_ == 0
                || (assetDecimals_ != 6 && assetDecimals_ != 18) || decimals() != assetDecimals_ + 6
        ) {
            revert InvalidConfiguration();
        }
        MIN_ANNUAL_GAIN = 10 ** uint256(assetDecimals_) / 1_000;
        initializer = msg.sender;
        guardian = guardian_;
        depositCap = depositCap_;
        minimumMarketSupply = minimumMarketSupply_;
    }

    /// @dev One-time setup, atomically completed by the asset-specific factory before publishing the vault.
    function initialize(ILendingAdapter[2] calldata adapters_) external {
        if (msg.sender != initializer) {
            revert Unauthorized();
        }
        if (initialized || address(adapters_[0]) == address(adapters_[1])) {
            revert InvalidConfiguration();
        }
        for (uint256 i; i < 2; ++i) {
            if (
                address(adapters_[i]).code.length == 0 || adapters_[i].vault() != address(this)
                    || adapters_[i].asset() != asset()
            ) {
                revert InvalidConfiguration();
            }
            adapters[i] = adapters_[i];
        }
        initialized = true;
        emit Initialized(address(adapters_[0]), address(adapters_[1]));
    }

    function _decimalsOffset() internal pure override returns (uint8) {
        return 6;
    }

    /// @notice Live valuation when readable; cached values are display-only if healthy is false.
    function accounting() public view returns (uint256 nav, bool healthy) {
        healthy = initialized;
        try IERC20(asset()).balanceOf(address(this)) returns (uint256 idle) {
            nav = idle;
        } catch {
            nav = cachedIdle;
            healthy = false;
        }
        if (!initialized) {
            return (nav, false);
        }
        for (uint256 i; i < 2; ++i) {
            try adapters[i].totalAssets() returns (uint256 value) {
                if (value > type(uint128).max) {
                    nav += cachedPosition[i];
                    healthy = false;
                } else {
                    nav += value;
                }
            } catch {
                nav += cachedPosition[i];
                healthy = false;
            }
        }
    }

    function totalAssets() public view override returns (uint256 nav) {
        (nav,) = accounting();
    }

    function _cashAvailable() internal view returns (uint256 cash) {
        cash = IERC20(asset()).balanceOf(address(this));
        for (uint256 i; i < 2; ++i) {
            try adapters[i].availableLiquidity() returns (uint256 available) {
                if (available <= type(uint128).max) {
                    cash += available;
                }
            } catch { /* A failed liquidity read does not invent cash. */ }
        }
    }

    function maxDeposit(address) public view override returns (uint256) {
        (uint256 nav, bool healthy) = accounting();
        return healthy && !depositsPaused && nav < depositCap ? depositCap - nav : 0;
    }

    function maxMint(address receiver) public view override returns (uint256) {
        return _convertToShares(maxDeposit(receiver), Math.Rounding.Floor);
    }

    function maxWithdraw(address owner) public view override returns (uint256) {
        (, bool healthy) = accounting();
        if (!healthy) {
            return 0;
        }
        return Math.min(_convertToAssets(balanceOf(owner), Math.Rounding.Floor), _cashAvailable());
    }

    function maxRedeem(address owner) public view override returns (uint256) {
        (, bool healthy) = accounting();
        if (!healthy) {
            return 0;
        }
        uint256 shares = balanceOf(owner);
        uint256 cash = _cashAvailable();
        // After a loss, virtual assets can make convertToShares(cash) slightly
        // smaller than the full balance even though its rounded redemption fits.
        if (_convertToAssets(shares, Math.Rounding.Floor) <= cash) {
            return shares;
        }
        return Math.min(shares, _convertToShares(cash, Math.Rounding.Floor));
    }

    function _refresh() internal returns (uint256 nav) {
        if (!initialized) {
            revert NotInitialized();
        }
        for (uint256 i; i < 2; ++i) {
            cachedPosition[i] = adapters[i].sync();
            if (cachedPosition[i] > type(uint128).max) {
                revert UnhealthyAccounting();
            }
            nav += cachedPosition[i];
        }
        cachedIdle = IERC20(asset()).balanceOf(address(this));
        nav += cachedIdle;
        lastAccountingAt = block.timestamp;
        emit AccountingUpdated(nav, cachedIdle);
    }

    function sync() external nonReentrant returns (uint256) {
        return _refresh();
    }

    function deposit(uint256 assets, address receiver) public override nonReentrant returns (uint256) {
        _refresh();
        return super.deposit(assets, receiver);
    }

    function mint(uint256 shares, address receiver) public override nonReentrant returns (uint256) {
        _refresh();
        return super.mint(shares, receiver);
    }

    function withdraw(uint256 assets, address receiver, address owner)
        public
        override
        nonReentrant
        returns (uint256)
    {
        _refresh();
        return super.withdraw(assets, receiver, owner);
    }

    function redeem(uint256 shares, address receiver, address owner)
        public
        override
        nonReentrant
        returns (uint256)
    {
        _refresh();
        return super.redeem(shares, receiver, owner);
    }

    function depositWithMinShares(uint256 assets, address receiver, uint256 minShares, uint256 deadline)
        external
        returns (uint256 shares)
    {
        if (block.timestamp > deadline) {
            revert DeadlineExpired();
        }
        shares = deposit(assets, receiver);
        if (shares < minShares) {
            revert SlippageExceeded();
        }
    }

    function redeemWithMinAssets(
        uint256 shares,
        address receiver,
        address owner,
        uint256 minAssets,
        uint256 deadline
    ) external returns (uint256 assets) {
        if (block.timestamp > deadline) {
            revert DeadlineExpired();
        }
        assets = redeem(shares, receiver, owner);
        if (assets < minAssets) {
            revert SlippageExceeded();
        }
    }

    function _deposit(address caller, address receiver, uint256 assets, uint256 shares) internal override {
        if (assets == 0 || shares == 0) {
            revert InvalidAmount();
        }
        uint256 beforeCash = IERC20(asset()).balanceOf(address(this));
        super._deposit(caller, receiver, assets, shares);
        cachedIdle = IERC20(asset()).balanceOf(address(this));
        if (cachedIdle != beforeCash + assets) {
            revert BalanceMismatch();
        }
    }

    function _withdraw(address caller, address receiver, address owner, uint256 assets, uint256 shares)
        internal
        override
    {
        IERC20 token = IERC20(asset());
        uint256 beforeNav = totalAssets();
        for (uint256 i; i < 2 && token.balanceOf(address(this)) < assets; ++i) {
            uint256 available;
            try adapters[i].availableLiquidity() returns (uint256 value) {
                available = value;
            } catch {
                continue;
            }
            uint256 needed = Math.min(assets - token.balanceOf(address(this)), available);
            if (needed != 0) {
                _take(i, needed);
            }
        }
        if (token.balanceOf(address(this)) < assets) {
            revert InsufficientLiquidity();
        }
        uint256 receiverBefore = token.balanceOf(receiver);
        uint256 cashBefore = token.balanceOf(address(this));
        super._withdraw(caller, receiver, owner, assets, shares);
        if (
            receiver == address(this) || token.balanceOf(receiver) != receiverBefore + assets
                || token.balanceOf(address(this)) + assets != cashBefore
        ) {
            revert BalanceMismatch();
        }
        uint256 afterNav = _refresh();
        if (afterNav + assets + ROUNDING_BUDGET < beforeNav) {
            revert AccountingLoss();
        }
    }

    function pauseDeposits() external {
        if (msg.sender != guardian) {
            revert Unauthorized();
        }
        depositsPaused = true; // Sticky: no backdoor unpause or parameter changes.
        emit DepositsPaused();
    }

    function disableDestination(uint256 i) external {
        if (msg.sender != guardian) {
            revert Unauthorized();
        }
        if (i >= 2) {
            revert InvalidConfiguration();
        }
        disabled[i] = true; // Existing claims stay in NAV and remain redeemable.
        emit DestinationDisabled(i);
    }

    function observations() external view returns (Observation memory previous, Observation memory latest) {
        return (_previous, _latest);
    }

    /// @notice Anyone can record protocol rates; nobody can submit an APR value.
    function observeRates() external nonReentrant {
        if (_latest.timestamp != 0 && block.timestamp < _latest.timestamp + OBSERVATION_INTERVAL) {
            revert ObservationTooSoon();
        }
        _refresh();
        uint256[2] memory rates;
        for (uint256 i; i < 2; ++i) {
            if (!disabled[i]) {
                rates[i] = adapters[i].supplyApr(0);
            }
            if (rates[i] > MAX_APR) {
                revert RateChanged(i);
            }
        }
        _previous = _latest;
        _latest = Observation(block.timestamp, block.number, rates);
        emit RatesObserved(block.timestamp, rates[0], rates[1]);
    }

    function _checkRates(uint256 i, uint256 current) internal view returns (uint256 score) {
        if (current > MAX_APR) {
            revert RateChanged(i);
        }
        uint256 low = Math.min(_previous.rates[i], _latest.rates[i]);
        uint256 high = Math.max(_previous.rates[i], _latest.rates[i]);
        low = Math.min(low, current);
        high = Math.max(high, current);
        if (high - low > Math.mulDiv(low, MAX_RATE_CHANGE_BPS, BPS)) {
            revert RateChanged(i);
        }
        return low;
    }

    /// @notice Deterministic plan, recomputed inside execution. No caller-supplied weights or calldata.
    function previewRebalance() public view returns (Plan memory p) {
        bool healthy;
        (p.nav, healthy) = accounting();
        if (!healthy) {
            revert UnhealthyAccounting();
        }
        if (
            _previous.timestamp == 0 || _latest.timestamp + MAX_OBSERVATION_AGE < block.timestamp
                || _previous.timestamp + 2 * MAX_OBSERVATION_AGE < block.timestamp
                || _latest.blockNumber >= block.number
        ) {
            revert RatesNotReady();
        }
        if (lastRebalanceAt != 0 && block.timestamp < lastRebalanceAt + COOLDOWN) {
            revert CooldownActive();
        }
        uint256 cap = Math.mulDiv(p.nav, DESTINATION_CAP_BPS, BPS);
        uint256 minIdle = Math.mulDiv(p.nav, BUFFER_BPS, BPS, Math.Rounding.Ceil);
        uint256[2] memory capacity;
        uint256[2] memory scores;
        bool[2] memory open;
        uint256 idle = IERC20(asset()).balanceOf(address(this));
        p.repairsLimits = idle < minIdle;
        for (uint256 i; i < 2; ++i) {
            p.positions[i] = adapters[i].totalAssets();
            if (!disabled[i]) {
                p.rates[i] = adapters[i].supplyApr(0);
                uint256 score = _checkRates(i, p.rates[i]);
                capacity[i] = adapters[i].depositCapacity();
                if (adapters[i].marketSupply() >= minimumMarketSupply && score > 0 && capacity[i] > 0) {
                    scores[i] = score;
                    open[i] = true;
                }
            }
            if (p.positions[i] > cap || (!open[i] && p.positions[i] > 0)) {
                p.repairsLimits = true;
            }
            p.annualIncomeBefore += Math.mulDiv(p.positions[i], p.rates[i], 1e18);
        }
        uint256 remaining = p.nav - minIdle;
        for (uint256 round; round < 2; ++round) {
            uint256 totalScore = (open[0] ? scores[0] : 0) + (open[1] ? scores[1] : 0);
            if (totalScore == 0) {
                break;
            }
            uint256 start = remaining;
            for (uint256 i; i < 2; ++i) {
                if (!open[i]) {
                    continue;
                }
                uint256 take = Math.min(Math.mulDiv(start, scores[i], totalScore), cap - p.target[i]);
                p.target[i] += take;
                remaining -= take;
                if (p.target[i] == cap) {
                    open[i] = false;
                }
            }
        }
        uint256 budget = Math.mulDiv(p.nav, MOVE_BPS, BPS);
        uint256 withdrawalBudget = p.repairsLimits ? budget : budget / 2;
        for (uint256 i; i < 2; ++i) {
            if (p.positions[i] <= p.target[i]) {
                continue;
            }
            uint256 take = Math.min(
                p.positions[i] - p.target[i], Math.min(adapters[i].availableLiquidity(), withdrawalBudget)
            );
            p.withdrawals[i] = take;
            idle += take;
            budget -= take;
            withdrawalBudget -= take;
            p.grossMovement += take;
        }
        for (uint256 i; i < 2; ++i) {
            uint256 position = p.positions[i] - p.withdrawals[i];
            if (p.target[i] > position && idle > minIdle) {
                uint256 give =
                    Math.min(p.target[i] - position, Math.min(capacity[i], Math.min(idle - minIdle, budget)));
                p.deposits[i] = give;
                idle -= give;
                budget -= give;
                p.grossMovement += give;
            }
            uint256 afterPosition = position + p.deposits[i];
            if (afterPosition > 0 && !disabled[i]) {
                uint256 projectedRate =
                    adapters[i].supplyApr(int256(p.deposits[i]) - int256(p.withdrawals[i]));
                if (projectedRate > MAX_APR) {
                    revert RateChanged(i);
                }
                p.annualIncomeAfter += Math.mulDiv(afterPosition, projectedRate, 1e18);
            }
        }
    }

    function _take(uint256 i, uint256 assets) internal {
        uint256 beforeCash = IERC20(asset()).balanceOf(address(this));
        if (
            adapters[i].withdraw(assets) != assets
                || IERC20(asset()).balanceOf(address(this)) != beforeCash + assets
        ) {
            revert BalanceMismatch();
        }
    }

    function rebalance() external nonReentrant returns (Plan memory p) {
        _refresh();
        p = previewRebalance();
        if (p.grossMovement == 0) {
            revert NoMovement();
        }
        if (!p.repairsLimits && p.annualIncomeAfter < p.annualIncomeBefore + MIN_ANNUAL_GAIN) {
            revert NoImprovement();
        }
        lastRebalanceAt = block.timestamp;
        IERC20 token = IERC20(asset());
        uint256 idleBefore = token.balanceOf(address(this));
        for (uint256 i; i < 2; ++i) {
            if (p.withdrawals[i] > 0) {
                _take(i, p.withdrawals[i]);
            }
        }
        for (uint256 i; i < 2; ++i) {
            if (p.deposits[i] == 0) {
                continue;
            }
            uint256 beforeCash = token.balanceOf(address(this));
            token.forceApprove(address(adapters[i]), p.deposits[i]);
            adapters[i].deposit(p.deposits[i]);
            token.forceApprove(address(adapters[i]), 0);
            if (token.balanceOf(address(this)) + p.deposits[i] != beforeCash) {
                revert BalanceMismatch();
            }
        }
        uint256 afterNav = _refresh();
        if (afterNav + ROUNDING_BUDGET < p.nav) {
            revert AccountingLoss();
        }
        uint256 capAfter = Math.mulDiv(afterNav, DESTINATION_CAP_BPS, BPS, Math.Rounding.Ceil);
        for (uint256 i; i < 2; ++i) {
            // Pre-existing drift is allowed only while reducing it; callers cannot enlarge a breach.
            if (cachedPosition[i] > Math.max(capAfter, p.positions[i]) + ROUNDING_BUDGET) {
                revert LimitViolation();
            }
        }
        uint256 requiredIdle = Math.mulDiv(afterNav, BUFFER_BPS, BPS);
        if (cachedIdle < Math.min(idleBefore, requiredIdle)) {
            revert LimitViolation();
        }
        emit Rebalanced(
            msg.sender, p.withdrawals, p.deposits, p.annualIncomeBefore, p.annualIncomeAfter, p.repairsLimits
        );
    }
}
