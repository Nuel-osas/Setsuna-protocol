// SPDX-License-Identifier: MIT
pragma solidity 0.8.30;

import {Test} from "forge-std/Test.sol";
import {Vm} from "forge-std/Vm.sol";
import {IERC20} from "@openzeppelin/contracts/token/ERC20/IERC20.sol";
import {IPerplExchange as E} from "../src/interfaces/IPerplExchange.sol";
import {SetsunaAccount} from "../src/SetsunaAccount.sol";
import {SetsunaFactory} from "../src/SetsunaFactory.sol";
import {PerplRisk} from "../src/PerplRisk.sol";

contract SetsunaForkTest is Test {
    E constant VENUE = E(0x34B6552d57a35a1D042CcAe1951BD1C370112a6F);
    IERC20 constant AUSD = IERC20(0x00000000eFE302BEAA2b3e6e1b18d08D69a9012a);
    uint256 constant PINNED_BLOCK = 108_749_101;
    SetsunaAccount account;
    uint256 id;
    address keeper = makeAddr("third-party-keeper");

    function setUp() public {
        vm.skip(!vm.envOr("RUN_FORK", false));
        vm.createSelectFork(vm.envOr("MONAD_RPC_URL", string("https://rpc.monad.xyz")), PINNED_BLOCK);
        SetsunaFactory factory = new SetsunaFactory(VENUE, AUSD, 1);
        account = SetsunaAccount(factory.createAccount());
        _dealAUSD(address(this), 10_000e6);
        AUSD.approve(address(account), type(uint256).max);
        account.initialize(1_000e6);
        account.depositTrading(100e6);
        account.fundReserve(200e6);
        id = account.accountId();
        account.executeOrder(_order(0));
        require(_position().lotLNS == 1_000, "fixture requires actual IOC fill");
    }

    function _config() internal pure returns (SetsunaAccount.PolicyConfig memory c) {
        // High trigger chosen deliberately to exercise a rescue at the unchanged pinned market.
        c = SetsunaAccount.PolicyConfig({
            capCNS: 100e6,
            minTopUpCNS: 1e6,
            feeMaxCNS: 1e6,
            triggerBufferBps: 20_000,
            targetBufferBps: 30_000,
            feeBps: 100,
            maxMarkAgeSec: 60
        });
    }

    function _order(uint8 kind) internal view returns (E.OrderDesc memory o) {
        E.PerpetualInfo memory market = VENUE.getPerpetualInfo(1);
        o.perpId = 1;
        o.orderType = kind;
        o.lotLNS = 1_000;
        o.pricePNS = kind == 0
            ? market.basePricePNS + market.minAskPriceONS + 100
            : market.basePricePNS + market.maxBidPriceONS - 100;
        o.immediateOrCancel = true;
        o.maxMatches = 30;
        o.leverageHdths = 1_000;
        o.maxNegPnlCollatBPS = 100;
    }

    function _position() internal view returns (E.PositionInfoV2 memory p) {
        (p,,) = VENUE.getPositionV2(1, id);
    }

    function _stateHash() internal view returns (bytes32) {
        return keccak256(
            abi.encode(
                VENUE.getAccountById(id),
                _position(),
                account.getPolicy(account.currentPolicyId()),
                account.reserveCNS(),
                AUSD.balanceOf(address(account)),
                AUSD.balanceOf(keeper),
                AUSD.balanceOf(address(VENUE)),
                AUSD.allowance(address(account), address(VENUE))
            )
        );
    }

    function _rescue() internal returns (SetsunaAccount.Status) {
        vm.prank(keeper);
        return account.topUp();
    }

    function testFork_ActualAccountRescuesWithinCapThenRefusesHealthyPosition() public {
        account.armPolicy(_config());
        SetsunaAccount.Quote memory q = account.previewTopUp();
        assertEq(uint256(q.status), uint256(SetsunaAccount.Status.Ready));
        uint256 freeBefore = VENUE.getAccountById(id).balanceCNS;
        E.PositionInfoV2 memory before = _position();
        assertEq(uint256(_rescue()), uint256(SetsunaAccount.Status.Ready));
        assertEq(_position().depositCNS, before.depositCNS + q.amountCNS);
        assertEq(_position().lotLNS, before.lotLNS);
        assertEq(_position().pricePNS, before.pricePNS);
        assertEq(VENUE.getAccountById(id).balanceCNS, freeBefore);
        assertEq(account.reserveCNS(), 200e6 - q.amountCNS - q.feeCNS);
        assertEq(AUSD.balanceOf(keeper), q.feeCNS);
        assertEq(AUSD.allowance(address(account), address(VENUE)), 0);
        assertEq(account.getPolicy(1).usedCNS, q.amountCNS + q.feeCNS);
        assertGe(PerplRisk.equity(_position()), int256(q.targetEquityCNS));
        assertEq(uint256(_rescue()), uint256(SetsunaAccount.Status.NotTriggered));
        emit log_named_uint("Rescue amount CNS", q.amountCNS);
        emit log_named_uint("Keeper fee CNS", q.feeCNS);
        emit log_named_uint("Maintenance requirement CNS", q.maintenanceCNS);
    }

    function testFork_CapAndReserveWithdrawalDoNotResetSpentBudget() public {
        account.armPolicy(_config());
        SetsunaAccount.Quote memory q = account.previewTopUp();
        account.setCap(q.amountCNS); // Margin fits, fee does not.
        bytes32 before_ = _stateHash();
        assertEq(uint256(_rescue()), uint256(SetsunaAccount.Status.InsufficientBudget));
        assertEq(_stateHash(), before_);
        account.setCap(100e6);
        _rescue();
        uint256 used = account.getPolicy(1).usedCNS;
        account.withdrawReserve(account.reserveCNS());
        assertEq(account.reserveCNS(), 0);
        assertEq(account.getPolicy(1).usedCNS, used);
        assertEq(AUSD.balanceOf(address(account)), 0);
    }

    function testFork_SameBlockCloseReopenAndFlipInvalidateAuthorization() public {
        account.armPolicy(_config());
        uint256 oldEntryBlock = _position().entryBlock;
        account.executeOrder(_order(2));
        assertEq(_position().lotLNS, 0);
        account.executeOrder(_order(0));
        assertEq(_position().entryBlock, oldEntryBlock);
        assertEq(uint256(_rescue()), uint256(SetsunaAccount.Status.Inactive));
        account.armPolicy(_config());
        E.OrderDesc memory flip = _order(1);
        flip.lotLNS = 2_000;
        account.executeOrder(flip);
        assertEq(_position().positionType, 1);
        assertEq(uint256(_rescue()), uint256(SetsunaAccount.Status.Inactive));
        assertEq(VENUE.getOrderLocks(id).length, 0);
    }

    function testFork_InjectedSilentIncreaseFailureRollsBackNativeDeposit() public {
        account.armPolicy(_config());
        bytes32 before_ = _stateHash();
        // Deliberate fault injection. This proves our atomic wrapper, not a native failure path.
        vm.mockCall(address(VENUE), abi.encodeWithSelector(E.increasePositionCollateral.selector), bytes(""));
        vm.prank(keeper);
        vm.expectRevert(SetsunaAccount.UnexpectedDelta.selector);
        account.topUp();
        assertEq(_stateHash(), before_);
        vm.clearMockedCalls();
    }

    function testFork_BothForwardingPathsRejectEvenAPrivilegedForwarder() public {
        account.armPolicy(_config());
        address admin = VENUE.owner();
        vm.prank(admin);
        VENUE.setAdministrator(admin, true);
        vm.prank(admin);
        VENUE.setPositionAdministrator(admin, true);
        E.FwdOrderDesc[] memory orders = new E.FwdOrderDesc[](1);
        orders[0].accountId = id;
        orders[0].orderDesc = _order(2);
        orders[0].orderDesc.orderDescId = 1;
        bytes[] memory extensions = new bytes[](1);
        bytes32 before_ = _stateHash();
        for (uint256 version = 0; version < 2; ++version) {
            vm.recordLogs();
            vm.prank(admin);
            if (version == 0) {
                VENUE.execFwdPositionOps(orders);
            } else {
                VENUE.execFwdPositionOpsV2(orders, extensions);
            }
            Vm.Log[] memory entries = vm.getRecordedLogs();
            bool refused;
            for (uint256 i = 0; i < entries.length; ++i) {
                if (
                    entries[i].emitter == address(VENUE) && entries[i].topics.length > 0
                        && entries[i].topics[0] == keccak256("OrderForwardingNotAllowed()")
                ) {
                    refused = true;
                }
            }
            assertTrue(refused, "must fail for disabled forwarding, not a caller permission issue");
            assertEq(_stateHash(), before_);
        }
    }

    function testFork_StaleReferenceCannotSpendReserve() public {
        account.armPolicy(_config());
        vm.warp(block.timestamp + 61);
        bytes32 before_ = _stateHash();
        SetsunaAccount.Status status = _rescue();
        assertTrue(status == SetsunaAccount.Status.StaleMark || status == SetsunaAccount.Status.InvalidMark);
        assertEq(_stateHash(), before_);
    }

    function testFork_G5_LiquidationBoundaryMatchesEntryBasedMaintenance() public {
        _checkLiquidationBoundary();
    }

    function testFork_G5_ShortLiquidationBoundaryMatchesEntryBasedMaintenance() public {
        account.executeOrder(_order(2));
        account.executeOrder(_order(1));
        assertEq(_position().positionType, 1);
        _checkLiquidationBoundary();
    }

    function testFork_PartialIOCLeavesNoDelayedOrderAndRevokesPolicy() public {
        account.armPolicy(_config());
        E.OrderDesc memory order = _order(0);
        order.maxMatches = 1;
        order.lotLNS = 100_000;
        uint256 beforeLot = _position().lotLNS;
        account.executeOrder(order);
        assertLt(_position().lotLNS - beforeLot, order.lotLNS);
        assertEq(VENUE.getOrderLocks(id).length, 0);
        assertEq(uint256(_rescue()), uint256(SetsunaAccount.Status.Inactive));
    }

    function testFork_UnfillableFOKCannotLeaveAPartialPositionOrRestingOrder() public {
        account.armPolicy(_config());
        E.OrderDesc memory order = _order(0);
        order.maxMatches = 1;
        order.lotLNS = 100_000;
        order.immediateOrCancel = false;
        order.fillOrKill = true;
        uint256 beforeLot = _position().lotLNS;
        (bool ok,) = address(account).call(abi.encodeCall(SetsunaAccount.executeOrder, (order)));
        assertEq(_position().lotLNS, beforeLot, "FOK cannot partially fill");
        assertEq(VENUE.getOrderLocks(id).length, 0);
        assertEq(account.getPolicy(1).active, !ok, "only a reverted order restores the old policy");
    }

    function _checkLiquidationBoundary() internal {
        account.armPolicy(_config());
        E.PositionInfoV2 memory p = _position();
        E.PerpetualInfo memory market = VENUE.getPerpetualInfo(1);
        (, uint256 factor,,,,) = VENUE.getMarginFractions(1, p.lotLNS);
        uint256 mmr = PerplRisk.maintenance(p, market.priceDecimals, market.lotDecimals, factor);
        // LOCAL FORK ONLY: adjust the owner-controlled mark within a widened tolerance.
        address venueOwner = VENUE.owner();
        vm.prank(venueOwner);
        VENUE.setPositionAdministrator(venueOwner, true);
        vm.prank(venueOwner);
        VENUE.setPriceTolPer100KByOwner(1, 10_000);
        // A 1-PNS tick is 1,000 CNS for this 0.01 BTC position.
        uint256 ticks = (p.depositCNS - mmr) / 1_000;
        bool isLong = p.positionType == 0;
        uint32 boundary = uint32(isLong ? p.pricePNS - ticks : p.pricePNS + ticks);
        vm.prank(venueOwner);
        VENUE.updateMarkPricePNSByOwner(1, isLong ? boundary + 2 : boundary - 2);
        assertGt(PerplRisk.equity(_position()), int256(mmr));
        E.LiquidationDesc memory desc = E.LiquidationDesc(1, id, p.lotLNS, false);
        // Probe success/refusal and state, without assuming an ABI event proves behavior.
        vm.prank(venueOwner);
        (bool aboveOk,) = address(VENUE).call(abi.encodeCall(E.liquidation, (desc)));
        aboveOk; // A non-reverting refusal and a revert both leave the position intact.
        assertEq(_position().lotLNS, p.lotLNS, "healthy position must not liquidate");
        vm.prank(venueOwner);
        VENUE.updateMarkPricePNSByOwner(1, isLong ? boundary - 2 : boundary + 2);
        assertLt(PerplRisk.equity(_position()), int256(mmr));
        vm.prank(venueOwner);
        VENUE.liquidation(desc);
        assertLt(_position().lotLNS, p.lotLNS, "eligible position must actually liquidate");
        SetsunaAccount.Status afterStatus = _rescue();
        assertTrue(
            afterStatus == SetsunaAccount.Status.NoPosition
                || afterStatus == SetsunaAccount.Status.BindingChanged
        );
        emit log_named_uint("Entry-based MMR CNS", mmr);
        emit log_named_uint("Boundary PNS (within 2 ticks)", boundary);
    }

    function _dealAUSD(address to, uint256 amount) internal {
        vm.record();
        AUSD.balanceOf(to);
        (bytes32[] memory slots,) = vm.accesses(address(AUSD));
        bytes32 slot = slots[slots.length - 1];
        uint256 previous = uint256(vm.load(address(AUSD), slot));
        vm.store(address(AUSD), slot, bytes32((amount << 8) | (previous & 0xff)));
        assertEq(AUSD.balanceOf(to), amount);
    }
}
