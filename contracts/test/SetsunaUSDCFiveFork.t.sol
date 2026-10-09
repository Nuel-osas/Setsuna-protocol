// SPDX-License-Identifier: MIT
pragma solidity 0.8.30;
import {Test} from "forge-std/Test.sol";
import {IERC20} from "@openzeppelin/contracts/token/ERC20/IERC20.sol";
import {SetsunaUSDCV2Factory, USDCV2VaultDeployer} from "../src/earn/SetsunaUSDCV2Factory.sol";
import {SetsunaUSDCVault} from "../src/earn/SetsunaUSDCVault.sol";
import {SetsunaMultiEarnCore} from "../src/earn/SetsunaMultiEarnCore.sol";
import {ILendingAdapterV2} from "../src/earn/ILendingAdapterV2.sol";

import {
    CurvanceUSDCAdapter,
    ICurvanceEarn,
    ICurvanceEarnManager,
    ICurvanceEarnRate
} from "../src/earn/CurvanceUSDCAdapter.sol";

contract SetsunaUSDCFiveForkTest is Test {
    uint256 constant FORK_BLOCK = 111_560_409;
    IERC20 constant USDC = IERC20(0x754704Bc059F8C67012fEd69BC8A327a5aafb603);
    address alice = address(0xA11CE);
    SetsunaUSDCVault vault;

    function setUp() public {
        vm.skip(!vm.envOr("RUN_FORK", false));
        vm.createSelectFork(
            vm.envOr("MONAD_RPC_URL", string("https://rpc-mainnet.monadinfra.com")), FORK_BLOCK
        );
        assertEq(block.chainid, 143);
        assertEq(block.timestamp, 1791447513);
        assertEq(
            blockhash(FORK_BLOCK - 1), 0x19ae1b058fd08d90d2ad7c126546e3c7783e9ce7d54d447f54a11c7e7312af57
        );
        vault = (new SetsunaUSDCV2Factory(new USDCV2VaultDeployer())).createFiveProtocolVault();
        deal(address(USDC), alice, 10_000e6);
        vm.prank(alice);
        USDC.approve(address(vault), type(uint256).max);
    }

    function observe() internal {
        vault.observeRates();
        vm.roll(vm.getBlockNumber() + 1);
    }

    function allocate() internal {
        vm.prank(alice);
        vault.deposit(1_000e6, alice);
        observe();
        vm.warp(vm.getBlockTimestamp() + 301);
        observe();
        for (uint256 j; j < 12; ++j) {
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
        for (uint256 i; i < 5; ++i) {
            ILendingAdapterV2 a = vault.adapters(i);
            assertGe(a.marketSupply(), 250_000e6);
            assertGt(a.totalAssets(), 0);
            assertLe(a.totalAssets(), vault.totalAssets() * 6 / 10 + 4);
            assertLe(a.totalAssets(), a.marketLiquidity() / 10);
            assertEq(USDC.allowance(address(vault), address(a)), 0);
            emit log_named_uint("destination", i);
            emit log_named_uint("position USDC units", a.totalAssets());
        }
    }

    function testForkFiveRealProtocolsPartialAndFullExit() public {
        allocate();
        vm.prank(alice);
        vault.withdraw(400e6, alice, alice);
        uint256 shares = vault.balanceOf(alice);
        vm.prank(alice);
        uint256 paid = vault.redeem(shares, alice, alice);
        assertApproxEqAbs(paid, 600e6, 20_000);
        assertLe(vault.totalAssets(), 8);
        assertEq(vault.balanceOf(alice), 0);
        emit log_named_uint("remaining withdrawal USDC units", paid);
    }

    function testForkYieldAccruesIntoSharePriceAndFullyRedeems() public {
        allocate();
        uint256 beforeAssets = vault.totalAssets();
        vm.warp(vm.getBlockTimestamp() + 7 days);
        uint256 actual = vault.sync();
        assertEq(vault.totalAssets(), actual);
        assertEq(vault.sync(), actual, "same-block sync must be idempotent");
        assertGt(actual, beforeAssets);
        uint256 shares = vault.balanceOf(alice);
        vm.prank(alice);
        uint256 paid = vault.redeem(shares, alice, alice);
        assertGt(paid, 1_000e6);
        assertLe(vault.totalAssets(), 8);
        emit log_named_uint("seven simulated days full withdrawal", paid);
    }

    function testForkDisableDestinationReallocatesAndRedeems() public {
        allocate();
        uint256 beforeAssets = vault.adapters(4).totalAssets();
        vault.disableDestination(4);
        vm.warp(vm.getBlockTimestamp() + 601);
        observe();
        SetsunaMultiEarnCore.Plan memory p = vault.rebalance();
        assertEq(p.target[4], 0);
        assertEq(p.deposits[4], 0);
        assertLt(vault.adapters(4).totalAssets(), beforeAssets);
        uint256 shares = vault.balanceOf(alice);
        vm.prank(alice);
        vault.redeem(shares, alice, alice);
        assertLe(vault.totalAssets(), 8);
    }

    function testForkProjectedRatesMatchDepositsAndAdaptersRestrictAuthority() public {
        for (uint256 i; i < 5; ++i) {
            ILendingAdapterV2 a = vault.adapters(i);
            vm.prank(alice);
            vm.expectRevert();
            a.deposit(1e6);
            vm.prank(address(vault));
            a.sync();
            uint256 projected = a.supplyApr(100e6);
            deal(address(USDC), address(vault), 100e6);
            vm.startPrank(address(vault));
            USDC.approve(address(a), 100e6);
            a.deposit(100e6);
            vm.stopPrank();
            assertApproxEqAbs(projected, a.supplyApr(0), 1e10);
            uint256 held = a.totalAssets();
            vm.prank(address(vault));
            a.withdraw(held);
            assertLe(a.totalAssets(), 1);
        }
    }

    function curvance() internal view returns (CurvanceUSDCAdapter) {
        return CurvanceUSDCAdapter(address(vault.adapters(4)));
    }

    function testForkCurvancePauseBlocksNewExposureAndPreservesClaim() public {
        allocate();
        CurvanceUSDCAdapter a = curvance();
        uint256 claim = a.totalAssets();
        vm.mockCall(
            address(a.manager()),
            abi.encodeWithSelector(ICurvanceEarnManager.redeemPaused.selector),
            abi.encode(uint8(2))
        );
        assertEq(a.depositCapacity(), 0);
        assertEq(a.availableLiquidity(), 0);
        assertEq(a.marketLiquidity(), 0);
        assertEq(a.totalAssets(), claim, "pause must not erase NAV");
        assertLt(vault.maxWithdraw(alice), vault.totalAssets());
        vm.prank(address(vault));
        vm.expectRevert(CurvanceUSDCAdapter.InvalidVenue.selector);
        a.withdraw(1e6);
        vm.clearMockedCalls();
        uint256 shares = vault.balanceOf(alice);
        vm.prank(alice);
        vault.redeem(shares, alice, alice);
        assertEq(vault.balanceOf(alice), 0);
    }

    function testForkCurvanceIRMChangeStopsNewAllocationButAllowsExit() public {
        allocate();
        CurvanceUSDCAdapter a = curvance();
        // Mock the view only: the real venue continues processing deposits/withdrawals.
        vm.mockCall(
            address(a.market()),
            abi.encodeWithSelector(ICurvanceEarn.IRM.selector),
            abi.encode(address(0xBAD))
        );
        assertEq(a.depositCapacity(), 0);
        vm.expectRevert(CurvanceUSDCAdapter.InvalidVenue.selector);
        a.supplyApr(0);
        uint256 held = a.totalAssets();
        vm.prank(address(vault));
        assertEq(a.withdraw(held), held);
        assertEq(a.market().balanceOf(address(a)), 0);
    }

    function testForkCurvanceActualCashBoundsLiquidity() public {
        allocate();
        CurvanceUSDCAdapter a = curvance();
        vm.mockCall(address(USDC), abi.encodeCall(IERC20.balanceOf, (address(a.market()))), abi.encode(10e6));
        assertEq(a.marketLiquidity(), 10e6);
        assertEq(a.availableLiquidity(), 10e6);
    }

    function testForkCurvanceMintPauseAndValuationFailureFailClosed() public {
        CurvanceUSDCAdapter a = curvance();
        vm.mockCall(
            address(a.market()),
            abi.encodeWithSignature("maxDeposit(address)", address(a)),
            abi.encode(uint256(0))
        );
        assertEq(a.depositCapacity(), 0);
        vm.prank(address(vault));
        vm.expectRevert(CurvanceUSDCAdapter.InvalidVenue.selector);
        a.deposit(1e6);
        vm.mockCallRevert(
            address(a.market()),
            abi.encodeWithSignature("convertToAssets(uint256)", uint256(0)),
            "failed valuation"
        );
        (, bool healthy) = vault.accounting();
        assertFalse(healthy);
        assertEq(vault.maxDeposit(alice), 0);
        assertEq(vault.maxRedeem(alice), 0);
    }

    function testForkCurvanceAuthorityDonationAndAllowanceReset() public {
        CurvanceUSDCAdapter a = curvance();
        vm.expectRevert(CurvanceUSDCAdapter.Unauthorized.selector);
        a.sync();
        vm.expectRevert(CurvanceUSDCAdapter.Unauthorized.selector);
        a.withdraw(1);
        vm.expectRevert(CurvanceUSDCAdapter.Unauthorized.selector);
        a.deposit(1);
        deal(address(USDC), address(a), 12e6);
        uint256 beforeCash = USDC.balanceOf(address(vault));
        vault.sync();
        assertEq(USDC.balanceOf(address(vault)), beforeCash + 12e6);
        assertEq(USDC.balanceOf(address(a)), 0);
        vm.prank(alice);
        vault.deposit(100e6, alice);
        observe();
        vm.warp(block.timestamp + 301);
        observe();
        vault.rebalance();
        assertEq(USDC.allowance(address(vault), address(a)), 0);
        assertEq(USDC.allowance(address(a), address(a.market())), 0);
    }

    function testForkCurvanceConstructorRejectsWrongVenueIdentity() public {
        CurvanceUSDCAdapter a = curvance();
        ICurvanceEarn market = a.market();
        address manager = address(a.manager());
        address registry = a.centralRegistry();
        address rate = address(a.rateStrategy());
        vm.expectRevert(CurvanceUSDCAdapter.InvalidVenue.selector);
        new CurvanceUSDCAdapter(address(vault), address(USDC), market, manager, manager);
        vm.expectRevert(CurvanceUSDCAdapter.InvalidVenue.selector);
        new CurvanceUSDCAdapter(address(vault), address(USDC), market, registry, address(market));
        vm.mockCall(
            rate, abi.encodeWithSelector(ICurvanceEarnRate.linkedToken.selector), abi.encode(address(0xBAD))
        );
        vm.expectRevert(CurvanceUSDCAdapter.InvalidVenue.selector);
        new CurvanceUSDCAdapter(address(vault), address(USDC), market, registry, manager);
    }
}
