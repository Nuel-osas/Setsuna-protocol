// SPDX-License-Identifier: MIT
pragma solidity 0.8.30;

import {Test} from "forge-std/Test.sol";
import {IERC20} from "@openzeppelin/contracts/token/ERC20/IERC20.sol";
import {IPerplExchange as E} from "../src/interfaces/IPerplExchange.sol";
import {SetsunaAccount} from "../src/SetsunaAccount.sol";
import {SetsunaFactory} from "../src/SetsunaFactory.sol";
import {PerplRisk} from "../src/PerplRisk.sol";
import {MockAUSD, MockPerpl} from "./Mocks.sol";

contract SetsunaAccountTest is Test {
    MockAUSD token;
    MockPerpl venue;
    SetsunaAccount account;
    SetsunaFactory factory;
    address trader = makeAddr("trader");
    address keeper = makeAddr("keeper");
    uint256 id;

    function setUp() public {
        vm.warp(1_790_597_873);
        vm.roll(108_749_101);
        token = new MockAUSD();
        venue = new MockPerpl(token);
        factory = new SetsunaFactory(E(address(venue)), IERC20(address(token)), 1);
        vm.prank(trader);
        account = SetsunaAccount(factory.createAccount());
        token.mint(trader, 10_000e6);
        vm.startPrank(trader);
        token.approve(address(account), type(uint256).max);
        account.initialize(1_000e6);
        account.fundReserve(100e6);
        account.executeOrder(_order(0));
        vm.stopPrank();
        id = account.accountId();
        venue.setPnl(id, -32e6, 0); // Equity=48; MMR=40; trigger=50; target=60.
    }

    function _config() internal pure returns (SetsunaAccount.PolicyConfig memory c) {
        c = SetsunaAccount.PolicyConfig({
            capCNS: 50e6,
            minTopUpCNS: 1e6,
            feeMaxCNS: 1e6,
            triggerBufferBps: 2500,
            targetBufferBps: 5000,
            feeBps: 100,
            maxMarkAgeSec: 60
        });
    }

    function _order(uint8 kind) internal pure returns (E.OrderDesc memory o) {
        o.perpId = 1;
        o.orderType = kind;
        o.lotLNS = 1000;
        o.pricePNS = 1_000_000;
        o.immediateOrCancel = true;
        o.leverageHdths = 1000;
    }

    function _arm() internal {
        vm.prank(trader);
        account.armPolicy(_config());
    }

    function _position() internal view returns (E.PositionInfoV2 memory p) {
        (p,,) = venue.getPositionV2(1, id);
    }

    function _stateHash() internal view returns (bytes32) {
        return keccak256(
            abi.encode(
                venue.getAccountById(id),
                _position(),
                account.reserveCNS(),
                account.getPolicy(account.currentPolicyId()),
                token.balanceOf(address(account)),
                token.balanceOf(keeper),
                token.balanceOf(address(venue)),
                token.allowance(address(account), address(venue))
            )
        );
    }

    function _topUp() internal returns (SetsunaAccount.Status) {
        vm.prank(keeper);
        return account.topUp();
    }

    function testFactoryBindsOwnerAndRejectsDuplicate() public {
        assertEq(account.owner(), trader);
        assertEq(factory.accountOf(trader), address(account));
        assertFalse(venue.forwarding(id));
        vm.prank(trader);
        vm.expectRevert(SetsunaFactory.AccountAlreadyExists.selector);
        factory.createAccount();
    }

    function testPermissionlessTopUpRestoresTargetAndCountsFeeInsideCap() public {
        _arm();
        SetsunaAccount.Quote memory q = account.previewTopUp();
        assertEq(uint256(q.status), uint256(SetsunaAccount.Status.Ready));
        assertEq(q.maintenanceCNS, 40e6);
        assertEq(q.equityCNS, 48e6);
        assertEq(q.amountCNS, 12e6);
        assertEq(q.feeCNS, 120_000);
        uint256 beforeFree = venue.getAccountById(id).balanceCNS;
        E.PositionInfoV2 memory before = _position();
        assertEq(uint256(_topUp()), uint256(SetsunaAccount.Status.Ready));
        assertEq(account.reserveCNS(), 100e6 - q.amountCNS - q.feeCNS);
        assertEq(account.getPolicy(1).usedCNS, q.amountCNS + q.feeCNS);
        assertEq(token.balanceOf(keeper), q.feeCNS);
        assertEq(_position().depositCNS, before.depositCNS + q.amountCNS);
        assertEq(venue.getAccountById(id).balanceCNS, beforeFree);
        assertEq(PerplRisk.equity(_position()), int256(q.targetEquityCNS));
        assertEq(token.allowance(address(account), address(venue)), 0);
        assertEq(uint256(_topUp()), uint256(SetsunaAccount.Status.NotTriggered));
        assertEq(token.balanceOf(keeper), q.feeCNS);
    }

    function testCapCannotPayMarginWhenFeeWouldExceedIt() public {
        _arm();
        vm.prank(trader);
        account.setCap(12e6);
        bytes32 before_ = _stateHash();
        assertEq(uint256(_topUp()), uint256(SetsunaAccount.Status.InsufficientBudget));
        assertEq(_stateHash(), before_);
    }

    function testWithdrawalPreservesSpentBudgetAndRefillDoesNotResetIt() public {
        _arm();
        _topUp();
        uint256 used = account.getPolicy(1).usedCNS;
        vm.startPrank(trader);
        account.withdrawReserve(account.reserveCNS());
        assertEq(account.getPolicy(1).usedCNS, used);
        assertEq(account.getPolicy(1).config.capCNS, 50e6);
        account.fundReserve(100e6);
        vm.stopPrank();
        assertEq(account.getPolicy(1).usedCNS, used);
        assertEq(account.previewTopUp().spendableCNS, 50e6 - used);
        vm.prank(trader);
        vm.expectRevert(SetsunaAccount.InvalidConfiguration.selector);
        account.setCap(used - 1);
    }

    function testRevocationAndRearmingKeepSeparatePolicyHistory() public {
        _arm();
        _topUp();
        uint256 used = account.getPolicy(1).usedCNS;
        vm.startPrank(trader);
        account.revokePolicy();
        account.armPolicy(_config());
        vm.stopPrank();
        assertFalse(account.getPolicy(1).active);
        assertEq(account.getPolicy(1).usedCNS, used);
        assertEq(account.currentPolicyId(), 2);
        assertEq(account.getPolicy(2).usedCNS, 0);
    }

    function testCannotResetAnActivePolicyBudget() public {
        _arm();
        vm.prank(trader);
        vm.expectRevert(SetsunaAccount.PolicyAlreadyActive.selector);
        account.armPolicy(_config());
    }

    function testTradingDepositAndWithdrawalLeaveReserveUntouched() public {
        _arm();
        uint256 before_ = account.reserveCNS();
        uint256 freeBefore = venue.getAccountById(id).balanceCNS;
        vm.startPrank(trader);
        account.depositTrading(20e6);
        account.withdrawTrading(10e6);
        vm.stopPrank();
        assertEq(account.reserveCNS(), before_);
        assertEq(token.balanceOf(address(account)), before_);
        assertEq(venue.getAccountById(id).balanceCNS, freeBefore + 10e6);
        assertTrue(account.getPolicy(1).active);
    }

    function testSameBlockSameSideSameSizeReopenDoesNotReusePolicy() public {
        _arm();
        uint256 oldEntryBlock = _position().entryBlock;
        vm.startPrank(trader);
        account.executeOrder(_order(2));
        account.executeOrder(_order(0));
        vm.stopPrank();
        assertEq(_position().entryBlock, oldEntryBlock);
        assertEq(_position().lotLNS, 1000);
        assertEq(uint256(_topUp()), uint256(SetsunaAccount.Status.Inactive));
    }

    function testSnapshotIncludesEntryPriceResidue() public {
        _arm();
        E.PositionInfoV2 memory p = _position();
        ++p.priceResiduePNSQ16;
        venue.setPosition(id, p);
        assertEq(uint256(_topUp()), uint256(SetsunaAccount.Status.BindingChanged));
    }

    function testVenuePartialDeleverageFailsBinding() public {
        _arm();
        E.PositionInfoV2 memory p = _position();
        --p.lotLNS;
        venue.setPosition(id, p);
        assertEq(uint256(_topUp()), uint256(SetsunaAccount.Status.BindingChanged));
    }

    function testVenueLiquidationRefusesWithoutTouchingReserve() public {
        _arm();
        E.PositionInfoV2 memory p;
        venue.setPosition(id, p);
        bytes32 before_ = _stateHash();
        assertEq(uint256(_topUp()), uint256(SetsunaAccount.Status.NoPosition));
        assertEq(_stateHash(), before_);
    }

    function testNoOutstandingOrdersAtArmOrRescue() public {
        venue.setLocks(1);
        vm.prank(trader);
        vm.expectRevert(
            abi.encodeWithSelector(SetsunaAccount.CannotArm.selector, SetsunaAccount.Status.OutstandingOrders)
        );
        account.armPolicy(_config());
        venue.setLocks(0);
        _arm();
        venue.setLocks(1);
        assertEq(uint256(_topUp()), uint256(SetsunaAccount.Status.OutstandingOrders));
    }

    function testRestingTriggerAndWrongMarketOrdersRejected() public {
        _arm();
        E.OrderDesc memory o = _order(0);
        o.immediateOrCancel = false;
        vm.startPrank(trader);
        vm.expectRevert(SetsunaAccount.UnsupportedOrder.selector);
        account.executeOrder(o);
        o.immediateOrCancel = true;
        o.orderType = 5;
        vm.expectRevert(SetsunaAccount.UnsupportedOrder.selector);
        account.executeOrder(o);
        o.orderType = 0;
        o.perpId = 2;
        vm.expectRevert(SetsunaAccount.UnsupportedOrder.selector);
        account.executeOrder(o);
        vm.stopPrank();
        assertTrue(account.getPolicy(1).active);
    }

    function testUnauthorizedCallsCannotSpendReserveOrChangePolicy() public {
        vm.startPrank(keeper);
        vm.expectRevert(SetsunaAccount.Unauthorized.selector);
        account.withdrawReserve(1);
        vm.expectRevert(SetsunaAccount.Unauthorized.selector);
        account.executeOrder(_order(0));
        vm.expectRevert(SetsunaAccount.Unauthorized.selector);
        account.armPolicy(_config());
        vm.expectRevert(SetsunaAccount.Unauthorized.selector);
        account.setCap(1);
        vm.expectRevert(SetsunaAccount.Unauthorized.selector);
        account.revokePolicy();
        vm.expectRevert(SetsunaAccount.Unauthorized.selector);
        account.depositTrading(1);
        vm.expectRevert(SetsunaAccount.Unauthorized.selector);
        account.withdrawTrading(1);
        vm.stopPrank();
    }

    function testStaleInvalidAndFutureMarksRefuseWithoutFees() public {
        _arm();
        venue.setMark(true, block.timestamp - 61);
        assertEq(uint256(_topUp()), uint256(SetsunaAccount.Status.StaleMark));
        venue.setMark(true, block.timestamp + 1);
        assertEq(uint256(_topUp()), uint256(SetsunaAccount.Status.StaleMark));
        venue.setMark(false, block.timestamp);
        assertEq(uint256(_topUp()), uint256(SetsunaAccount.Status.InvalidMark));
        assertEq(token.balanceOf(keeper), 0);
        assertEq(account.getPolicy(1).usedCNS, 0);
    }

    function testFrozenAccountRefuses() public {
        _arm();
        venue.setFrozen(id, 1);
        assertEq(uint256(_topUp()), uint256(SetsunaAccount.Status.VenueUnavailable));
    }

    function testFundingCountedExactlyOnce() public {
        _arm();
        venue.setPnl(id, -30e6, -2e6);
        assertEq(account.previewTopUp().equityCNS, 48e6);
        assertEq(account.previewTopUp().amountCNS, 12e6);
    }

    function testRepeatedRescuesExhaustTheSameCumulativeBudget() public {
        _arm();
        _topUp();
        venue.setPnl(id, -50e6, 0);
        assertEq(uint256(_topUp()), uint256(SetsunaAccount.Status.Ready));
        assertEq(account.getPolicy(1).usedCNS, 30_300_000);
        venue.setPnl(id, -70e6, 0);
        assertEq(uint256(_topUp()), uint256(SetsunaAccount.Status.InsufficientBudget));
        assertEq(account.getPolicy(1).usedCNS, 30_300_000);
        vm.prank(trader);
        account.setCap(55e6);
        assertEq(uint256(_topUp()), uint256(SetsunaAccount.Status.Ready));
        assertEq(account.getPolicy(1).usedCNS, 50_500_000);
    }

    function testConfiguredFeeCeilingLimitsActualPayout() public {
        SetsunaAccount.PolicyConfig memory c = _config();
        c.feeBps = 1000;
        c.feeMaxCNS = 5000;
        vm.prank(trader);
        account.armPolicy(c);
        _topUp();
        assertEq(token.balanceOf(keeper), 5000);
        assertEq(account.getPolicy(1).usedCNS, 12_005_000);
    }

    function testMinimumTopUpRefusesInsteadOfIncreasingSpend() public {
        SetsunaAccount.PolicyConfig memory c = _config();
        c.minTopUpCNS = 20e6;
        vm.prank(trader);
        account.armPolicy(c);
        bytes32 before_ = _stateHash();
        assertEq(uint256(_topUp()), uint256(SetsunaAccount.Status.BelowMinimum));
        assertEq(_stateHash(), before_);
    }

    function testNoPartialTopUpWhenReserveIsInsufficient() public {
        _arm();
        vm.prank(trader);
        account.withdrawReserve(99e6);
        bytes32 before_ = _stateHash();
        assertEq(uint256(_topUp()), uint256(SetsunaAccount.Status.InsufficientBudget));
        assertEq(_stateHash(), before_);
    }

    function testInsolventReserveRefuses() public {
        _arm();
        token.burn(address(account), 1);
        assertEq(uint256(_topUp()), uint256(SetsunaAccount.Status.InsolventReserve));
    }

    function testExecutionFailuresRollBackAllBalancesAndPolicy() public {
        _arm();
        for (uint256 mode = 1; mode <= uint256(MockPerpl.Failure.WrongFree); ++mode) {
            venue.setFailure(MockPerpl.Failure(mode));
            bytes32 before_ = _stateHash();
            vm.prank(keeper);
            vm.expectRevert();
            account.topUp();
            assertEq(_stateHash(), before_, "atomic rollback failed");
        }
    }

    function testFeeTransferFailureRollsBackVenueDepositAndCollateral() public {
        _arm();
        token.blockRecipient(keeper);
        bytes32 before_ = _stateHash();
        vm.prank(keeper);
        vm.expectRevert();
        account.topUp();
        assertEq(_stateHash(), before_);
    }

    function testReentrantRescueCannotDoubleSpend() public {
        _arm();
        venue.setCallback(address(account));
        _topUp();
        assertTrue(venue.callbackRejected());
        assertEq(account.getPolicy(1).usedCNS, 12_120_000);
    }

    function testFuzzCapAndReserveBoundEverySuccessfulRescue(uint256 cap, uint256 reserve) public {
        cap = bound(cap, 1e6, 200e6);
        reserve = bound(reserve, 1, 100e6);
        SetsunaAccount.PolicyConfig memory c = _config();
        c.capCNS = cap;
        vm.startPrank(trader);
        account.armPolicy(c);
        if (reserve < 100e6) {
            account.withdrawReserve(100e6 - reserve);
        }
        vm.stopPrank();
        SetsunaAccount.Status status = _topUp();
        uint256 used = account.getPolicy(1).usedCNS;
        assertLe(used, cap);
        assertLe(used, reserve);
        assertEq(account.reserveCNS() + used, reserve);
        assertEq(token.balanceOf(address(account)), account.reserveCNS());
        if (status != SetsunaAccount.Status.Ready) {
            assertEq(used, 0);
            assertEq(token.balanceOf(keeper), 0);
        }
    }
}
