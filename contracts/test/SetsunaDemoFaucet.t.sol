// SPDX-License-Identifier: MIT
pragma solidity 0.8.30;
import {Test} from "forge-std/Test.sol";
import {SetsunaDemoFaucet} from "../src/demo/SetsunaDemoFaucet.sol";
import {EarnMockUSDC} from "./EarnMocks.sol";

contract RejectDemoMON { receive() external payable { revert(); } }

contract SetsunaDemoFaucetTest is Test {
    SetsunaDemoFaucet faucet;
    EarnMockUSDC usdc;
    EarnMockUSDC ausd;
    address dispatcher = address(0xD15);
    address user = address(0xBEEF);

    function setUp() public {
        vm.chainId(31337);
        faucet = new SetsunaDemoFaucet(dispatcher);
        EarnMockUSDC token = new EarnMockUSDC();
        vm.etch(address(faucet.USDC()), address(token).code);
        vm.etch(address(faucet.AUSD()), address(token).code);
        usdc = EarnMockUSDC(address(faucet.USDC()));
        ausd = EarnMockUSDC(address(faucet.AUSD()));
        usdc.mint(address(faucet), 100_000e6);
        ausd.mint(address(faucet), 100_000e6);
        vm.deal(address(faucet), 10_100 ether);
    }

    function testEmptyWalletGetsAllAssetsAndDuplicateCannotDrainPool() public {
        vm.prank(dispatcher);
        faucet.claim(user);
        assertEq(user.balance, 101 ether);
        assertEq(usdc.balanceOf(user), 1_000e6);
        assertEq(ausd.balanceOf(user), 1_000e6);
        vm.expectRevert(SetsunaDemoFaucet.ClaimUnavailable.selector);
        vm.prank(dispatcher);
        faucet.claim(user);
        vm.warp(faucet.nextClaimAt(user));
        vm.prank(dispatcher);
        faucet.claim(user);
        assertEq(user.balance, 202 ether);
    }

    function testRejectedTransferRollsBackTokensAndClaimQuota() public {
        address recipient = address(new RejectDemoMON());
        vm.expectRevert(SetsunaDemoFaucet.TransferFailed.selector);
        vm.prank(dispatcher);
        faucet.claim(recipient);
        assertEq(faucet.claims(), 0);
        assertEq(faucet.nextClaimAt(recipient), 0);
        assertEq(usdc.balanceOf(recipient), 0);
        assertEq(ausd.balanceOf(recipient), 0);
    }

    function testExhaustedTokenPoolDoesNotPartiallyFundRecipient() public {
        ausd.burn(address(faucet), ausd.balanceOf(address(faucet)));
        vm.expectRevert();
        vm.prank(dispatcher);
        faucet.claim(user);
        assertEq(usdc.balanceOf(user), 0);
        assertEq(user.balance, 0);
        assertEq(faucet.claims(), 0);
    }

    function testGlobalBudgetCannotBeBypassedByManyAddresses() public {
        for (uint160 i = 1; i <= 100; ++i) {
            vm.prank(dispatcher);
            faucet.claim(address(i + 10000));
        }
        vm.deal(address(faucet), 101 ether);
        usdc.mint(address(faucet), 1_000e6);
        ausd.mint(address(faucet), 1_000e6);
        vm.expectRevert(SetsunaDemoFaucet.ClaimUnavailable.selector);
        vm.prank(dispatcher);
        faucet.claim(user);
    }

    function testRejectsWrongChainAtDeploymentAndClaim() public {
        vm.chainId(143);
        vm.expectRevert(SetsunaDemoFaucet.WrongChain.selector);
        new SetsunaDemoFaucet(dispatcher);
        vm.expectRevert(SetsunaDemoFaucet.WrongChain.selector);
        vm.prank(dispatcher);
        faucet.claim(user);
    }

    function testOnlyDispatcherAndValidRecipient() public {
        vm.expectRevert(SetsunaDemoFaucet.Unauthorized.selector);
        faucet.claim(user);
        vm.expectRevert(SetsunaDemoFaucet.InvalidRecipient.selector);
        vm.prank(dispatcher);
        faucet.claim(address(0));
        vm.expectRevert(SetsunaDemoFaucet.InvalidRecipient.selector);
        vm.prank(dispatcher);
        faucet.claim(address(faucet));
    }
}
