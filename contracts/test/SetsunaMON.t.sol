// SPDX-License-Identifier: MIT
pragma solidity 0.8.30;

import {Test} from "forge-std/Test.sol";
import {SetsunaEarnCore} from "../src/earn/SetsunaEarnCore.sol";
import {SetsunaMONVault} from "../src/earn/SetsunaMONVault.sol";
import {SetsunaMONGateway} from "../src/earn/SetsunaMONGateway.sol";
import {ILendingAdapter} from "../src/earn/ILendingAdapter.sol";
import {EarnMockUSDC, EarnMockAdapter} from "./EarnMocks.sol";

contract MockWrappedMON is EarnMockUSDC {
    function decimals() public pure override returns (uint8) {
        return 18;
    }

    function deposit() external payable {
        _mint(msg.sender, msg.value);
    }

    function withdraw(uint256 assets) external {
        _burn(msg.sender, assets);
        (bool ok,) = msg.sender.call{value: assets}("");
        require(ok);
    }
}

contract NativeRecipient {
    bool public reject;
    bool public attacked;
    bool public reentered;
    SetsunaMONGateway public gateway;

    constructor(SetsunaMONGateway g, bool reject_) {
        gateway = g;
        reject = reject_;
    }

    receive() external payable {
        require(!reject);
        attacked = true;
        (reentered,) = address(gateway).call{value: 1}(
            abi.encodeCall(gateway.depositMON, (address(this), 0, block.timestamp))
        );
    }
}

contract SetsunaMONTest is Test {
    MockWrappedMON token;
    SetsunaMONVault vault;
    SetsunaMONGateway gateway;
    EarnMockAdapter a;
    EarnMockAdapter b;
    address alice = address(0xA11CE);
    address bob = address(0xB0B);

    function setUp() public {
        vm.warp(1_000_000);
        token = new MockWrappedMON();
        vault = new SetsunaMONVault(token, address(this), 25_000 ether, 250_000 ether);
        a = new EarnMockAdapter(token, address(vault), 0.04e18);
        b = new EarnMockAdapter(token, address(vault), 0.08e18);
        a.setSize(1_000_000 ether);
        b.setSize(1_000_000 ether);
        vault.initialize([ILendingAdapter(address(a)), ILendingAdapter(address(b))]);
        gateway = new SetsunaMONGateway(vault);
        vm.deal(alice, 30_000 ether);
        vm.deal(bob, 30_000 ether);
    }

    function _deposit(uint256 amount) internal returns (uint256 shares) {
        uint256 preview = vault.previewDeposit(amount);
        vm.prank(alice);
        shares = gateway.depositMON{value: amount}(alice, preview, vm.getBlockTimestamp());
    }

    function _redeem(uint256 shares, address payable receiver) internal returns (uint256 assets) {
        vm.startPrank(alice);
        vault.approve(address(gateway), shares);
        assets = gateway.redeemMON(shares, receiver, vault.previewRedeem(shares), vm.getBlockTimestamp());
        vm.stopPrank();
    }

    function _allocate() internal {
        vault.observeRates();
        for (uint256 i; i < 9; ++i) {
            vm.warp(vm.getBlockTimestamp() + 10 minutes);
            vm.roll(vm.getBlockNumber() + 1);
            vault.observeRates();
            vm.roll(vm.getBlockNumber() + 1);
            SetsunaEarnCore.Plan memory p = vault.rebalance();
            assertLe(p.grossMovement, p.nav / 10);
        }
    }

    function testNativeRoundTripAndUnits() public {
        uint256 shares = _deposit(1_000 ether);
        assertEq(shares, 1_000e24);
        assertEq(vault.decimals(), 24);
        assertEq(vault.symbol(), "setsMON");
        assertEq(vault.MIN_ANNUAL_GAIN(), 0.001 ether);
        assertEq(token.allowance(address(gateway), address(vault)), 0);
        _allocate();
        assertEq(a.totalAssets(), 300 ether);
        assertEq(b.totalAssets(), 600 ether);
        assertEq(token.balanceOf(address(vault)), 100 ether);
        assertEq(_redeem(shares, payable(alice)), 1_000 ether);
        assertEq(alice.balance, 30_000 ether);
        assertEq(vault.balanceOf(alice), 0);
        assertEq(address(gateway).balance, 0);
        assertEq(token.balanceOf(address(gateway)), 0);
        assertEq(vault.allowance(alice, address(gateway)), 0);
    }

    function testFuzzNativeRoundTrip(uint96 seed) public {
        uint256 amount = bound(uint256(seed), 1, 25_000 ether);
        uint256 shares = _deposit(amount);
        assertEq(_redeem(shares, payable(alice)), amount);
        assertEq(alice.balance, 30_000 ether);
    }

    function testRejectsWrongDecimals() public {
        EarnMockUSDC usdc = new EarnMockUSDC();
        vm.expectRevert(SetsunaEarnCore.InvalidConfiguration.selector);
        new SetsunaMONVault(usdc, alice, 25_000 ether, 250_000 ether);
    }

    function testUnauthorizedCannotUseAnotherUsersApproval() public {
        uint256 shares = _deposit(100 ether);
        vm.prank(alice);
        vault.approve(address(gateway), shares);
        vm.prank(bob);
        vm.expectRevert();
        gateway.redeemMON(shares, payable(bob), 0, vm.getBlockTimestamp());
        assertEq(vault.balanceOf(alice), shares);
        assertEq(bob.balance, 30_000 ether);
    }

    function testRejectedNativePaymentRollsBackSharesAndVenues() public {
        uint256 shares = _deposit(1_000 ether);
        _allocate();
        NativeRecipient recipient = new NativeRecipient(gateway, true);
        vm.prank(alice);
        vault.approve(address(gateway), shares);
        vm.prank(alice);
        vm.expectRevert(SetsunaMONGateway.NativeTransferFailed.selector);
        gateway.redeemMON(shares, payable(address(recipient)), 0, vm.getBlockTimestamp());
        assertEq(vault.balanceOf(alice), shares);
        assertEq(a.totalAssets(), 300 ether);
        assertEq(b.totalAssets(), 600 ether);
        assertEq(token.balanceOf(address(gateway)), 0);
    }

    function testReceiverCannotReenterGateway() public {
        uint256 shares = _deposit(1 ether);
        NativeRecipient recipient = new NativeRecipient(gateway, false);
        _redeem(shares, payable(address(recipient)));
        assertTrue(recipient.attacked());
        assertFalse(recipient.reentered());
        assertEq(address(recipient).balance, 1 ether);
    }

    function testDeadlinesAndSlippageRestoreNativeBalance() public {
        vm.startPrank(alice);
        vm.expectRevert(SetsunaEarnCore.DeadlineExpired.selector);
        gateway.depositMON{value: 1 ether}(alice, 0, vm.getBlockTimestamp() - 1);
        vm.expectRevert(SetsunaEarnCore.SlippageExceeded.selector);
        gateway.depositMON{value: 1 ether}(alice, 1e24 + 1, vm.getBlockTimestamp());
        vm.stopPrank();
        assertEq(alice.balance, 30_000 ether);
        uint256 shares = _deposit(1 ether);
        vm.startPrank(alice);
        vault.approve(address(gateway), shares);
        vm.expectRevert(SetsunaEarnCore.SlippageExceeded.selector);
        gateway.redeemMON(shares, payable(alice), 1 ether + 1, vm.getBlockTimestamp());
        vm.expectRevert(SetsunaEarnCore.DeadlineExpired.selector);
        gateway.redeemMON(shares, payable(alice), 0, vm.getBlockTimestamp() - 1);
        vm.stopPrank();
        assertEq(vault.balanceOf(alice), shares);
    }

    function testDustCannotBeClaimedByNextDepositor() public {
        vm.deal(address(gateway), 3 ether); // Forced native transfer.
        token.mint(address(gateway), 4 ether);
        _redeem(_deposit(1 ether), payable(alice));
        assertEq(alice.balance, 30_000 ether);
        assertEq(address(gateway).balance, 3 ether);
        assertEq(token.balanceOf(address(gateway)), 4 ether);
    }

    function testDirectNativeTransferRejected() public {
        vm.prank(alice);
        (bool ok,) = address(gateway).call{value: 1 ether}("");
        assertFalse(ok);
        assertEq(alice.balance, 30_000 ether);
    }

    function testBufferRemainsWithdrawableWhenMarketsHaveNoCash() public {
        _deposit(1_000 ether);
        _allocate();
        a.setCashLimit(0);
        b.setCashLimit(0);
        assertEq(vault.maxWithdraw(alice), 100 ether);
        uint256 shares = vault.maxRedeem(alice);
        assertEq(_redeem(shares, payable(alice)), 100 ether);
        assertEq(vault.maxRedeem(alice), 0);
    }

    function testLossReducesClaimInMONAndExitStillWorks() public {
        _deposit(1_000 ether);
        _allocate();
        token.burn(address(a), 30 ether);
        uint256 expected = vault.previewRedeem(vault.balanceOf(alice));
        assertApproxEqAbs(expected, 970 ether, 1);
        assertEq(_redeem(vault.balanceOf(alice), payable(alice)), expected);
    }

    function testPausePreventsNativeDepositsButAllowsExit() public {
        uint256 shares = _deposit(1 ether);
        vault.pauseDeposits();
        vm.prank(bob);
        vm.expectRevert();
        gateway.depositMON{value: 1 ether}(bob, 0, vm.getBlockTimestamp());
        assertEq(_redeem(shares, payable(alice)), 1 ether);
    }
}
