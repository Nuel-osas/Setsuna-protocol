// SPDX-License-Identifier: MIT
pragma solidity 0.8.30;
import {Test} from "forge-std/Test.sol";
import {IERC20} from "@openzeppelin/contracts/token/ERC20/IERC20.sol";
import {IPerplExchange as E} from "../src/interfaces/IPerplExchange.sol";
import {SetsunaFactory} from "../src/SetsunaFactory.sol";
import {SetsunaAccount} from "../src/SetsunaAccount.sol";

/// @dev Actual pinned Perpl state, with NO mark/oracle configuration changes.
contract SetsunaTradingForkTest is Test {
    E constant VENUE = E(0x34B6552d57a35a1D042CcAe1951BD1C370112a6F);
    IERC20 constant AUSD = IERC20(0x00000000eFE302BEAA2b3e6e1b18d08D69a9012a);
    SetsunaAccount account;

    function setUp() public {
        vm.skip(!vm.envOr("RUN_FORK", false));
        vm.createSelectFork(vm.envOr("MONAD_RPC_URL", string("https://rpc.monad.xyz")), 110_418_863);
        account = SetsunaAccount(new SetsunaFactory(VENUE, AUSD, 1).createAccount());
        vm.record(); AUSD.balanceOf(address(this));
        (bytes32[] memory slots,) = vm.accesses(address(AUSD));
        bytes32 slot = slots[slots.length - 1];
        vm.store(address(AUSD), slot, bytes32((uint256(10_000e6) << 8) | (uint256(vm.load(address(AUSD), slot)) & 0xff)));
        assertEq(AUSD.balanceOf(address(this)), 10_000e6);
        AUSD.approve(address(account), 1_200e6);
        account.initialize(1_000e6);
        account.fundReserve(200e6);
    }

    function _order(uint8 kind) internal view returns (E.OrderDesc memory o) {
        E.PerpetualInfo memory m = VENUE.getPerpetualInfo(1);
        o.perpId = 1; o.orderType = kind; o.lotLNS = 100; // 0.001 BTC
        bool buying = kind == 0 || kind == 3;
        o.pricePNS = buying ? m.basePricePNS + m.minAskPriceONS + 1_000 : m.basePricePNS + m.maxBidPriceONS - 1_000;
        o.fillOrKill = true; o.maxMatches = 30; o.leverageHdths = 1_000; o.maxNegPnlCollatBPS = 100;
    }

    function _position() internal view returns (E.PositionInfoV2 memory p) {
        (p,,) = VENUE.getPositionV2(1, account.accountId());
    }

    function _roundTrip(uint8 open, uint8 close) internal {
        account.executeOrder(_order(open));
        assertEq(_position().lotLNS, 100, "actual fill required");
        assertEq(_position().positionType, open);
        account.armPolicy(SetsunaAccount.PolicyConfig({ capCNS: 50e6, minTopUpCNS: 1e6, feeMaxCNS: 1e6,
            triggerBufferBps: 3_000, targetBufferBps: 7_000, feeBps: 100, maxMarkAgeSec: 60 }));
        account.executeOrder(_order(close));
        assertEq(_position().lotLNS, 0, "must close fully");
        assertFalse(account.getPolicy(account.currentPolicyId()).active);
        assertEq(account.reserveCNS(), 200e6, "trades must not spend reserve");
        assertEq(VENUE.getOrderLocks(account.accountId()).length, 0);
        uint256 before = AUSD.balanceOf(address(this));
        account.withdrawTrading(100e6);
        account.withdrawReserve(200e6);
        assertEq(AUSD.balanceOf(address(this)), before + 300e6);
        assertEq(AUSD.balanceOf(address(account)), 0);
        assertEq(AUSD.allowance(address(account), address(VENUE)), 0);
    }

    function testFork_TradingLongOpenCloseWithdraw() public { _roundTrip(0, 2); }
    function testFork_TradingShortOpenCloseWithdraw() public { _roundTrip(1, 3); }

    function testFork_NonCrossingFillOrKillDoesNotCreateAPosition() public {
        E.OrderDesc memory o = _order(0);
        o.pricePNS = 1;
        uint256 before = VENUE.getAccountById(account.accountId()).balanceCNS;
        // Perpl can refuse a fill without reverting the outer transaction.
        (bool ok,) = address(account).call(abi.encodeCall(account.executeOrder, (o)));
        ok;
        assertEq(_position().lotLNS, 0);
        assertEq(VENUE.getAccountById(account.accountId()).balanceCNS, before);
        assertEq(account.reserveCNS(), 200e6);
    }
}
