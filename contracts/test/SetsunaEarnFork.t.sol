// SPDX-License-Identifier: MIT
pragma solidity 0.8.30;

import {Test} from "forge-std/Test.sol";
import {IERC20} from "@openzeppelin/contracts/token/ERC20/IERC20.sol";
import {SetsunaEarnCore} from "../src/earn/SetsunaEarnCore.sol";
import {SetsunaEarnVault} from "../src/earn/SetsunaEarnVault.sol";
import {SetsunaUSDCFactory} from "../src/earn/SetsunaUSDCFactory.sol";
import {AaveUSDCAdapter} from "../src/earn/AaveUSDCAdapter.sol";
import {MorphoUSDCAdapter} from "../src/earn/MorphoUSDCAdapter.sol";
import {ILendingAdapter} from "../src/earn/ILendingAdapter.sol";
import {IAaveEarnPool, IAaveEarnData, IMorphoEarn} from "../src/earn/VenueInterfaces.sol";

contract SetsunaEarnForkTest is Test {
    uint256 constant FORK_BLOCK = 109_894_238;
    IERC20 constant USDC = IERC20(0x754704Bc059F8C67012fEd69BC8A327a5aafb603);
    IAaveEarnPool constant AAVE = IAaveEarnPool(0x69a5F9AD4f96ebf0a0C792dD42a01cC5C0102fef);
    IAaveEarnData constant DATA = IAaveEarnData(0xB65A68B98274ef7D9a60E0C0747dD1BEc3D32fad);
    IERC20 constant A_USDC = IERC20(0x35a73BAcb179d3740395A3ceCc87FF2e581d6042);
    IMorphoEarn constant MORPHO = IMorphoEarn(0xD5D960E8C380B724a48AC59E2DfF1b2CB4a1eAee);
    bytes32 constant MARKET = 0xe35c5abc6418b6319b014e07aa3c86163a870a957284128f03cf7a9e414f8899;
    address constant ALICE = address(0xA11CE);
    address constant EXECUTOR = address(0xB0B);
    SetsunaEarnVault vault;
    AaveUSDCAdapter aave;
    MorphoUSDCAdapter morpho;

    function setUp() public {
        vm.skip(!vm.envOr("RUN_FORK", false));
        vm.createSelectFork(vm.envOr("MONAD_RPC_URL", string("https://rpc.monad.xyz")), FORK_BLOCK);
        assertEq(block.chainid, 143);
        assertEq(block.timestamp, 1_790_944_138);
        assertEq(
            blockhash(FORK_BLOCK - 1), 0x14959d692dfb9ea7b5a5b21287854adc2a95339fbf74ff96f09e4ac9e4d29cac
        );
        // Explicit integration-only profile, NOT the factory's 250k eligibility rule.
        // It exercises both adapters at this historical block without fabricating protocol liquidity.
        vault = new SetsunaEarnVault(USDC, address(this), 25_000e6, 100_000e6);
        aave = new AaveUSDCAdapter(address(vault), address(USDC), AAVE, DATA, A_USDC);
        morpho = new MorphoUSDCAdapter(address(vault), address(USDC), MORPHO, MARKET);
        vault.initialize([ILendingAdapter(address(aave)), ILendingAdapter(address(morpho))]);
        deal(address(USDC), ALICE, 10_000e6);
        vm.prank(ALICE);
        USDC.approve(address(vault), type(uint256).max);
    }

    function _observe() internal {
        vm.prank(EXECUTOR);
        vault.observeRates();
        vm.roll(vm.getBlockNumber() + 1);
    }

    function _warm() internal {
        _observe();
        vm.warp(vm.getBlockTimestamp() + 5 minutes);
        _observe();
    }

    function _allocate() internal {
        vm.prank(ALICE);
        vault.deposit(1_000e6, ALICE);
        _warm();
        for (uint256 i; i < 9; ++i) {
            vm.warp(vm.getBlockTimestamp() + 10 minutes);
            _observe();
            vm.prank(EXECUTOR);
            SetsunaEarnCore.Plan memory p = vault.rebalance();
            assertLe(p.grossMovement, p.nav / 10);
            assertGe(USDC.balanceOf(address(vault)) + 4, vault.totalAssets() / 10);
        }
        assertGt(aave.totalAssets(), 590e6);
        assertGt(morpho.totalAssets(), 290e6);
        assertEq(USDC.balanceOf(EXECUTOR), 0);
    }

    function testForkContractChoosesBothAllocationsAndUserFullyRedeems() public {
        _allocate();
        emit log_named_uint("Aave position USDC units", aave.totalAssets());
        emit log_named_uint("Morpho position USDC units", morpho.totalAssets());
        emit log_named_uint("idle USDC units", USDC.balanceOf(address(vault)));
        uint256 shares = vault.balanceOf(ALICE);
        vm.prank(ALICE);
        uint256 assets = vault.redeemWithMinAssets(shares, ALICE, ALICE, 999e6, block.timestamp);
        assertEq(vault.balanceOf(ALICE), 0);
        assertLe(vault.totalAssets(), 5);
        assertEq(USDC.allowance(address(vault), address(aave)), 0);
        assertEq(USDC.allowance(address(vault), address(morpho)), 0);
        assertEq(USDC.allowance(address(aave), address(AAVE)), 0);
        assertEq(USDC.allowance(address(morpho), address(MORPHO)), 0);
        emit log_named_uint("full redemption USDC units", assets);
        emit log_named_uint("vault rounding residue USDC units", vault.totalAssets());
    }

    function testForkPartialWithdrawalThenFullExit() public {
        _allocate();
        vm.prank(ALICE);
        vault.withdraw(400e6, ALICE, ALICE);
        assertGt(vault.balanceOf(ALICE), 0);
        uint256 shares = vault.balanceOf(ALICE);
        vm.prank(ALICE);
        uint256 assets = vault.redeem(shares, ALICE, ALICE);
        assertApproxEqAbs(assets, 600e6, 10_000);
        assertLe(vault.totalAssets(), 5);
        emit log_named_uint("remaining redemption USDC units", assets);
    }

    function testForkSevenDayAccrualViewMatchesActualSyncAndWithdrawal() public {
        _allocate();
        uint256 beforeAssets = vault.totalAssets();
        vm.warp(vm.getBlockTimestamp() + 7 days);
        uint256 expected = vault.totalAssets();
        uint256 actual = vault.sync();
        assertApproxEqAbs(expected, actual, 2);
        assertGt(actual, beforeAssets);
        uint256 shares = vault.balanceOf(ALICE);
        vm.prank(ALICE);
        uint256 paid = vault.redeem(shares, ALICE, ALICE);
        assertGt(paid, 1_000e6);
        emit log_named_uint("before simulated accrual USDC units", beforeAssets);
        emit log_named_uint("after seven simulated days USDC units", actual);
        emit log_named_uint("paid USDC units", paid);
    }

    function testForkDefaultFactoryPreservesMinimumMarketSizeRule() public {
        SetsunaUSDCFactory factory = new SetsunaUSDCFactory();
        vault = factory.createVault();
        aave = AaveUSDCAdapter(address(vault.adapters(0)));
        morpho = MorphoUSDCAdapter(address(vault.adapters(1)));
        assertEq(vault.minimumMarketSupply(), 250_000e6);
        assertLt(morpho.marketSupply(), vault.minimumMarketSupply());
        vm.startPrank(ALICE);
        USDC.approve(address(vault), 1_000e6);
        vault.deposit(1_000e6, ALICE);
        vm.stopPrank();
        _warm();
        vm.prank(EXECUTOR);
        SetsunaEarnCore.Plan memory p = vault.rebalance();
        assertEq(p.target[1], 0);
        assertEq(p.deposits[1], 0);
        assertEq(morpho.totalAssets(), 0);
        assertGt(aave.totalAssets(), 0);
        assertEq(vault.guardian(), address(this));
        vm.expectRevert(SetsunaEarnCore.Unauthorized.selector);
        vault.initialize([ILendingAdapter(address(morpho)), ILendingAdapter(address(aave))]);
    }

    function testForkAdaptersRejectAnUnrelatedCaller() public {
        vm.prank(EXECUTOR);
        vm.expectRevert(AaveUSDCAdapter.Unauthorized.selector);
        aave.deposit(1e6);
        vm.prank(EXECUTOR);
        vm.expectRevert(AaveUSDCAdapter.Unauthorized.selector);
        aave.withdraw(1e6);
        vm.prank(EXECUTOR);
        vm.expectRevert(MorphoUSDCAdapter.Unauthorized.selector);
        morpho.deposit(1e6);
        vm.prank(EXECUTOR);
        vm.expectRevert(MorphoUSDCAdapter.Unauthorized.selector);
        morpho.withdraw(1e6);
    }

    function testForkProjectedRatesMatchRatesAfterRealDeposits() public {
        vm.prank(address(vault));
        aave.sync();
        vm.prank(address(vault));
        morpho.sync();
        uint256 aaveProjected = aave.supplyApr(500e6);
        uint256 morphoProjected = morpho.supplyApr(500e6);
        deal(address(USDC), address(vault), 1_000e6);
        vm.startPrank(address(vault));
        USDC.approve(address(aave), 500e6);
        aave.deposit(500e6);
        USDC.approve(address(morpho), 500e6);
        morpho.deposit(500e6);
        vm.stopPrank();
        assertApproxEqAbs(aaveProjected, aave.supplyApr(0), 1e9);
        assertApproxEqAbs(morphoProjected, morpho.supplyApr(0), 1e9);
        emit log_named_uint("Aave projected APR wad", aaveProjected);
        emit log_named_uint("Morpho projected APR wad", morphoProjected);
    }
}
