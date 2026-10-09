// SPDX-License-Identifier: MIT
pragma solidity 0.8.30;
import {ILendingAdapter} from "./ILendingAdapter.sol";

interface ILendingAdapterV2 is ILendingAdapter {
    /// @notice Unborrowed underlying cash in the destination, before a proposed deposit.
    function marketLiquidity() external view returns (uint256);
}
