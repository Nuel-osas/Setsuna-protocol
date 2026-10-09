// SPDX-License-Identifier: MIT
pragma solidity 0.8.30;

import {ERC20} from "@openzeppelin/contracts/token/ERC20/ERC20.sol";
import {Math} from "@openzeppelin/contracts/utils/math/Math.sol";
import {ILendingAdapter} from "../src/earn/ILendingAdapter.sol";

/// @dev Fault injection only. Real-protocol coverage is in SetsunaEarnFork.t.sol.
contract EarnMockUSDC is ERC20 {
    bool public chargeFee;
    constructor() ERC20("Mock USDC", "USDC") {}

    function decimals() public pure virtual override returns (uint8) {
        return 6;
    }

    function mint(address to, uint256 amount) external {
        _mint(to, amount);
    }

    function burn(address from, uint256 amount) external {
        _burn(from, amount);
    }

    function setFee(bool value) external {
        chargeFee = value;
    }

    function _update(address from, address to, uint256 value) internal override {
        if (chargeFee && from != address(0) && to != address(0) && value > 0) {
            super._update(from, address(0), 1);
            --value;
        }
        super._update(from, to, value);
    }
}

contract EarnMockAdapter is ILendingAdapter {
    EarnMockUSDC public immutable token;
    address public immutable vault;
    uint256 public apr;
    uint256 public size = 1_000_000e6;
    uint256 public marketCash = 1_000_000e6;
    uint256 public cashLimit = type(uint128).max;
    uint256 public capacity = type(uint128).max;
    bool public failValuation;
    bool public silentWithdrawal;
    bool public zeroProjectedRate;
    uint256 public depositLoss;
    bool public attackReentrancy;
    bool public reentrancySucceeded;
    error MockUnauthorized();
    error MockValuationFailure();
    modifier onlyVault() {
        if (msg.sender != vault) {
            revert MockUnauthorized();
        }
        _;
    }

    constructor(EarnMockUSDC token_, address vault_, uint256 apr_) {
        token = token_;
        vault = vault_;
        apr = apr_;
    }

    function asset() external view returns (address) {
        return address(token);
    }

    function totalAssets() public view returns (uint256) {
        if (failValuation) {
            revert MockValuationFailure();
        }
        return token.balanceOf(address(this));
    }

    function availableLiquidity() external view returns (uint256) {
        return Math.min(totalAssets(), cashLimit);
    }

    function depositCapacity() external view returns (uint256) {
        return capacity;
    }

    function marketLiquidity() external view returns (uint256) {
        return marketCash;
    }

    function setMarketCash(uint256 value) external {
        marketCash = value;
    }

    function marketSupply() external view returns (uint256) {
        return size;
    }

    function supplyApr(int256 delta) external view returns (uint256) {
        if (zeroProjectedRate && delta > 0) {
            return 0;
        }
        uint256 projected = delta >= 0 ? size + uint256(delta) : size - uint256(-delta);
        return Math.mulDiv(apr, size, projected);
    }

    function sync() external view onlyVault returns (uint256) {
        return totalAssets();
    }

    function deposit(uint256 assets) external onlyVault {
        token.transferFrom(vault, address(this), assets);
        if (depositLoss > 0) {
            token.burn(address(this), depositLoss);
        }
        if (attackReentrancy) {
            (reentrancySucceeded,) = vault.call(abi.encodeWithSignature("rebalance()"));
        }
    }

    function withdraw(uint256 assets) external onlyVault returns (uint256) {
        if (!silentWithdrawal) {
            token.transfer(vault, assets);
        }
        return assets;
    }

    function setApr(uint256 value) external {
        apr = value;
    }

    function setSize(uint256 value) external {
        size = value;
    }

    function setCashLimit(uint256 value) external {
        cashLimit = value;
    }

    function setCapacity(uint256 value) external {
        capacity = value;
    }

    function setFailValuation(bool value) external {
        failValuation = value;
    }

    function setSilentWithdrawal(bool value) external {
        silentWithdrawal = value;
    }

    function setZeroProjectedRate(bool value) external {
        zeroProjectedRate = value;
    }

    function setDepositLoss(uint256 value) external {
        depositLoss = value;
    }

    function setAttackReentrancy(bool value) external {
        attackReentrancy = value;
    }
}
