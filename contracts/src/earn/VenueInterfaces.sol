// SPDX-License-Identifier: MIT
pragma solidity 0.8.30;

// Minimal ABIs, independently declared from the pinned official interfaces in EARN.md.
interface IAaveEarnPool {
    function supply(address asset, uint256 amount, address onBehalfOf, uint16 referralCode) external;
    function withdraw(address asset, uint256 amount, address to) external returns (uint256);
    function getConfiguration(address asset) external view returns (uint256);
    function getReserveNormalizedIncome(address asset) external view returns (uint256);
}

interface IAaveEarnData {
    struct Reserve {
        uint256 unbacked;
        uint256 accruedToTreasuryScaled;
        uint256 totalAToken;
        uint256 totalStableDebt;
        uint256 totalVariableDebt;
        uint256 liquidityRate;
        uint256 variableBorrowRate;
        uint256 stableBorrowRate;
        uint256 averageStableBorrowRate;
        uint256 liquidityIndex;
        uint256 variableBorrowIndex;
        uint40 lastUpdateTimestamp;
    }
    function getReserveData(address asset) external view returns (Reserve memory);
    function getInterestRateStrategyAddress(address asset) external view returns (address);
    function getVirtualUnderlyingBalance(address asset) external view returns (uint256);
}

interface IAaveEarnReceipt {
    function UNDERLYING_ASSET_ADDRESS() external view returns (address);
    function POOL() external view returns (address);
}

interface IAaveEarnRate {
    struct Params {
        uint256 unbacked;
        uint256 liquidityAdded;
        uint256 liquidityTaken;
        uint256 totalDebt;
        uint256 reserveFactor;
        address reserve;
        bool usingVirtualBalance;
        uint256 virtualUnderlyingBalance;
    }
    function calculateInterestRates(Params memory params) external view returns (uint256, uint256);
}

interface IMorphoEarn {
    struct Params {
        address loanToken;
        address collateralToken;
        address oracle;
        address irm;
        uint256 lltv;
    }

    struct Market {
        uint128 totalSupplyAssets;
        uint128 totalSupplyShares;
        uint128 totalBorrowAssets;
        uint128 totalBorrowShares;
        uint128 lastUpdate;
        uint128 fee;
    }
    function idToMarketParams(bytes32 id) external view returns (Params memory);
    function market(bytes32 id) external view returns (Market memory);
    function position(bytes32 id, address account) external view returns (uint256, uint128, uint128);
    function accrueInterest(Params memory params) external;
    function supply(Params memory params, uint256 assets, uint256 shares, address onBehalf, bytes memory data)
        external
        returns (uint256, uint256);
    function withdraw(
        Params memory params,
        uint256 assets,
        uint256 shares,
        address onBehalf,
        address receiver
    ) external returns (uint256, uint256);
}

interface IMorphoEarnRate {
    function borrowRateView(IMorphoEarn.Params memory params, IMorphoEarn.Market memory market)
        external
        view
        returns (uint256);
}
