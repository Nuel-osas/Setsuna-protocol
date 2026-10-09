// SPDX-License-Identifier: MIT
pragma solidity 0.8.30;

import {Test} from "forge-std/Test.sol";
import {IERC20} from "@openzeppelin/contracts/token/ERC20/IERC20.sol";
import {SafeERC20} from "@openzeppelin/contracts/token/ERC20/utils/SafeERC20.sol";
import {IPerplExchange} from "../src/interfaces/IPerplExchange.sol";

/// @dev Test-only account probe. Never deploy this unrestricted harness.
contract PerplAccountProbe {
    using SafeERC20 for IERC20;
    IPerplExchange public immutable exchange;
    IERC20 public immutable token;
    uint256 public accountId;

    constructor(IPerplExchange venue, IERC20 collateral) {
        exchange = venue;
        token = collateral;
    }

    function create(uint256 amount) external {
        token.safeTransferFrom(msg.sender, address(this), amount);
        token.forceApprove(address(exchange), amount);
        accountId = exchange.createAccount(amount);
        exchange.allowOrderForwarding(false);
        token.forceApprove(address(exchange), 0);
    }

    function deposit(uint256 amount) external {
        token.safeTransferFrom(msg.sender, address(this), amount);
        token.forceApprove(address(exchange), amount);
        exchange.depositCollateral(amount);
        token.forceApprove(address(exchange), 0);
    }

    function trade(IPerplExchange.OrderDesc memory order) external {
        exchange.execOrder(order);
    }

    function increase(uint256 perpId, uint256 amount) external {
        exchange.increasePositionCollateral(perpId, amount);
    }
}

contract PerplAccountProofTest is Test {
    IPerplExchange constant EXCHANGE = IPerplExchange(0x34B6552d57a35a1D042CcAe1951BD1C370112a6F);
    IERC20 constant AUSD = IERC20(0x00000000eFE302BEAA2b3e6e1b18d08D69a9012a);
    uint256 constant PINNED_BLOCK = 108749101;

    function setUp() public {
        vm.skip(!vm.envOr("RUN_FORK", false));
        vm.createSelectFork(vm.envOr("MONAD_RPC_URL", string("https://rpc.monad.xyz")), PINNED_BLOCK);
    }

    function testFork_G1_ContractCreatesDepositsTradesAndIncreasesCollateral() public {
        PerplAccountProbe probe = new PerplAccountProbe(EXCHANGE, AUSD);
        _dealAUSD(address(this), 100_000e6);
        AUSD.approve(address(probe), type(uint256).max);
        uint256 openingAmount = 1_000e6;
        probe.create(openingAmount);
        uint256 id = probe.accountId();
        assertGt(id, 0);
        assertEq(EXCHANGE.getAccountById(id).accountAddr, address(probe));
        uint256 freeBefore = EXCHANGE.getAccountById(id).balanceCNS;
        probe.deposit(1_000e6);
        assertEq(EXCHANGE.getAccountById(id).balanceCNS, freeBefore + 1_000e6);
        assertEq(AUSD.balanceOf(address(probe)), 0);
        assertEq(AUSD.allowance(address(probe), address(EXCHANGE)), 0);

        IPerplExchange.PerpetualInfo memory perp = EXCHANGE.getPerpetualInfo(1);
        IPerplExchange.OrderDesc memory order;
        order.perpId = 1;
        order.orderType = 0; // OpenLong; pinned SDK types/request.rs.
        order.pricePNS = perp.basePricePNS + perp.minAskPriceONS + 100;
        order.lotLNS = 1_000; // 0.01 BTC at five lot decimals.
        order.immediateOrCancel = true;
        order.maxMatches = 30;
        order.leverageHdths = 1_000; // 10x.
        order.maxNegPnlCollatBPS = 100; // Allow up to 1% of posted collateral for spread/negative PnL.
        probe.trade(order);

        (IPerplExchange.PositionInfoV2 memory before,,) = EXCHANGE.getPositionV2(1, id);
        assertEq(before.accountId, id, "IOC must actually open a position");
        assertGt(before.lotLNS, 0);
        assertEq(EXCHANGE.getOrderLocks(id).length, 0);
        freeBefore = EXCHANGE.getAccountById(id).balanceCNS;
        probe.increase(1, 10e6);
        (IPerplExchange.PositionInfoV2 memory after_,, bool markValid) = EXCHANGE.getPositionV2(1, id);
        assertEq(after_.depositCNS, before.depositCNS + 10e6);
        assertEq(after_.lotLNS, before.lotLNS);
        assertEq(after_.pricePNS, before.pricePNS);
        assertEq(after_.entryBlock, before.entryBlock);
        assertEq(EXCHANGE.getAccountById(id).balanceCNS, freeBefore - 10e6);
        assertTrue(markValid);
        emit log_named_uint("Pinned Monad mainnet block (LOCAL FORK)", PINNED_BLOCK);
        emit log_named_uint("Created contract-owned account", id);
        emit log_named_uint("BTC lots", after_.lotLNS);
        emit log_named_uint("Collateral increased (CNS)", after_.depositCNS - before.depositCNS);
    }

    function _dealAUSD(address to, uint256 amount) internal {
        // Test fixture only: real AUSD stores {uint8 flags; uint248 balance}.
        vm.record();
        AUSD.balanceOf(to);
        (bytes32[] memory slots,) = vm.accesses(address(AUSD));
        bytes32 slot = slots[slots.length - 1];
        uint256 previous = uint256(vm.load(address(AUSD), slot));
        vm.store(address(AUSD), slot, bytes32((amount << 8) | (previous & 0xff)));
        assertEq(AUSD.balanceOf(to), amount);
    }
}
