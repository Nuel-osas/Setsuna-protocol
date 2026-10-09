// SPDX-License-Identifier: MIT
pragma solidity 0.8.30;

import {Test} from "forge-std/Test.sol";
import {IERC20} from "@openzeppelin/contracts/token/ERC20/IERC20.sol";
import {SetsunaSpot, IKuruSpotMarket} from "../src/spot/SetsunaSpot.sol";

contract SetsunaSpotForkTest is Test {
    IKuruSpotMarket constant MARKET = IKuruSpotMarket(0x065C9d28E428A0db40191a54d33d5b7c71a9C394);
    IERC20 constant USDC = IERC20(0x754704Bc059F8C67012fEd69BC8A327a5aafb603);
    SetsunaSpot spot;

    function setUp() public {
        vm.skip(!vm.envOr("RUN_FORK", false));
        vm.createSelectFork(vm.envOr("MONAD_RPC_URL", string("https://rpc.monad.xyz")), 110_418_863);
        spot = new SetsunaSpot(MARKET, USDC);
        vm.deal(address(this), 1_000 ether);
    }
    receive() external payable {}

    function testFork_SpotRoundTripUsesActualKuruBalancesAndClearsApprovals() public {
        uint256 beforeUSDC = USDC.balanceOf(address(this));
        uint256 out = spot.sellMON{value: 100 ether}(3e6, block.timestamp + 60);
        assertEq(USDC.balanceOf(address(this)), beforeUSDC + out);
        assertGt(out, 3e6);
        USDC.approve(address(spot), out);
        uint256 beforeMON = address(this).balance;
        uint256 monOut = spot.buyMON(out, 90 ether, block.timestamp + 60);
        assertEq(address(this).balance, beforeMON + monOut);
        assertEq(USDC.balanceOf(address(this)), beforeUSDC);
        assertEq(USDC.balanceOf(address(spot)), 0);
        assertEq(address(spot).balance, 0);
        assertEq(USDC.allowance(address(spot), address(MARKET)), 0);
        assertEq(USDC.allowance(address(this), address(spot)), 0);
        emit log_named_uint("USDC received for 100 MON", out);
        emit log_named_uint("MON received on return swap", monOut);
    }

    function testFork_SpotRejectsSlippageAtomically() public {
        uint256 beforeMON = address(this).balance;
        uint256 beforeUSDC = USDC.balanceOf(address(this));
        vm.expectRevert();
        spot.sellMON{value: 100 ether}(1_000e6, block.timestamp + 60);
        assertEq(address(this).balance, beforeMON);
        assertEq(USDC.balanceOf(address(this)), beforeUSDC);
    }

    function testFork_SpotRejectsDeadlineAndPrecisionDust() public {
        vm.expectRevert(SetsunaSpot.Expired.selector);
        spot.sellMON{value: 1 ether}(1, block.timestamp - 1);
        vm.expectRevert(SetsunaSpot.InvalidAmount.selector);
        spot.sellMON{value: 1 ether + 1}(1, block.timestamp + 60);
        vm.expectRevert(SetsunaSpot.InvalidAmount.selector);
        spot.sellMON{value: 1 ether}(0, block.timestamp + 60);
    }

    function testFork_SpotCannotSpendAnotherUsersApproval() public {
        uint256 out = spot.sellMON{value: 100 ether}(1, block.timestamp + 60);
        USDC.approve(address(spot), out);
        vm.prank(makeAddr("stranger"));
        vm.expectRevert();
        spot.buyMON(out, 1, block.timestamp + 60);
        assertEq(USDC.balanceOf(address(this)), out);
    }

    function testFork_EmptyAUSDMarketDoesNotBecomeASuccessfulSwap() public {
        SetsunaSpot empty = new SetsunaSpot(
            IKuruSpotMarket(0x131A2e70A5b31a517A74b8c567149bc294470Da9),
            IERC20(0x00000000eFE302BEAA2b3e6e1b18d08D69a9012a)
        );
        vm.expectRevert();
        empty.sellMON{value: 100 ether}(1, block.timestamp + 60);
    }
}
