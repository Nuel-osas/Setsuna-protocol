// SPDX-License-Identifier: MIT
pragma solidity 0.8.30;
import {Test} from "forge-std/Test.sol";
import {SetsunaUSDCVault} from "../src/earn/SetsunaUSDCVault.sol";
import {SetsunaMultiEarnCore} from "../src/earn/SetsunaMultiEarnCore.sol";
import {ILendingAdapterV2} from "../src/earn/ILendingAdapterV2.sol";
import {EarnMockUSDC, EarnMockAdapter} from "./EarnMocks.sol";

contract SetsunaUSDCV2Test is Test {
    EarnMockUSDC token;
    SetsunaUSDCVault vault;
    EarnMockAdapter[4] venues;
    address alice = address(0xA11CE);

    function setUp() public {
        vm.warp(1_000_000);
        token = new EarnMockUSDC();
        vault = new SetsunaUSDCVault(token, address(this), 25_000e6, 250_000e6);
        ILendingAdapterV2[] memory list = new ILendingAdapterV2[](4);
        for (uint256 i; i < 4; ++i) {
            venues[i] = new EarnMockAdapter(token, address(vault), (i + 1) * 0.01e18);
            list[i] = ILendingAdapterV2(address(venues[i]));
        }
        vault.initialize(list);
        token.mint(alice, 30_000e6);
        vm.prank(alice);
        token.approve(address(vault), type(uint256).max);
    }

    function observe() internal {
        vault.observeRates();
        vm.roll(vm.getBlockNumber() + 1);
    }

    function warm() internal {
        observe();
        vm.warp(vm.getBlockTimestamp() + 301);
        observe();
    }

    function seed() internal {
        vm.prank(alice);
        vault.deposit(1_000e6, alice);
        warm();
    }

    function allocate() internal {
        seed();
        for (uint256 i; i < 12; ++i) {
            vm.warp(vm.getBlockTimestamp() + 601);
            observe();
            SetsunaMultiEarnCore.Plan memory p = vault.previewRebalance();
            if (
                p.grossMovement > 0
                    && (p.repairsLimits
                        || p.annualIncomeAfter >= p.annualIncomeBefore + vault.MIN_ANNUAL_GAIN())
            ) {
                vault.rebalance();
            }
        }
    }

    function testFourDestinationsHoldAssetsAndFullRedemption() public {
        allocate();
        assertEq(vault.destinationCount(), 4);
        for (uint256 i; i < 4; ++i) {
            assertGt(venues[i].totalAssets(), 0);
            assertLe(venues[i].totalAssets(), 600e6);
            assertEq(token.allowance(address(vault), address(venues[i])), 0);
        }
        assertGe(token.balanceOf(address(vault)), 100e6);
        uint256 shares = vault.balanceOf(alice);
        vm.prank(alice);
        assertEq(vault.redeem(shares, alice, alice), 1_000e6);
        assertEq(vault.totalAssets(), 0);
    }

    function testUnrelatedAccountCanObserveAndRebalanceWithoutReceivingFunds() public {
        vm.prank(alice);
        vault.deposit(1_000e6, alice);
        address executor = address(0xB0B);
        vm.prank(executor);
        vault.observeRates();
        vm.warp(vm.getBlockTimestamp() + 301);
        vm.prank(executor);
        vault.observeRates();
        vm.roll(vm.getBlockNumber() + 1);
        vm.prank(executor);
        vault.rebalance();
        assertGt(venues[0].totalAssets(), 0);
        assertEq(token.balanceOf(executor), 0);
        assertEq(vault.balanceOf(executor), 0);
    }

    function testMarketCashLimitRedistributesToOtherDestinations() public {
        venues[3].setMarketCash(500e6);
        seed();
        SetsunaMultiEarnCore.Plan memory p = vault.previewRebalance();
        assertEq(p.target[3], 50e6);
        assertGt(p.target[0] + p.target[1] + p.target[2], 849e6);
    }

    function testBelowSizeAndRateSpikeReceiveZeroWhileOthersContinue() public {
        seed();
        venues[1].setSize(100e6);
        venues[3].setApr(0.9e18);
        SetsunaMultiEarnCore.Plan memory p = vault.rebalance();
        assertEq(p.target[1], 0);
        assertEq(p.target[3], 0);
        assertGt(p.target[0], 0);
        assertGt(p.target[2], 0);
    }

    function testInsufficientLiquidityLimitsRedemptionThenRecovers() public {
        allocate();
        for (uint256 i; i < 4; ++i) {
            venues[i].setCashLimit(0);
        }
        assertEq(vault.maxWithdraw(alice), token.balanceOf(address(vault)));
        uint256 shares = vault.balanceOf(alice);
        vm.prank(alice);
        vm.expectRevert();
        vault.redeem(shares, alice, alice);
        vm.prank(alice);
        vault.withdraw(50e6, alice, alice);
        for (uint256 i; i < 4; ++i) {
            venues[i].setCashLimit(type(uint128).max);
        }
        shares = vault.balanceOf(alice);
        vm.prank(alice);
        assertEq(vault.redeem(shares, alice, alice), 950e6);
    }

    function testDisabledFourthMarketExitsWithoutLosingItsClaim() public {
        allocate();
        uint256 beforeNav = vault.totalAssets();
        vault.disableDestination(3);
        assertEq(vault.totalAssets(), beforeNav);
        vm.warp(vm.getBlockTimestamp() + 601);
        observe();
        SetsunaMultiEarnCore.Plan memory p = vault.rebalance();
        assertEq(p.target[3], 0);
        assertGt(p.withdrawals[3], 0);
        assertEq(p.deposits[3], 0);
    }

    function testValuationFailureDisablesMintAndRedemption() public {
        allocate();
        venues[3].setFailValuation(true);
        (, bool healthy) = vault.accounting();
        assertFalse(healthy);
        assertEq(vault.maxDeposit(alice), 0);
        assertEq(vault.maxRedeem(alice), 0);
    }

    function testExternalCallerCannotDisableOrMoveAdapterFunds() public {
        vm.prank(alice);
        vm.expectRevert(SetsunaMultiEarnCore.Unauthorized.selector);
        vault.disableDestination(3);
        vm.prank(alice);
        vm.expectRevert();
        venues[3].withdraw(1);
        vm.expectRevert(SetsunaMultiEarnCore.InvalidConfiguration.selector);
        vault.disableDestination(4);
    }

    function testDuplicateWrongAssetAndTooManyAdaptersRejected() public {
        SetsunaUSDCVault other = new SetsunaUSDCVault(token, address(this), 25_000e6, 250_000e6);
        ILendingAdapterV2[] memory list = new ILendingAdapterV2[](6);
        vm.expectRevert(SetsunaMultiEarnCore.InvalidConfiguration.selector);
        other.initialize(list);
        list = new ILendingAdapterV2[](2);
        list[0] = ILendingAdapterV2(address(new EarnMockAdapter(token, address(other), 0.01e18)));
        list[1] = list[0];
        vm.expectRevert(SetsunaMultiEarnCore.InvalidConfiguration.selector);
        other.initialize(list);
        list[1] = ILendingAdapterV2(address(new EarnMockAdapter(new EarnMockUSDC(), address(other), 0.01e18)));
        vm.expectRevert(SetsunaMultiEarnCore.InvalidConfiguration.selector);
        other.initialize(list);
    }

    function testTwoThroughFiveDestinationConfigurations() public {
        for (uint256 n = 2; n <= 5; ++n) {
            SetsunaUSDCVault other = new SetsunaUSDCVault(token, address(this), 25_000e6, 250_000e6);
            ILendingAdapterV2[] memory list = new ILendingAdapterV2[](n);
            for (uint256 i; i < n; ++i) {
                list[i] = ILendingAdapterV2(address(new EarnMockAdapter(token, address(other), 0.03e18)));
            }
            other.initialize(list);
            assertEq(other.destinationCount(), n);
            vm.startPrank(alice);
            token.approve(address(other), 1_000e6);
            other.deposit(1_000e6, alice);
            vm.stopPrank();
            other.observeRates();
            vm.warp(vm.getBlockTimestamp() + 301);
            other.observeRates();
            vm.roll(vm.getBlockNumber() + 1);
            other.rebalance();
            uint256 shares = other.balanceOf(alice);
            vm.prank(alice);
            assertEq(other.redeem(shares, alice, alice), 1_000e6);
        }
    }

    function testLossAndDonationUseShareAccounting() public {
        allocate();
        token.burn(address(venues[3]), 10e6);
        assertEq(vault.totalAssets(), 990e6);
        token.mint(address(vault), 5e6);
        assertEq(vault.totalAssets(), 995e6);
        uint256 shares = vault.balanceOf(alice);
        vm.prank(alice);
        assertApproxEqAbs(vault.redeem(shares, alice, alice), 995e6, 1);
    }

    function testFeeTokenAndAccountingLossRevertAtomically() public {
        token.setFee(true);
        vm.prank(alice);
        vm.expectRevert();
        vault.deposit(100e6, alice);
        token.setFee(false);
        seed();
        venues[0].setDepositLoss(5);
        vm.expectRevert(SetsunaMultiEarnCore.AccountingLoss.selector);
        vault.rebalance();
        assertEq(vault.totalAssets(), 1_000e6);
    }

    function testReentrancyRejectedAndDeadlineBounded() public {
        seed();
        venues[0].setAttackReentrancy(true);
        vault.rebalance();
        assertFalse(venues[0].reentrancySucceeded());
        vm.prank(alice);
        vm.expectRevert(SetsunaMultiEarnCore.DeadlineExpired.selector);
        vault.depositWithMinShares(1e6, alice, 0, block.timestamp - 1);
    }

    function testFuzzTargetsRespectNavExposureAndMarketCash(uint96 r0, uint96 r1, uint96 r2, uint96 r3)
        public
    {
        uint96[4] memory rates = [r0, r1, r2, r3];
        for (uint256 i; i < 4; ++i) {
            venues[i].setApr(bound(rates[i], 1e12, 1e18));
        }
        seed();
        SetsunaMultiEarnCore.Plan memory p = vault.previewRebalance();
        uint256 placed;
        for (uint256 i; i < 4; ++i) {
            placed += p.target[i];
            assertLe(p.target[i], p.nav * 6 / 10);
        }
        assertLe(placed, p.nav * 9 / 10);
        assertLe(p.grossMovement, p.nav / 10);
    }
}
