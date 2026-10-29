// SPDX-License-Identifier: MIT
pragma solidity 0.8.30;

import {Test} from "forge-std/Test.sol";
import {IERC20} from "@openzeppelin/contracts/token/ERC20/IERC20.sol";
import {SetsunaAUSDWrapper} from "../src/earn/SetsunaAUSDWrapper.sol";
import {SetsunaAUSDSaver} from "../src/earn/SetsunaAUSDSaver.sol";

interface IAUSDDomain {
    function DOMAIN_SEPARATOR() external view returns (bytes32);
}

/// The relayer path against the live setsAUSD on a mainnet fork: the saver only signs.
contract SetsunaAUSDSaverForkTest is Test {
    IERC20 constant AUSD = IERC20(0x00000000eFE302BEAA2b3e6e1b18d08D69a9012a);
    SetsunaAUSDWrapper constant WRAPPER = SetsunaAUSDWrapper(0x551903E3687820A733FBe406DD33Fee8D12bd2F3);
    address constant AUSD_HOLDER = 0xf33286E3222D1c829dACeac48c0Ec651F6452470;
    bytes32 constant RECEIVE_TYPEHASH = keccak256(
        "ReceiveWithAuthorization(address from,address to,uint256 value,uint256 validAfter,uint256 validBefore,bytes32 nonce)"
    );
    bytes32 constant PERMIT_TYPEHASH =
        keccak256("Permit(address owner,address spender,uint256 value,uint256 nonce,uint256 deadline)");

    SetsunaAUSDSaver saver;
    uint256 aliceKey = 0xA11CE;
    address alice;
    address relayer = address(0xBEEF);
    address thief = address(0xBAD);

    function setUp() public {
        vm.skip(!vm.envOr("RUN_FORK", false));
        vm.createSelectFork(vm.envOr("MONAD_RPC_URL", string("https://rpc2.monad.xyz")));
        saver = new SetsunaAUSDSaver(WRAPPER);
        alice = vm.addr(aliceKey);
        vm.prank(AUSD_HOLDER);
        AUSD.transfer(alice, 50e6);
    }

    function signSave(uint256 value, bytes32 nonce) internal view returns (uint8 v, bytes32 r, bytes32 s) {
        bytes32 h = keccak256(abi.encode(RECEIVE_TYPEHASH, alice, address(saver), value, 0, block.timestamp + 600, nonce));
        return vm.sign(aliceKey, keccak256(abi.encodePacked("\x19\x01", IAUSDDomain(address(AUSD)).DOMAIN_SEPARATOR(), h)));
    }

    function signPermit(uint256 shares) internal view returns (uint8 v, bytes32 r, bytes32 s) {
        bytes32 h = keccak256(
            abi.encode(PERMIT_TYPEHASH, alice, address(saver), shares, WRAPPER.nonces(alice), block.timestamp + 600)
        );
        return vm.sign(aliceKey, keccak256(abi.encodePacked("\x19\x01", WRAPPER.DOMAIN_SEPARATOR(), h)));
    }

    function save(uint256 value, bytes32 nonce, uint256 minShares) internal returns (uint256) {
        (uint8 v, bytes32 r, bytes32 s) = signSave(value, nonce);
        vm.prank(relayer);
        return saver.save(alice, value, 0, block.timestamp + 600, nonce, v, r, s, minShares);
    }

    function testRelayerSavesAndWithdrawsWhileTheSaverOnlySigns() public {
        assertEq(alice.balance, 0);
        uint256 preview = WRAPPER.previewDeposit(20e6);
        uint256 shares = save(20e6, keccak256("n1"), preview);
        assertEq(WRAPPER.balanceOf(alice), shares);
        assertEq(AUSD.balanceOf(alice), 30e6);
        assertEq(AUSD.balanceOf(address(saver)), 0);

        uint256 quote = WRAPPER.previewRedeem(shares);
        (uint8 v, bytes32 r, bytes32 s) = signPermit(shares);
        vm.prank(relayer);
        uint256 back = saver.withdraw(alice, shares, block.timestamp + 600, v, r, s, quote);
        assertEq(back, quote);
        assertEq(AUSD.balanceOf(alice), 30e6 + back);
        assertGe(back, 19.98e6);
        assertEq(WRAPPER.balanceOf(alice), 0);
        assertEq(WRAPPER.balanceOf(address(saver)), 0);
        assertEq(AUSD.balanceOf(relayer), 0);
        assertEq(alice.balance, 0);
    }

    function testSignaturesCannotBeReplayedOrRedirected() public {
        bytes32 nonce = keccak256("n2");
        (uint8 v, bytes32 r, bytes32 s) = signSave(10e6, nonce);
        // Someone else as owner, or a different amount, breaks the signature.
        vm.expectRevert();
        saver.save(thief, 10e6, 0, block.timestamp + 600, nonce, v, r, s, 0);
        vm.expectRevert();
        saver.save(alice, 11e6, 0, block.timestamp + 600, nonce, v, r, s, 0);
        saver.save(alice, 10e6, 0, block.timestamp + 600, nonce, v, r, s, 0);
        vm.expectRevert();
        saver.save(alice, 10e6, 0, block.timestamp + 600, nonce, v, r, s, 0);
        assertEq(WRAPPER.balanceOf(thief), 0);
    }

    function testWithdrawalNeedsTheOwnersPermitAndPaysOnlyTheOwner() public {
        uint256 shares = save(10e6, keccak256("n3"), 0);
        // No permit: nothing moves.
        vm.prank(thief);
        vm.expectRevert();
        saver.withdraw(alice, shares, block.timestamp + 600, 27, bytes32(0), bytes32(0), 0);
        // A real permit submitted by anyone still pays Alice, never the submitter.
        (uint8 v, bytes32 r, bytes32 s) = signPermit(shares);
        vm.prank(thief);
        saver.withdraw(alice, shares, block.timestamp + 600, v, r, s, 0);
        assertEq(AUSD.balanceOf(thief), 0);
        assertGe(AUSD.balanceOf(alice), 49.98e6);
    }

    function testAFrontRunPermitStillCompletes() public {
        uint256 shares = save(10e6, keccak256("n4"), 0);
        (uint8 v, bytes32 r, bytes32 s) = signPermit(shares);
        WRAPPER.permit(alice, address(saver), shares, block.timestamp + 600, v, r, s); // front-run
        vm.prank(relayer);
        saver.withdraw(alice, shares, block.timestamp + 600, v, r, s, 0);
        assertEq(WRAPPER.balanceOf(alice), 0);
    }

    function testMinimumsBindTheRelayer() public {
        uint256 preview = WRAPPER.previewDeposit(10e6);
        (uint8 v, bytes32 r, bytes32 s) = signSave(10e6, keccak256("n5"));
        vm.prank(relayer);
        vm.expectRevert();
        saver.save(alice, 10e6, 0, block.timestamp + 600, keccak256("n5"), v, r, s, preview * 2);
    }
}
