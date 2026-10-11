// SPDX-License-Identifier: MIT
pragma solidity 0.8.30;
import {Test} from "forge-std/Test.sol";
import {SetsunaUSDCVault} from "../src/earn/SetsunaUSDCVault.sol";
import {SetsunaMultiEarnCore} from "../src/earn/SetsunaMultiEarnCore.sol";
import {SetsunaEarnCore} from "../src/earn/SetsunaEarnCore.sol";
import {SetsunaMONVault} from "../src/earn/SetsunaMONVault.sol";
import {ILendingAdapter} from "../src/earn/ILendingAdapter.sol";
import {ILendingAdapterV2} from "../src/earn/ILendingAdapterV2.sol";
import {EarnMockUSDC, EarnMockAdapter} from "./EarnMocks.sol";
import {MockWrappedMON} from "./SetsunaMON.t.sol";

/// Withdrawals drain the lowest-yielding destination first. Rates are reversed
/// against adapter order here, so the old fixed order would drain the best one.
contract SetsunaUSDCWithdrawOrderTest is Test {
    EarnMockUSDC token;
    SetsunaUSDCVault vault;
    EarnMockAdapter[4] venues;
    address alice = address(0xA11CE);

    function setUp() public {
        vm.warp(1_000_000);
        token = new EarnMockUSDC();
        vault = new SetsunaUSDCVault(token, address(this), 25_000e6, 250_000e6, address(0), 0);
        ILendingAdapterV2[] memory list = new ILendingAdapterV2[](4);
        for (uint256 i; i < 4; ++i) {
            // venue 0 pays 4%, venue 3 pays 1%.
            venues[i] = new EarnMockAdapter(token, address(vault), (4 - i) * 0.01e18);
            list[i] = ILendingAdapterV2(address(venues[i]));
        }
        vault.initialize(list);
        token.mint(alice, 30_000e6);
        vm.startPrank(alice);
        token.approve(address(vault), type(uint256).max);
        vault.deposit(1_000e6, alice);
        vm.stopPrank();
        vault.observeRates();
        vm.roll(vm.getBlockNumber() + 1);
        vm.warp(vm.getBlockTimestamp() + 301);
        for (uint256 i; i < 12; ++i) {
            vault.observeRates();
            vm.roll(vm.getBlockNumber() + 1);
            SetsunaMultiEarnCore.Plan memory p = vault.previewRebalance();
            if (p.grossMovement > 0) vault.rebalance();
            vm.warp(vm.getBlockTimestamp() + 601);
        }
        for (uint256 i; i < 4; ++i) {
            assertGt(venues[i].totalAssets(), 0, "every venue funded");
        }
    }

    function _withdrawPastCash(uint256 extra) internal returns (uint256 amount) {
        amount = token.balanceOf(address(vault)) + extra;
        vm.prank(alice);
        vault.withdraw(amount, alice, alice);
    }

    function testLowestRateIsDrainedFirst() public {
        uint256[4] memory before;
        for (uint256 i; i < 4; ++i) before[i] = venues[i].totalAssets();
        uint256 extra = before[3] / 2; // less than the lowest-rate position
        _withdrawPastCash(extra);
        assertEq(venues[3].totalAssets(), before[3] - extra, "1% venue pays the withdrawal");
        for (uint256 i; i < 3; ++i) {
            assertEq(venues[i].totalAssets(), before[i], "better-paying venues untouched");
        }
    }

    function testDrainsInAscendingRateOrder() public {
        uint256[4] memory before;
        for (uint256 i; i < 4; ++i) before[i] = venues[i].totalAssets();
        // Empty the two lowest-rate venues and take part of the third.
        uint256 extra = before[3] + before[2] + before[1] / 2;
        _withdrawPastCash(extra);
        assertEq(venues[3].totalAssets(), 0, "1% emptied first");
        assertEq(venues[2].totalAssets(), 0, "2% emptied second");
        assertEq(venues[1].totalAssets(), before[1] - before[1] / 2, "3% partly used");
        assertEq(venues[0].totalAssets(), before[0], "4% untouched");
    }

    function testDisabledDestinationIsDrainedBeforeAnyRate() public {
        vault.disableDestination(1); // a 3% venue is being wound down
        uint256[4] memory before;
        for (uint256 i; i < 4; ++i) before[i] = venues[i].totalAssets();
        uint256 extra = before[1] / 2;
        _withdrawPastCash(extra);
        assertEq(venues[1].totalAssets(), before[1] - extra, "disabled venue pays first");
        assertEq(venues[3].totalAssets(), before[3], "even the 1% venue waits");
        assertEq(venues[0].totalAssets(), before[0]);
        assertEq(venues[2].totalAssets(), before[2]);
    }

    function testFullRedemptionStillCompletes() public {
        uint256 shares = vault.balanceOf(alice);
        vm.prank(alice);
        assertApproxEqAbs(vault.redeem(shares, alice, alice), 1_000e6, 4);
        for (uint256 i; i < 4; ++i) {
            assertEq(venues[i].totalAssets(), 0);
        }
    }
}

contract SetsunaMONWithdrawOrderTest is Test {
    MockWrappedMON token;
    SetsunaMONVault vault;
    EarnMockAdapter a; // 6%
    EarnMockAdapter b; // 3%
    address alice = address(0xA11CE);

    function setUp() public {
        vm.warp(1_000_000);
        token = new MockWrappedMON();
        vault = new SetsunaMONVault(token, address(this), 25_000 ether, 250_000 ether, address(0), 0);
        a = new EarnMockAdapter(token, address(vault), 0.06e18);
        b = new EarnMockAdapter(token, address(vault), 0.03e18);
        a.setSize(1_000_000 ether);
        b.setSize(1_000_000 ether);
        vault.initialize([ILendingAdapter(address(a)), ILendingAdapter(address(b))]);
        token.mint(alice, 10_000 ether);
        vm.startPrank(alice);
        token.approve(address(vault), type(uint256).max);
        vault.deposit(1_000 ether, alice);
        vm.stopPrank();
        vault.observeRates();
        vm.roll(vm.getBlockNumber() + 1);
        vm.warp(vm.getBlockTimestamp() + 301);
        for (uint256 i; i < 12; ++i) {
            vault.observeRates();
            vm.roll(vm.getBlockNumber() + 1);
            SetsunaEarnCore.Plan memory p = vault.previewRebalance();
            if (p.grossMovement > 0) vault.rebalance();
            vm.warp(vm.getBlockTimestamp() + 601);
        }
        assertGt(a.totalAssets(), 0);
        assertGt(b.totalAssets(), 0);
    }

    function testLowerRateDestinationPaysFirst() public {
        uint256 beforeA = a.totalAssets();
        uint256 beforeB = b.totalAssets();
        uint256 extra = beforeB / 2;
        uint256 amount = token.balanceOf(address(vault)) + extra;
        vm.prank(alice);
        vault.withdraw(amount, alice, alice);
        assertEq(b.totalAssets(), beforeB - extra, "3% destination pays");
        assertEq(a.totalAssets(), beforeA, "6% destination untouched");
    }
}
