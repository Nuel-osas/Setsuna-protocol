// SPDX-License-Identifier: MIT
pragma solidity 0.8.30;

/// @notice All assets use underlying-token units; APR is annualized, 1e18-scaled, excluding rewards.
interface ILendingAdapter {
    function asset() external view returns (address);
    function vault() external view returns (address);
    function totalAssets() external view returns (uint256);
    function availableLiquidity() external view returns (uint256);
    function depositCapacity() external view returns (uint256);
    function marketSupply() external view returns (uint256);
    function supplyApr(int256 liquidityDelta) external view returns (uint256);
    function sync() external returns (uint256);
    function deposit(uint256 assets) external;
    function withdraw(uint256 assets) external returns (uint256);
}
