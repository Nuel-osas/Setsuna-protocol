// SPDX-License-Identifier: MIT
pragma solidity 0.8.30;
import {Test} from "forge-std/Test.sol";
import {IERC20} from "@openzeppelin/contracts/token/ERC20/IERC20.sol";
import {
    SetsunaSpotOrders,
    SetsunaSpotOrderAccount,
    IKuruLimitMarket,
    IKuruMargin
} from "../src/spot/SetsunaSpotOrders.sol";
import {SetsunaTradingForkTest} from "./SetsunaTradingFork.t.sol";
import {IPerplExchange as E} from "../src/interfaces/IPerplExchange.sol";
import {SetsunaAccount} from "../src/SetsunaAccount.sol";
import {SetsunaFactory} from "../src/SetsunaFactory.sol";

interface IKuruBest {
    function bestBidAsk() external view returns (uint256, uint256);
}

interface IPerplLevels {
    function getPriceLevelOrderIds(uint256 perp, uint256 price) external view returns (uint256, uint256);
}

contract SpotOrderTypesForkTest is Test {
    IKuruLimitMarket constant market = IKuruLimitMarket(0x065C9d28E428A0db40191a54d33d5b7c71a9C394);
    IKuruMargin constant margin = IKuruMargin(0x2A68ba1833cDf93fa9Da1EEbd7F46242aD8E90c5);
    IERC20 constant usdc = IERC20(0x754704Bc059F8C67012fEd69BC8A327a5aafb603);
    SetsunaSpotOrderAccount account;

    function setUp() public {
        vm.skip(!vm.envOr("RUN_FORK", false));
        vm.createSelectFork(vm.envOr("MONAD_RPC_URL", string("https://rpc.monad.xyz")), 110_418_863);
        SetsunaSpotOrders factory = new SetsunaSpotOrders(market, margin, usdc);
        account = SetsunaSpotOrderAccount(payable(factory.createAccount()));
        vm.deal(address(this), 1000 ether);
        deal(address(usdc), address(this), 1000e6);
        usdc.approve(address(account), type(uint256).max);
    }
    receive() external payable {}

    function testFork_SpotNeverPullsMoreThanReviewedFunding() public {
        (uint32 pp, uint96 sp,,,,, uint32 tick,,,,) = market.getMarketParams();
        (uint256 bid,) = IKuruBest(address(market)).bestBidAsk();
        uint32 price = uint32((bid * pp / 1e18 / 2 / tick) * tick);
        uint256 before = usdc.balanceOf(address(this));
        // The owner's broad approval must not bypass the per-order spend cap.
        vm.expectRevert(SetsunaSpotOrderAccount.InvalidOrder.selector);
        account.placeLimit(true, price, sp * 200, true, 1, block.timestamp + 60);
        assertEq(usdc.balanceOf(address(this)), before);
        (uint40[] memory ids,) = account.getOpenOrders();
        assertEq(ids.length, 0);
    }

    function testFork_SpotPartialFillCancelAndWithdrawProceeds() public {
        (uint32 pp, uint96 sp,,,,, uint32 tick,,,,) = market.getMarketParams();
        (uint256 bid, uint256 ask) = IKuruBest(address(market)).bestBidAsk();
        uint32 price = uint32(((bid + ask) * pp / 2 / 1e18 / tick) * tick);
        account.placeLimit{value: 400 ether}(false, price, sp * 400, true, 400 ether, block.timestamp + 60);
        address buyer = makeAddr("spot-buyer");
        SetsunaSpotOrders factory = new SetsunaSpotOrders(market, margin, usdc);
        vm.prank(buyer);
        SetsunaSpotOrderAccount other = SetsunaSpotOrderAccount(payable(factory.createAccount()));
        deal(address(usdc), buyer, 100e6);
        vm.startPrank(buyer);
        usdc.approve(address(other), 100e6);
        other.placeLimit(true, price, sp * 200, false, 100e6, block.timestamp + 60);
        vm.stopPrank();
        (uint40[] memory ids, IKuruLimitMarket.Order[] memory orders) = account.getOpenOrders();
        assertEq(orders.length, 1);
        assertEq(orders[0].size, sp * 200);
        (uint40[] memory buyerOrders,) = other.getOpenOrders();
        assertEq(buyerOrders.length, 0);
        assertEq(margin.getBalance(address(other), address(0)), 200 ether);
        uint256 proceeds = uint256(price) * 200 * 1e6 / pp;
        assertEq(margin.getBalance(address(account), address(usdc)), proceeds);
        account.cancelOrder(ids[0]);
        assertEq(margin.getBalance(address(account), address(0)), 200 ether);
        uint256 before = usdc.balanceOf(address(this));
        account.withdraw(address(usdc), proceeds);
        assertEq(usdc.balanceOf(address(this)), before + proceeds);
        vm.startPrank(buyer);
        other.withdraw(address(0), 200 ether);
        vm.stopPrank();
        assertEq(buyer.balance, 200 ether);
    }

    function testFork_SpotLimitSellCancelWithdraw() public {
        (uint32 pp, uint96 precision,,,,, uint32 tick,,,,) = market.getMarketParams();
        (, uint256 ask) = IKuruBest(address(market)).bestBidAsk();
        uint32 price = uint32((ask * pp / 1e18 * 2 / tick) * tick);
        account.placeLimit{value: 200 ether}(
            false, price, precision * 200, true, 200 ether, block.timestamp + 60
        );
        (uint40[] memory ids, IKuruLimitMarket.Order[] memory orders) = account.getOpenOrders();
        assertEq(ids.length, 1);
        assertEq(orders[0].size, precision * 200);
        assertEq(orders[0].ownerAddress, address(account));
        assertEq(margin.getBalance(address(account), address(0)), 0);
        vm.prank(makeAddr("other"));
        vm.expectRevert(SetsunaSpotOrderAccount.Unauthorized.selector);
        account.cancelOrder(ids[0]);
        account.cancelOrder(ids[0]);
        (ids,) = account.getOpenOrders();
        assertEq(ids.length, 0);
        assertEq(margin.getBalance(address(account), address(0)), 200 ether);
        uint256 beforeBalance = address(this).balance;
        account.withdraw(address(0), 200 ether);
        assertEq(address(this).balance, beforeBalance + 200 ether);
    }

    function testFork_SpotLimitBuyCancelWithdraw() public {
        (uint32 pp, uint96 sp,,,,, uint32 tick,,,,) = market.getMarketParams();
        (uint256 bid,) = IKuruBest(address(market)).bestBidAsk();
        uint32 price = uint32((bid * pp / 1e18 / 2 / tick) * tick);
        uint256 beforeBalance = usdc.balanceOf(address(this));
        account.placeLimit(true, price, sp * 200, true, 100e6, block.timestamp + 60);
        (uint40[] memory ids,) = account.getOpenOrders();
        assertEq(ids.length, 1);
        account.cancelOrder(ids[0]);
        uint256 available = margin.getBalance(address(account), address(usdc));
        assertGt(available, 0);
        assertEq(available, (uint256(price) * 200 * 1e6 + pp - 1) / pp);
        account.withdraw(address(usdc), available);
        assertEq(usdc.balanceOf(address(this)), beforeBalance);
        assertEq(usdc.allowance(address(account), address(margin)), 0);
    }
}

contract PerpsOrderTypesForkTest is SetsunaTradingForkTest {
    function testFork_PerpsPartialFillTracksRemainderAndBlocksProtection() public {
        E.PerpetualInfo memory m = VENUE.getPerpetualInfo(1);
        // Make room for a controlled maker/taker match by cancelling the
        // historical best bid on this isolated fork. No oracle/storage edits.
        (uint256 head, uint256 tail) = IPerplLevels(address(VENUE)).getPriceLevelOrderIds(1, m.maxBidPriceONS);
        while (head != 0) {
            E.Order memory existing = VENUE.getOrder(1, head);
            E.OrderDesc memory cancel;
            cancel.perpId = 1;
            cancel.orderType = 4;
            cancel.orderId = head;
            vm.prank(VENUE.getAccountById(existing.accountId).accountAddr);
            VENUE.execOrder(cancel);
            if (head == tail) {
                break;
            }
            head = existing.nextOrderId;
        }
        E.OrderDesc memory maker = _order(0);
        maker.pricePNS = m.basePricePNS + m.maxBidPriceONS;
        maker.lotLNS = 200;
        maker.fillOrKill = false;
        maker.postOnly = true;
        account.executeOrder(maker);
        address taker = makeAddr("perps-taker");
        AUSD.transfer(taker, 1000e6);
        SetsunaFactory f = new SetsunaFactory(VENUE, AUSD, 1, address(0), 0);
        vm.startPrank(taker);
        SetsunaAccount other = SetsunaAccount(f.createAccount());
        AUSD.approve(address(other), 1000e6);
        other.initialize(1000e6);
        E.OrderDesc memory order = _order(1);
        order.pricePNS = maker.pricePNS;
        other.executeOrder(order);
        vm.stopPrank();
        assertEq(_position().lotLNS, 100);
        E.Order[] memory orders = account.getOpenOrders();
        assertEq(orders.length, 1);
        assertEq(orders[0].lotLNS, 100);
        vm.expectRevert(
            abi.encodeWithSelector(SetsunaAccount.CannotArm.selector, SetsunaAccount.Status.OutstandingOrders)
        );
        account.armPolicy(
            SetsunaAccount.PolicyConfig({
                capCNS: 50e6,
                minTopUpCNS: 1e6,
                feeMaxCNS: 1e6,
                triggerBufferBps: 3_000,
                targetBufferBps: 7_000,
                feeBps: 100,
                maxMarkAgeSec: 60
            })
        );
        account.cancelOrder(orders[0].orderId);
        assertEq(account.getOpenOrders().length, 0);
        assertEq(_position().lotLNS, 100);
        assertEq(account.reserveCNS(), 200e6);
    }

    function testFork_PerpsCrossingLimitFillsWithoutRestingOrder() public {
        E.OrderDesc memory o = _order(0);
        o.fillOrKill = false;
        account.executeOrder(o);
        assertEq(_position().lotLNS, 100);
        assertEq(account.getOpenOrders().length, 0);
        assertEq(account.reserveCNS(), 200e6);
    }

    function testFork_PerpsRestingLimitCancelUnlocksCollateral() public {
        E.OrderDesc memory o = _order(0);
        E.PerpetualInfo memory m = VENUE.getPerpetualInfo(1);
        o.pricePNS = m.basePricePNS + m.maxBidPriceONS - 1000;
        o.fillOrKill = false;
        o.postOnly = true;
        uint256 beforeBalance = VENUE.getAccountById(account.accountId()).balanceCNS;
        account.executeOrder(o);
        E.Order[] memory orders = account.getOpenOrders();
        assertEq(orders.length, 1);
        assertEq(orders[0].lotLNS, 100);
        assertEq(VENUE.getOrderLocks(account.accountId()).length, 1);
        assertEq(_position().lotLNS, 0);
        vm.prank(makeAddr("stranger"));
        vm.expectRevert(SetsunaAccount.Unauthorized.selector);
        account.cancelOrder(orders[0].orderId);
        account.cancelOrder(orders[0].orderId);
        assertEq(account.getOpenOrders().length, 0);
        assertEq(VENUE.getOrderLocks(account.accountId()).length, 0);
        assertEq(VENUE.getAccountById(account.accountId()).balanceCNS, beforeBalance);
        assertEq(account.reserveCNS(), 200e6);
    }
}
