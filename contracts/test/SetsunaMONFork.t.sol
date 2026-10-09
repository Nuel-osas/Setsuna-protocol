// SPDX-License-Identifier: MIT
pragma solidity 0.8.30;

import {Test, console2} from "forge-std/Test.sol";
import {IERC20} from "@openzeppelin/contracts/token/ERC20/IERC20.sol";
import {SetsunaEarnCore} from "../src/earn/SetsunaEarnCore.sol";
import {SetsunaMONVault} from "../src/earn/SetsunaMONVault.sol";
import {SetsunaMONGateway} from "../src/earn/SetsunaMONGateway.sol";
import {SetsunaMONFactory} from "../src/earn/SetsunaMONFactory.sol";
import {NeverlandMONAdapter} from "../src/earn/NeverlandMONAdapter.sol";
import {EulerMONAdapter, IEulerEarn} from "../src/earn/EulerMONAdapter.sol";
import {ILendingAdapter} from "../src/earn/ILendingAdapter.sol";
import {IAaveEarnData} from "../src/earn/VenueInterfaces.sol";

contract SetsunaMONForkTest is Test {
    uint256 constant BLOCK = 110_418_863;
    uint256 constant TIMESTAMP = 1_791_102_539;
    SetsunaMONFactory factory;
    SetsunaMONVault vault;
    SetsunaMONGateway gateway;
    IERC20 token;
    address alice = address(0xA11CE);
    address executor = address(0xE0);

    function setUp() public {
        if (!vm.envOr("RUN_FORK", false)) {
            vm.skip(true);
            return;
        }
        vm.createSelectFork(vm.envOr("MONAD_RPC_URL", string("https://rpc.monad.xyz")), BLOCK);
        assertEq(block.chainid, 143);
        assertEq(vm.getBlockTimestamp(), TIMESTAMP);
        assertEq(blockhash(BLOCK - 1), 0x4828183d3dd658319ca668f383044a7cb99efa8cdbed8b82d0f988c9467026ac);
        factory = new SetsunaMONFactory();
        (vault, gateway) = factory.createVault();
        token = IERC20(factory.WMON());
        vm.deal(alice, 10_000 ether); // Synthetic MON only; all venue contracts/storage are forked mainnet.
    }

    function _deposit() internal {
        vm.prank(alice);
        gateway.depositMON{value: 1_000 ether}(alice, 1_000e24, vm.getBlockTimestamp());
    }

    function _allocate() internal {
        _deposit();
        vm.prank(executor);
        vault.observeRates();
        for (uint256 i; i < 9; ++i) {
            vm.warp(vm.getBlockTimestamp() + 10 minutes);
            vm.roll(vm.getBlockNumber() + 1);
            vm.prank(executor);
            vault.observeRates();
            vm.roll(vm.getBlockNumber() + 1);
            vm.prank(executor);
            SetsunaEarnCore.Plan memory p = vault.rebalance();
            assertLe(p.grossMovement, p.nav / 10);
            uint256 nav = vault.totalAssets();
            assertGe(token.balanceOf(address(vault)) + 4, nav / 10);
            for (uint256 j; j < 2; ++j) {
                assertLe(vault.adapters(j).totalAssets(), nav * 6 / 10 + 4);
            }
        }
        assertGt(vault.adapters(0).totalAssets(), 0);
        assertGt(vault.adapters(1).totalAssets(), 0);
    }

    function _redeem(uint256 shares) internal returns (uint256 assets) {
        vm.startPrank(alice);
        vault.approve(address(gateway), shares);
        assets =
            gateway.redeemMON(shares, payable(alice), vault.previewRedeem(shares), vm.getBlockTimestamp());
        vm.stopPrank();
    }

    function testForkMONAtomicFactoryPolicyAndSize() public view {
        assertTrue(vault.initialized());
        assertEq(vault.asset(), factory.WMON());
        assertEq(vault.decimals(), 24);
        assertEq(vault.depositCap(), 25_000 ether);
        assertEq(vault.minimumMarketSupply(), 250_000 ether);
        assertEq(vault.guardian(), address(this));
        assertEq(address(gateway.vault()), address(vault));
        assertLe(address(factory).code.length, 24_576);
        assertLe(address(vault).code.length, 24_576);
        assertLe(address(gateway).code.length, 24_576);
        for (uint256 i; i < 2; ++i) {
            ILendingAdapter venue = vault.adapters(i);
            assertGe(venue.marketSupply(), vault.minimumMarketSupply());
            assertGt(venue.depositCapacity(), vault.depositCap());
            assertLe(address(venue).code.length, 24_576);
        }
    }

    function testForkMONAllocatesBothVenuesAndReturnsNative() public {
        _allocate();
        uint256 expected = vault.previewRedeem(vault.balanceOf(alice));
        assertEq(_redeem(vault.balanceOf(alice)), expected);
        assertEq(alice.balance, 9_000 ether + expected);
        assertEq(vault.balanceOf(alice), 0);
        assertLe(vault.totalAssets(), 5);
        assertEq(address(gateway).balance, 0);
        assertEq(token.balanceOf(address(gateway)), 0);
        assertEq(token.allowance(address(gateway), address(vault)), 0);
    }

    function testForkMONSevenDayAccrualPartialAndFullExit() public {
        _allocate();
        uint256 start = vault.totalAssets();
        vm.warp(vm.getBlockTimestamp() + 7 days);
        vm.roll(vm.getBlockNumber() + 1);
        uint256 beforeSync = vault.totalAssets();
        assertGt(beforeSync, start);
        assertApproxEqAbs(vault.sync(), beforeSync, 4);
        uint256 firstExit = _redeem(vault.balanceOf(alice) / 3);
        uint256 remaining = _redeem(vault.balanceOf(alice));
        assertGt(firstExit + remaining, 1_000 ether);
        assertEq(alice.balance, 9_000 ether + firstExit + remaining);
        assertLe(vault.totalAssets(), 5);
        console2.log("MON principal (wei)", uint256(1_000 ether));
        console2.log("MON returned after seven days (wei)", firstExit + remaining);
    }

    function testForkMONProjectedRatesMatchExecution() public {
        _deposit();
        for (uint256 i; i < 2; ++i) {
            ILendingAdapter adapter = vault.adapters(i);
            uint256 projected = adapter.supplyApr(int256(100 ether));
            vm.prank(address(vault));
            token.approve(address(adapter), 100 ether);
            vm.prank(address(vault));
            adapter.deposit(100 ether);
            assertApproxEqAbs(adapter.supplyApr(0), projected, 10);
        }
        NeverlandMONAdapter n = NeverlandMONAdapter(address(vault.adapters(0)));
        assertApproxEqAbs(
            n.supplyApr(0), n.dataProvider().getReserveData(address(token)).liquidityRate / 1e9, 10
        );
        // Euler updates its stored borrow rate after cash changes. Check it against the adapter's net supply APR.
        IEulerEarn e = EulerMONAdapter(address(vault.adapters(1))).market();
        (bool ok, bytes memory data) = address(e).staticcall(abi.encodeWithSignature("interestRate()"));
        assertTrue(ok);
        uint256 expected = abi.decode(data, (uint256)) * 365 days * e.totalBorrows()
            / (e.cash() + e.totalBorrows()) * (10_000 - e.interestFee()) / 10_000 / 1e9;
        assertApproxEqAbs(vault.adapters(1).supplyApr(0), expected, 10);
    }

    function testForkMONDisableVenueCanDrainAndExit() public {
        _allocate();
        uint256 before = vault.adapters(1).totalAssets();
        vault.disableDestination(1);
        vm.warp(vm.getBlockTimestamp() + 10 minutes);
        vm.roll(vm.getBlockNumber() + 1);
        vault.observeRates();
        vm.roll(vm.getBlockNumber() + 1);
        SetsunaEarnCore.Plan memory p = vault.rebalance();
        assertTrue(p.repairsLimits);
        assertEq(p.deposits[1], 0);
        assertLt(vault.adapters(1).totalAssets(), before);
        _redeem(vault.balanceOf(alice));
        assertLe(vault.totalAssets(), 5);
    }

    function testForkMONAdapterAuthorityAndApprovals() public {
        _allocate();
        NeverlandMONAdapter n = NeverlandMONAdapter(address(vault.adapters(0)));
        EulerMONAdapter e = EulerMONAdapter(address(vault.adapters(1)));
        assertEq(token.allowance(address(vault), address(n)), 0);
        assertEq(token.allowance(address(vault), address(e)), 0);
        assertEq(token.allowance(address(n), address(n.pool())), 0);
        assertEq(token.allowance(address(e), address(e.market())), 0);
        vm.expectRevert(NeverlandMONAdapter.Unauthorized.selector);
        n.withdraw(1 ether);
        vm.expectRevert(EulerMONAdapter.Unauthorized.selector);
        e.withdraw(1 ether);
    }

    function testForkMONEulerConfigurationChangeStopsExposureButAllowsExit() public {
        _allocate();
        EulerMONAdapter e = EulerMONAdapter(address(vault.adapters(1)));
        vm.mockCall(
            address(e.market()), abi.encodeWithSignature("interestRateModel()"), abi.encode(address(0xBAD))
        );
        assertEq(e.depositCapacity(), 0);
        vm.expectRevert(EulerMONAdapter.InvalidVenue.selector);
        e.supplyApr(0);
        _redeem(vault.balanceOf(alice));
        assertLe(vault.totalAssets(), 5);
    }

    function testForkMONNeverlandConfigurationChangeStopsExposureButAllowsExit() public {
        _allocate();
        NeverlandMONAdapter n = NeverlandMONAdapter(address(vault.adapters(0)));
        vm.mockCall(
            address(n.dataProvider()),
            abi.encodeCall(IAaveEarnData.getInterestRateStrategyAddress, (address(token))),
            abi.encode(address(0xBAD))
        );
        assertEq(n.depositCapacity(), 0);
        vm.expectRevert(NeverlandMONAdapter.InvalidVenue.selector);
        n.supplyApr(0);
        _redeem(vault.balanceOf(alice));
        assertLe(vault.totalAssets(), 5);
    }
}
