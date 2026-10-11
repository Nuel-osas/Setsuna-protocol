// SPDX-License-Identifier: MIT
pragma solidity 0.8.30;

import {Test} from "forge-std/Test.sol";
import {IERC20} from "@openzeppelin/contracts/token/ERC20/IERC20.sol";
import {SetsunaUSDCVault} from "../src/earn/SetsunaUSDCVault.sol";
import {SetsunaPerformanceFee} from "../src/earn/SetsunaPerformanceFee.sol";
import {ILendingAdapterV2} from "../src/earn/ILendingAdapterV2.sol";
import {SetsunaSpot} from "../src/spot/SetsunaSpot.sol";
import {SetsunaAccount} from "../src/SetsunaAccount.sol";
import {SetsunaFactory} from "../src/SetsunaFactory.sol";
import {IPerplExchange as E} from "../src/interfaces/IPerplExchange.sol";
import {EarnMockUSDC, EarnMockAdapter} from "./EarnMocks.sol";
import {SpotToken, SpotMarketMock} from "./SetsunaSpot.t.sol";
import {MockAUSD, MockPerpl} from "./Mocks.sol";

/// Earn: 2% of yield only, high-water mark, previews include owed fees.
contract SetsunaEarnFeeTest is Test {
    EarnMockUSDC token;
    SetsunaUSDCVault vault;
    address treasury = address(0x7EA5);
    address alice = address(0xA11CE);
    address bob = address(0xB0B);

    function setUp() public {
        vm.warp(1_000_000);
        token = new EarnMockUSDC();
        vault = new SetsunaUSDCVault(token, address(this), 25_000e6, 250_000e6, treasury, 200);
        ILendingAdapterV2[] memory list = new ILendingAdapterV2[](2);
        for (uint256 i; i < 2; ++i) {
            list[i] = ILendingAdapterV2(address(new EarnMockAdapter(token, address(vault), 0.05e18)));
        }
        vault.initialize(list);
        for (uint256 i; i < 2; ++i) {
            address who = i == 0 ? alice : bob;
            token.mint(who, 10_000e6);
            vm.prank(who);
            token.approve(address(vault), type(uint256).max);
        }
        vm.prank(alice);
        vault.deposit(1_000e6, alice);
    }

    function _treasuryAssets() internal view returns (uint256) {
        return vault.convertToAssets(vault.balanceOf(treasury));
    }

    function testFeeIsTwoPercentOfYieldOnly() public {
        assertEq(vault.balanceOf(treasury), 0, "no fee on a deposit");
        token.mint(address(vault), 100e6); // 100 USDC of yield
        vault.sync();
        assertApproxEqAbs(_treasuryAssets(), 2e6, 2, "2% of the 100 USDC gain");
        assertApproxEqAbs(vault.convertToAssets(vault.balanceOf(alice)), 1_098e6, 2, "depositor keeps 98%");
        vault.sync();
        assertApproxEqAbs(_treasuryAssets(), 2e6, 2, "no second charge on the same gain");
    }

    function testNoFeeOnPrincipalMovements() public {
        vm.prank(bob);
        vault.deposit(500e6, bob);
        vm.startPrank(alice);
        vault.redeem(vault.balanceOf(alice) / 2, alice, alice);
        vault.deposit(200e6, alice);
        vm.stopPrank();
        vm.prank(bob);
        vault.withdraw(100e6, bob, bob);
        vault.sync();
        assertEq(vault.balanceOf(treasury), 0, "deposits and withdrawals are never yield");
    }

    function testPreviewsIncludeOwedFee() public {
        token.mint(address(vault), 50e6); // yield not yet accrued on-chain
        uint256 previewShares = vault.previewDeposit(100e6);
        vm.prank(bob);
        uint256 shares = vault.deposit(100e6, bob);
        assertEq(shares, previewShares, "deposit matches its preview");
        uint256 aliceShares = vault.balanceOf(alice);
        uint256 previewAssets = vault.previewRedeem(aliceShares);
        vm.prank(alice);
        assertEq(vault.redeem(aliceShares, alice, alice), previewAssets, "redeem matches its preview");
    }

    function testLossIsNotChargedAgainWhileRecovering() public {
        token.mint(address(vault), 100e6);
        vault.sync();
        uint256 afterFirst = vault.balanceOf(treasury);
        token.burn(address(vault), 60e6); // loss
        vault.sync();
        token.mint(address(vault), 60e6); // recovery back to the previous peak
        vault.sync();
        assertEq(vault.balanceOf(treasury), afterFirst, "recovery is not charged");
        token.mint(address(vault), 10e6); // new gain above the peak
        vault.sync();
        uint256 minted = vault.balanceOf(treasury) - afterFirst;
        assertGt(minted, 0, "new gains above the peak are charged");
        // The treasury's earlier shares also earn on this gain; only the new shares are fee.
        assertApproxEqAbs(vault.convertToAssets(minted), 0.2e6, 2, "2% of the 10 USDC above the peak");
    }

    function testFeeConfigurationIsBounded() public {
        vm.expectRevert(SetsunaPerformanceFee.InvalidFeeConfiguration.selector);
        new SetsunaUSDCVault(token, address(this), 25_000e6, 250_000e6, treasury, 2_001);
        vm.expectRevert(SetsunaPerformanceFee.InvalidFeeConfiguration.selector);
        new SetsunaUSDCVault(token, address(this), 25_000e6, 250_000e6, address(0), 200);
        assertEq(vault.feeRecipient(), treasury);
        assertEq(vault.performanceFeeBps(), 200);
    }
}

/// Spot: 0.10% of output to the treasury; minOut bounds the net amount.
contract SetsunaSpotFeeTest is Test {
    SpotToken token;
    SpotMarketMock market;
    SetsunaSpot spot;
    address treasury = address(0x7EA5);

    function setUp() public {
        token = new SpotToken();
        market = new SpotMarketMock(token);
        spot = new SetsunaSpot(market, token, treasury, 10);
        token.mint(address(this), 10e6);
        token.mint(address(market), 100e6);
        token.approve(address(spot), 10e6);
        vm.deal(address(this), 10 ether);
        vm.deal(address(market), 10 ether);
    }

    receive() external payable {}

    function testSellChargesFeeOnUSDCOutput() public {
        uint256 out = spot.sellMON{value: 1 ether}(999_000, block.timestamp);
        assertEq(out, 999_000);
        assertEq(token.balanceOf(treasury), 1_000);
        assertEq(token.balanceOf(address(spot)), 0);
    }

    function testBuyChargesFeeOnMONOutput() public {
        uint256 out = spot.buyMON(1e6, 0.999 ether, block.timestamp);
        assertEq(out, 0.999 ether);
        assertEq(treasury.balance, 0.001 ether);
        assertEq(address(spot).balance, 0);
    }

    function testMinOutIsTheAmountAfterTheFee() public {
        vm.expectRevert(SetsunaSpot.UnexpectedDelta.selector);
        spot.sellMON{value: 1 ether}(999_001, block.timestamp);
    }

    function testFeeIsCapped() public {
        vm.expectRevert(SetsunaSpot.InvalidAmount.selector);
        new SetsunaSpot(market, token, treasury, 101);
        vm.expectRevert(SetsunaSpot.InvalidAmount.selector);
        new SetsunaSpot(market, token, address(0), 10);
    }
}

/// Perps: 1% of each top-up to the treasury, inside the user's cap.
contract SetsunaPerpsFeeTest is Test {
    MockAUSD token;
    MockPerpl venue;
    SetsunaAccount account;
    address trader = makeAddr("trader");
    address keeper = makeAddr("keeper");
    address treasury = address(0x7EA5);
    uint256 id;

    function setUp() public {
        vm.warp(1_790_597_873);
        vm.roll(108_749_101);
        token = new MockAUSD();
        venue = new MockPerpl(token);
        SetsunaFactory factory = new SetsunaFactory(E(address(venue)), IERC20(address(token)), 1, treasury, 100);
        vm.prank(trader);
        account = SetsunaAccount(factory.createAccount());
        token.mint(trader, 10_000e6);
        vm.startPrank(trader);
        token.approve(address(account), type(uint256).max);
        account.initialize(1_000e6);
        account.fundReserve(100e6);
        E.OrderDesc memory o;
        o.perpId = 1;
        o.lotLNS = 1000;
        o.pricePNS = 1_000_000;
        o.immediateOrCancel = true;
        o.leverageHdths = 1000;
        account.executeOrder(o);
        account.armPolicy(
            SetsunaAccount.PolicyConfig({
                capCNS: 50e6,
                minTopUpCNS: 1e6,
                feeMaxCNS: 1e6,
                triggerBufferBps: 2500,
                targetBufferBps: 5000,
                feeBps: 100,
                maxMarkAgeSec: 60
            })
        );
        vm.stopPrank();
        id = account.accountId();
        venue.setPnl(id, -32e6, 0); // equity 48, target 60: a 12 AUSD top-up
    }

    function testTopUpPaysProtocolFeeInsideTheCap() public {
        SetsunaAccount.Quote memory q = account.previewTopUp();
        assertEq(q.amountCNS, 12e6);
        assertEq(q.protocolFeeCNS, 120_000, "1% of the top-up");
        vm.prank(keeper);
        assertEq(uint256(account.topUp()), uint256(SetsunaAccount.Status.Ready));
        assertEq(token.balanceOf(treasury), 120_000);
        assertEq(token.balanceOf(keeper), q.feeCNS);
        uint256 spent = q.amountCNS + q.feeCNS + q.protocolFeeCNS;
        assertEq(account.getPolicy(1).usedCNS, spent);
        assertEq(account.reserveCNS(), 100e6 - spent);
    }

    function testCapRefusesWhenProtocolFeeWouldExceedIt() public {
        vm.prank(trader);
        account.setCap(12e6 + 120_000); // margin + keeper fee, but no room for the protocol fee
        vm.prank(keeper);
        assertEq(uint256(account.topUp()), uint256(SetsunaAccount.Status.InsufficientBudget));
        assertEq(token.balanceOf(treasury), 0);
    }
}
