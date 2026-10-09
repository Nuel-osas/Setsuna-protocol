// SPDX-License-Identifier: MIT
pragma solidity 0.8.30;

import {Test} from "forge-std/Test.sol";
import {IERC20Errors} from "@openzeppelin/contracts/interfaces/draft-IERC6093.sol";
import {ERC4626} from "@openzeppelin/contracts/token/ERC20/extensions/ERC4626.sol";
import {SetsunaEarnCore} from "../src/earn/SetsunaEarnCore.sol";
import {SetsunaEarnVault} from "../src/earn/SetsunaEarnVault.sol";
import {ILendingAdapter} from "../src/earn/ILendingAdapter.sol";
import {EarnMockUSDC, EarnMockAdapter} from "./EarnMocks.sol";

contract SetsunaEarnTest is Test {
    EarnMockUSDC token;
    SetsunaEarnVault vault;
    EarnMockAdapter a;
    EarnMockAdapter b;
    address alice = address(0xA11CE);
    address bob = address(0xB0B);
    address executor = address(0xE0);
    address guardian = address(0x600D);

    function setUp() public {
        vm.warp(1_000_000);
        token = new EarnMockUSDC();
        vault = new SetsunaEarnVault(token, guardian, 25_000e6, 250_000e6);
        a = new EarnMockAdapter(token, address(vault), 0.04e18);
        b = new EarnMockAdapter(token, address(vault), 0.02e18);
        vault.initialize([ILendingAdapter(address(a)), ILendingAdapter(address(b))]);
        token.mint(alice, 30_000e6);
        token.mint(bob, 30_000e6);
        vm.prank(alice);
        token.approve(address(vault), type(uint256).max);
        vm.prank(bob);
        token.approve(address(vault), type(uint256).max);
    }

    function _deposit(uint256 amount) internal {
        vm.prank(alice);
        vault.deposit(amount, alice);
    }

    function _observe() internal {
        vm.prank(executor);
        vault.observeRates();
        vm.roll(vm.getBlockNumber() + 1);
    }

    function _warm() internal {
        _observe();
        vm.warp(vm.getBlockTimestamp() + vault.OBSERVATION_INTERVAL());
        _observe();
    }

    function _next() internal {
        vm.warp(vm.getBlockTimestamp() + vault.COOLDOWN());
        vm.roll(vm.getBlockNumber() + 1);
        _observe();
        vm.prank(executor);
        vault.rebalance();
    }

    function _fullyAllocate() internal {
        _deposit(1_000e6);
        _warm();
        for (uint256 i; i < 9; ++i) {
            _next();
        }
    }

    function testPublicCallerReachesPublishedTargetsWithoutPayment() public {
        _fullyAllocate();
        assertEq(a.totalAssets(), 600e6);
        assertEq(b.totalAssets(), 300e6);
        assertEq(token.balanceOf(address(vault)), 100e6);
        assertEq(token.balanceOf(executor), 0);
        assertEq(vault.totalAssets(), 1_000e6);
        assertEq(vault.balanceOf(alice), 1_000e12);
        assertEq(token.allowance(address(vault), address(a)), 0);
        assertEq(token.allowance(address(vault), address(b)), 0);
    }

    function testTwoSpacedObservationsAndLaterBlockRequired() public {
        _deposit(1_000e6);
        vm.expectRevert(SetsunaEarnCore.RatesNotReady.selector);
        vault.rebalance();
        vault.observeRates();
        vm.expectRevert(SetsunaEarnCore.ObservationTooSoon.selector);
        vault.observeRates();
        vm.warp(vm.getBlockTimestamp() + 5 minutes);
        vm.roll(vm.getBlockNumber() + 1);
        vault.observeRates();
        vm.expectRevert(SetsunaEarnCore.RatesNotReady.selector);
        vault.rebalance();
        vm.roll(vm.getBlockNumber() + 1);
        vault.rebalance();
        assertEq(a.totalAssets(), 100e6);
    }

    function testRateSpikeCannotRedirectCapital() public {
        _deposit(1_000e6);
        _warm();
        b.setApr(0.9e18);
        vm.expectRevert(abi.encodeWithSelector(SetsunaEarnCore.RateChanged.selector, 1));
        vault.rebalance();
        assertEq(token.balanceOf(address(vault)), 1_000e6);
        assertEq(b.totalAssets(), 0);
    }

    function testCooldownAndStaleObservationsRejectRebalance() public {
        _deposit(1_000e6);
        _warm();
        vault.rebalance();
        vm.expectRevert(SetsunaEarnCore.CooldownActive.selector);
        vault.rebalance();
        vm.warp(vm.getBlockTimestamp() + 31 minutes);
        vm.expectRevert(SetsunaEarnCore.RatesNotReady.selector);
        vault.rebalance();
        vm.prank(alice);
        vault.withdraw(100e6, alice, alice);
    }

    function testNoArbitraryAllocationRecipientOrAdapterCalls() public {
        _deposit(1_000e6);
        _warm();
        vm.prank(executor);
        (bool ok,) =
            address(vault).call(abi.encodeWithSignature("rebalance(address,uint256)", executor, 1_000e6));
        assertFalse(ok);
        vm.expectRevert(EarnMockAdapter.MockUnauthorized.selector);
        a.withdraw(1);
        vm.prank(executor);
        vm.expectRevert(
            abi.encodeWithSelector(IERC20Errors.ERC20InsufficientAllowance.selector, executor, 0, 100e12)
        );
        vault.withdraw(100e6, executor, alice);
        assertEq(token.balanceOf(executor), 0);
    }

    function testMarketSizeGateLeavesFortyPercentIdle() public {
        b.setSize(100_000e6);
        _deposit(1_000e6);
        _warm();
        for (uint256 i; i < 6; ++i) {
            _next();
        }
        assertEq(a.totalAssets(), 600e6);
        assertEq(b.totalAssets(), 0);
        assertEq(token.balanceOf(address(vault)), 400e6);
    }

    function testProjectedRatesMustImproveBeforeDeploying() public {
        _deposit(1_000e6);
        _warm();
        a.setZeroProjectedRate(true);
        vm.expectRevert(SetsunaEarnCore.NoImprovement.selector);
        vault.rebalance();
        assertEq(a.totalAssets(), 0);
        assertEq(vault.lastRebalanceAt(), 0);
    }

    function testRateChangeMovesBetweenProtocolsWithinGrossBudget() public {
        _fullyAllocate();
        a.setApr(0.02e18);
        b.setApr(0.04e18);
        vm.warp(vm.getBlockTimestamp() + 5 minutes);
        _warm();
        SetsunaEarnCore.Plan memory p = vault.previewRebalance();
        assertEq(p.withdrawals[0], 50e6);
        assertEq(p.deposits[1], 50e6);
        assertEq(p.grossMovement, 100e6);
        assertGt(p.annualIncomeAfter, p.annualIncomeBefore);
        vm.prank(executor);
        vault.rebalance();
        assertEq(a.totalAssets(), 550e6);
        assertEq(b.totalAssets(), 350e6);
        assertEq(token.balanceOf(address(vault)), 100e6);
    }

    function testIlliquidVenuesStillPermitAvailableBufferWithdrawal() public {
        _fullyAllocate();
        a.setCashLimit(0);
        b.setCashLimit(0);
        assertEq(vault.maxWithdraw(alice), 100e6);
        uint256 shares = vault.balanceOf(alice);
        vm.prank(alice);
        vm.expectRevert(
            abi.encodeWithSelector(ERC4626.ERC4626ExceededMaxWithdraw.selector, alice, 101e6, 100e6)
        );
        vault.withdraw(101e6, alice, alice);
        assertEq(vault.balanceOf(alice), shares);
        vm.prank(alice);
        vault.withdraw(100e6, alice, alice);
        assertEq(vault.totalAssets(), 900e6);
        assertEq(vault.maxWithdraw(alice), 0);
    }

    function testValuationFailureUsesDisplayCacheButBlocksSharePricing() public {
        _fullyAllocate();
        a.setFailValuation(true);
        (uint256 nav, bool healthy) = vault.accounting();
        assertEq(nav, 1_000e6);
        assertFalse(healthy);
        assertEq(vault.maxDeposit(alice), 0);
        assertEq(vault.maxMint(alice), 0);
        assertEq(vault.maxWithdraw(alice), 0);
        assertEq(vault.maxRedeem(alice), 0);
        vm.prank(alice);
        vm.expectRevert(EarnMockAdapter.MockValuationFailure.selector);
        vault.withdraw(1e6, alice, alice);
        assertEq(vault.balanceOf(alice), 1_000e12);
    }

    function testGuardianCannotWithdrawAndCanOnlyStopNewExposure() public {
        _fullyAllocate();
        vm.expectRevert(SetsunaEarnCore.Unauthorized.selector);
        vault.pauseDeposits();
        vm.prank(guardian);
        vault.pauseDeposits();
        vm.prank(guardian);
        vault.disableDestination(0);
        assertEq(vault.maxDeposit(alice), 0);
        assertEq(vault.totalAssets(), 1_000e6);
        assertEq(vault.maxWithdraw(alice), 1_000e6);
        vm.prank(guardian);
        vm.expectRevert();
        vault.withdraw(1e6, guardian, alice);
        uint256 shares = vault.balanceOf(alice);
        vm.prank(alice);
        vault.redeem(shares, alice, alice);
        assertEq(vault.balanceOf(alice), 0);
        assertEq(token.balanceOf(alice), 30_000e6);
    }

    function testRecognizedLossReducesBothDepositorsClaims() public {
        _fullyAllocate();
        vm.prank(bob);
        vault.deposit(1_000e6, bob);
        token.burn(address(a), 200e6);
        assertApproxEqAbs(vault.convertToAssets(vault.balanceOf(alice)), 900e6, 1);
        assertApproxEqAbs(vault.convertToAssets(vault.balanceOf(bob)), 900e6, 1);
        uint256 shares = vault.balanceOf(alice);
        vm.prank(alice);
        uint256 paid = vault.redeem(shares, alice, alice);
        assertApproxEqAbs(paid, 900e6, 1);
        shares = vault.balanceOf(bob);
        vm.prank(bob);
        paid = vault.redeem(shares, bob, bob);
        assertApproxEqAbs(paid, 900e6, 2);
    }

    function testSilentWithdrawalRollsBackBurnAndVenueState() public {
        _fullyAllocate();
        a.setSilentWithdrawal(true);
        uint256 shares = vault.balanceOf(alice);
        vm.prank(alice);
        vm.expectRevert(SetsunaEarnCore.BalanceMismatch.selector);
        vault.withdraw(500e6, alice, alice);
        assertEq(vault.balanceOf(alice), shares);
        assertEq(token.balanceOf(address(vault)), 100e6);
        assertEq(a.totalAssets(), 600e6);
    }

    function testUnexpectedAdapterLossRollsBackWholeRebalance() public {
        _deposit(1_000e6);
        _warm();
        a.setDepositLoss(1e6);
        vm.expectRevert(SetsunaEarnCore.AccountingLoss.selector);
        vault.rebalance();
        assertEq(vault.totalAssets(), 1_000e6);
        assertEq(a.totalAssets(), 0);
        assertEq(token.allowance(address(vault), address(a)), 0);
        assertEq(vault.lastRebalanceAt(), 0);
    }

    function testReentrantAdapterCannotStartAnotherRebalance() public {
        _deposit(1_000e6);
        _warm();
        a.setAttackReentrancy(true);
        vault.rebalance();
        assertFalse(a.reentrancySucceeded());
        assertEq(a.totalAssets(), 100e6);
    }

    function testDepositAndRedemptionBoundsRevertAtomically() public {
        vm.prank(alice);
        vm.expectRevert(SetsunaEarnCore.DeadlineExpired.selector);
        vault.depositWithMinShares(1_000e6, alice, 0, block.timestamp - 1);
        vm.prank(alice);
        vm.expectRevert(SetsunaEarnCore.SlippageExceeded.selector);
        vault.depositWithMinShares(1_000e6, alice, 1_001e12, block.timestamp);
        assertEq(vault.totalSupply(), 0);
        _deposit(1_000e6);
        vm.prank(alice);
        vm.expectRevert(SetsunaEarnCore.SlippageExceeded.selector);
        vault.redeemWithMinAssets(1_000e12, alice, alice, 1_001e6, block.timestamp);
        assertEq(vault.balanceOf(alice), 1_000e12);
    }

    function testFeeOnTransferDepositRejected() public {
        token.setFee(true);
        vm.prank(alice);
        vm.expectRevert(SetsunaEarnCore.BalanceMismatch.selector);
        vault.deposit(1_000e6, alice);
        assertEq(vault.totalSupply(), 0);
        assertEq(token.balanceOf(alice), 30_000e6);
    }

    function testInitializationCannotBeRepeatedOrAdaptersReplaced() public {
        ILendingAdapter[2] memory venues = [ILendingAdapter(address(a)), ILendingAdapter(address(b))];
        vm.expectRevert(SetsunaEarnCore.InvalidConfiguration.selector);
        vault.initialize(venues);
        vm.prank(guardian);
        vm.expectRevert(SetsunaEarnCore.Unauthorized.selector);
        vault.initialize(venues);
    }

    function testDepositCapAndZeroShareEntryProtection() public {
        _deposit(25_000e6);
        assertEq(vault.maxDeposit(alice), 0);
        vm.prank(bob);
        vm.expectRevert();
        vault.deposit(1, bob);
        vm.prank(bob);
        vm.expectRevert(SetsunaEarnCore.InvalidAmount.selector);
        vault.deposit(0, bob);
    }

    function testDonationCannotInflateAllocationRate() public {
        _deposit(1_000e6);
        _warm();
        token.mint(address(vault), 1_000e6);
        SetsunaEarnCore.Plan memory p = vault.previewRebalance();
        assertEq(p.rates[0], 0.04e18);
        assertEq(p.rates[1], 0.02e18);
        assertEq(p.target[0], 1_200e6);
        assertEq(p.target[1], 600e6);
    }

    function testVirtualSharesMakeSeedDonationAttackUnprofitable() public {
        _deposit(1);
        vm.prank(alice);
        token.transfer(address(vault), 1_000e6);
        vm.prank(bob);
        uint256 bobShares = vault.deposit(1_000e6, bob);
        assertGt(bobShares, 0);
        uint256 shares = vault.balanceOf(alice);
        vm.prank(alice);
        uint256 exit = vault.redeem(shares, alice, alice);
        assertLt(exit, 1_000e6 + 1);
        vm.prank(bob);
        uint256 bobExit = vault.redeem(bobShares, bob, bob);
        assertApproxEqAbs(bobExit, 1_000e6, 1_000);
    }

    function testFuzzMovementBufferAndExposureLimits(uint256 amount) public {
        amount = bound(amount, 100e6, 24_000e6);
        _deposit(amount);
        _warm();
        SetsunaEarnCore.Plan memory p = vault.rebalance();
        assertLe(p.grossMovement, amount / 10);
        assertGe(token.balanceOf(address(vault)), amount / 10);
        assertLe(a.totalAssets(), amount * 6 / 10 + 1);
        assertLe(b.totalAssets(), amount * 6 / 10 + 1);
        assertEq(vault.totalAssets(), amount);
        uint256 shares = vault.balanceOf(alice);
        vm.prank(alice);
        uint256 exit = vault.redeem(shares, alice, alice);
        assertEq(exit, amount);
        assertEq(vault.totalSupply(), 0);
    }
}
