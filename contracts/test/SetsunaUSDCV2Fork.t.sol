// SPDX-License-Identifier: MIT
pragma solidity 0.8.30;
import {Test} from "forge-std/Test.sol";
import {IERC20} from "@openzeppelin/contracts/token/ERC20/IERC20.sol";
import {SetsunaUSDCV2Factory, USDCV2VaultDeployer} from "../src/earn/SetsunaUSDCV2Factory.sol";
import {SetsunaUSDCVault} from "../src/earn/SetsunaUSDCVault.sol";
import {SetsunaMultiEarnCore} from "../src/earn/SetsunaMultiEarnCore.sol";
import {ILendingAdapterV2} from "../src/earn/ILendingAdapterV2.sol";

contract SetsunaUSDCV2ForkTest is Test {
    uint256 constant FORK_BLOCK = 111_523_095;
    IERC20 constant USDC = IERC20(0x754704Bc059F8C67012fEd69BC8A327a5aafb603);
    address alice = address(0xA11CE);
    SetsunaUSDCVault vault;

    function setUp() public {
        vm.skip(!vm.envOr("RUN_FORK", false));
        vm.createSelectFork(vm.envOr("MONAD_RPC_URL", string("https://rpc.monad.xyz")), FORK_BLOCK);
        assertEq(block.chainid, 143);
        assertEq(block.timestamp, 1791436247);
        vault = (new SetsunaUSDCV2Factory(new USDCV2VaultDeployer())).createVault();
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
        for (uint256 i; i < 4; ++i) {
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

    function testForkFourRealProtocolsPartialAndFullExit() public {
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
        uint256 expected = vault.totalAssets();
        uint256 actual = vault.sync();
        assertApproxEqAbs(expected, actual, 4);
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
        uint256 beforeAssets = vault.adapters(2).totalAssets();
        vault.disableDestination(2);
        vm.warp(vm.getBlockTimestamp() + 601);
        observe();
        SetsunaMultiEarnCore.Plan memory p = vault.rebalance();
        assertEq(p.target[2], 0);
        assertEq(p.deposits[2], 0);
        assertLt(vault.adapters(2).totalAssets(), beforeAssets);
        uint256 shares = vault.balanceOf(alice);
        vm.prank(alice);
        vault.redeem(shares, alice, alice);
        assertLe(vault.totalAssets(), 8);
    }

    function testForkProjectedRatesMatchDepositsAndAdaptersRestrictAuthority() public {
        for (uint256 i; i < 4; ++i) {
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
}
