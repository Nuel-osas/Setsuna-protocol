// SPDX-License-Identifier: MIT
pragma solidity 0.8.30;

import {Test, Vm} from "forge-std/Test.sol";
import {IERC20} from "@openzeppelin/contracts/token/ERC20/IERC20.sol";
import {
    SetsunaBridgeSponsor,
    ICurveStablePool,
    ITokenMessengerV2
} from "../src/bridge/SetsunaBridgeSponsor.sol";

interface IDomain {
    function DOMAIN_SEPARATOR() external view returns (bytes32);
}

/// Sponsored CCTP burns against the live Monad USDC, AUSD, Curve pool and TokenMessengerV2 on a
/// mainnet fork: the holder only signs, the relayer pays, and nothing but the signed transfer happens.
contract SetsunaBridgeSponsorForkTest is Test {
    IERC20 constant USDC = IERC20(0x754704Bc059F8C67012fEd69BC8A327a5aafb603);
    IERC20 constant AUSD = IERC20(0x00000000eFE302BEAA2b3e6e1b18d08D69a9012a);
    ICurveStablePool constant POOL = ICurveStablePool(0x942644106B073E30D72c2C5D7529D5C296ea91ab);
    ITokenMessengerV2 constant MESSENGER = ITokenMessengerV2(0x28b5a0e9C621a5BadaA536219b3a228C8168cf5d);
    address constant AUSD_HOLDER = 0xf33286E3222D1c829dACeac48c0Ec651F6452470;
    bytes32 constant RECEIVE_TYPEHASH = keccak256(
        "ReceiveWithAuthorization(address from,address to,uint256 value,uint256 validAfter,uint256 validBefore,bytes32 nonce)"
    );
    bytes32 constant DEPOSIT_FOR_BURN = keccak256(
        "DepositForBurn(address,uint256,address,bytes32,uint32,bytes32,bytes32,uint256,uint32,bytes)"
    );
    uint32 constant BASE = 6;
    uint32 constant SOLANA = 5;

    SetsunaBridgeSponsor sponsor;
    uint256 aliceKey = 0xA11CE;
    address alice;
    address relayer = address(0xBEEF);
    address thief = address(0xBAD);
    bytes32 recipient;

    function setUp() public {
        vm.skip(!vm.envOr("RUN_FORK", false));
        vm.createSelectFork(vm.envOr("MONAD_RPC_URL", string("https://rpc2.monad.xyz")));
        sponsor = new SetsunaBridgeSponsor(USDC, AUSD, POOL, 0, 1, MESSENGER);
        alice = vm.addr(aliceKey);
        recipient = bytes32(uint256(uint160(alice)));
        vm.prank(AUSD_HOLDER);
        AUSD.transfer(alice, 50e6);
        vm.prank(address(POOL)); // the pool holds USDC; fund Alice from it on the fork
        USDC.transfer(alice, 50e6);
    }

    function transfer(uint256 value, bytes32 salt, uint32 domain, bool forward, uint256 minUsdcOut)
        internal
        view
        returns (SetsunaBridgeSponsor.Transfer memory t)
    {
        t = SetsunaBridgeSponsor.Transfer({
            owner: alice,
            value: value,
            validAfter: 0,
            validBefore: block.timestamp + 600,
            salt: salt,
            destinationDomain: domain,
            mintRecipient: recipient,
            maxFee: 0.3e6,
            minFinalityThreshold: 2000,
            forward: forward,
            minUsdcOut: minUsdcOut
        });
    }

    function sign(IERC20 token, SetsunaBridgeSponsor.Transfer memory t)
        internal
        view
        returns (uint8 v, bytes32 r, bytes32 s)
    {
        bytes32 nonce = sponsor.authorizationNonce(address(token), t);
        bytes32 h = keccak256(
            abi.encode(
                RECEIVE_TYPEHASH, t.owner, address(sponsor), t.value, t.validAfter, t.validBefore, nonce
            )
        );
        return vm.sign(
            aliceKey, keccak256(abi.encodePacked("\x19\x01", IDomain(address(token)).DOMAIN_SEPARATOR(), h))
        );
    }

    /// The DepositForBurn the messenger emitted in the last call: amount, depositor, recipient, domain, fee, hook.
    function lastBurn()
        internal
        returns (
            uint256 amount,
            address depositor,
            bytes32 mintRecipient,
            uint32 domain,
            uint256 maxFee,
            bytes memory hook
        )
    {
        Vm.Log[] memory logs = vm.getRecordedLogs();
        for (uint256 i; i < logs.length; i++) {
            if (logs[i].emitter == address(MESSENGER) && logs[i].topics[0] == DEPOSIT_FOR_BURN) {
                depositor = address(uint160(uint256(logs[i].topics[2])));
                (amount, mintRecipient, domain,,, maxFee, hook) =
                    abi.decode(logs[i].data, (uint256, bytes32, uint32, bytes32, bytes32, uint256, bytes));
                return (amount, depositor, mintRecipient, domain, maxFee, hook);
            }
        }
        revert("no DepositForBurn");
    }

    function testUSDCBurnsForTheSignedRecipientWithForwarding() public {
        SetsunaBridgeSponsor.Transfer memory t = transfer(20e6, "u1", BASE, true, 0);
        (uint8 v, bytes32 r, bytes32 s) = sign(USDC, t);
        uint256 supply = USDC.totalSupply();
        vm.recordLogs();
        vm.prank(relayer);
        uint256 burned = sponsor.bridgeUSDC(t, v, r, s);
        (uint256 amount, address depositor, bytes32 to, uint32 domain, uint256 maxFee, bytes memory hook) =
            lastBurn();

        assertEq(burned, 20e6);
        assertEq(amount, 20e6);
        assertEq(depositor, address(sponsor));
        assertEq(to, recipient);
        assertEq(domain, BASE);
        assertEq(maxFee, 0.3e6);
        assertEq(hook, abi.encodePacked(sponsor.FORWARD_HOOK()));
        assertEq(USDC.totalSupply(), supply - 20e6); // burned on Monad
        assertEq(USDC.balanceOf(alice), 30e6);
        assertEq(USDC.balanceOf(address(sponsor)), 0);
        assertEq(alice.balance, 0); // Alice never needed MON
    }

    function testAUSDSwapsThenBurnsAllOfIt() public {
        SetsunaBridgeSponsor.Transfer memory t = transfer(20e6, "a1", SOLANA, true, 19.9e6);
        (uint8 v, bytes32 r, bytes32 s) = sign(AUSD, t);
        uint256 supply = USDC.totalSupply();
        vm.recordLogs();
        vm.prank(relayer);
        uint256 burned = sponsor.bridgeAUSD(t, v, r, s);
        (uint256 amount,,, uint32 domain,,) = lastBurn();

        assertGe(burned, 19.96e6); // 99.8% floor
        assertEq(amount, burned);
        assertEq(domain, SOLANA);
        assertEq(USDC.totalSupply(), supply - burned);
        assertEq(AUSD.balanceOf(alice), 30e6);
        assertEq(AUSD.balanceOf(address(sponsor)), 0);
        assertEq(USDC.balanceOf(address(sponsor)), 0);
        assertEq(alice.balance, 0);
    }

    function testWithoutForwardingThereIsNoHook() public {
        SetsunaBridgeSponsor.Transfer memory t = transfer(5e6, "u2", BASE, false, 0);
        (uint8 v, bytes32 r, bytes32 s) = sign(USDC, t);
        vm.recordLogs();
        sponsor.bridgeUSDC(t, v, r, s);
        (,,,,, bytes memory hook) = lastBurn();
        assertEq(hook.length, 0);
    }

    function testEverySignedParameterIsBinding() public {
        SetsunaBridgeSponsor.Transfer memory t = transfer(10e6, "u3", BASE, true, 0);
        (uint8 v, bytes32 r, bytes32 s) = sign(USDC, t);

        // (A fresh struct each time: assigning a memory struct would alias `t`.)
        SetsunaBridgeSponsor.Transfer memory bad = transfer(10e6, "u3", BASE, true, 0);
        bad.mintRecipient = bytes32(uint256(uint160(thief)));
        vm.expectRevert();
        sponsor.bridgeUSDC(bad, v, r, s);

        bad = transfer(10e6, "u3", SOLANA, true, 0);
        vm.expectRevert();
        sponsor.bridgeUSDC(bad, v, r, s);

        bad = transfer(10e6, "u3", BASE, true, 0);
        bad.maxFee = 9e6;
        vm.expectRevert();
        sponsor.bridgeUSDC(bad, v, r, s);

        bad = transfer(10e6, "u3", BASE, false, 0);
        vm.expectRevert();
        sponsor.bridgeUSDC(bad, v, r, s);

        bad = transfer(10e6, "u3", BASE, true, 0);
        bad.minFinalityThreshold = 1000;
        vm.expectRevert();
        sponsor.bridgeUSDC(bad, v, r, s);

        bad = transfer(11e6, "u3", BASE, true, 0);
        vm.expectRevert();
        sponsor.bridgeUSDC(bad, v, r, s);

        bad = transfer(10e6, "u3", BASE, true, 0);
        bad.owner = thief;
        vm.expectRevert();
        sponsor.bridgeUSDC(bad, v, r, s);

        // An AUSD signature cannot pull USDC, or the other way round.
        vm.expectRevert();
        sponsor.bridgeAUSD(t, v, r, s);

        // As signed, it works once, whoever submits it.
        vm.prank(thief);
        sponsor.bridgeUSDC(t, v, r, s);
        vm.expectRevert();
        sponsor.bridgeUSDC(t, v, r, s);
        assertEq(USDC.balanceOf(thief), 0);
        assertEq(USDC.balanceOf(alice), 40e6);
    }

    function testTheSwapMinimumIsBinding() public {
        // Signed with a minimum the pool cannot meet: the whole call reverts and nothing moves.
        SetsunaBridgeSponsor.Transfer memory t = transfer(10e6, "a2", BASE, true, 10.5e6);
        (uint8 v, bytes32 r, bytes32 s) = sign(AUSD, t);
        vm.expectRevert();
        sponsor.bridgeAUSD(t, v, r, s);
        assertEq(AUSD.balanceOf(alice), 50e6);

        // The relayer cannot lower a signed minimum either.
        SetsunaBridgeSponsor.Transfer memory u = transfer(10e6, "a3", BASE, true, 9.99e6);
        (v, r, s) = sign(AUSD, u);
        u.minUsdcOut = 0;
        vm.expectRevert();
        sponsor.bridgeAUSD(u, v, r, s);

        // USDC transfers must not carry a swap minimum.
        SetsunaBridgeSponsor.Transfer memory w = transfer(10e6, "u4", BASE, true, 1);
        (v, r, s) = sign(USDC, w);
        vm.expectRevert(SetsunaBridgeSponsor.InvalidTransfer.selector);
        sponsor.bridgeUSDC(w, v, r, s);
    }

    function testBadTransfersRevertWithoutMovingFunds() public {
        // A fee ceiling at or above the amount: CCTP refuses the burn.
        SetsunaBridgeSponsor.Transfer memory t = transfer(1e6, "u5", BASE, true, 0);
        t.maxFee = 1e6;
        (uint8 v, bytes32 r, bytes32 s) = sign(USDC, t);
        vm.expectRevert();
        sponsor.bridgeUSDC(t, v, r, s);

        // Monad to Monad is not a bridge.
        t = transfer(1e6, "u6", 15, true, 0);
        (v, r, s) = sign(USDC, t);
        vm.expectRevert();
        sponsor.bridgeUSDC(t, v, r, s);

        // No recipient.
        t = transfer(1e6, "u7", BASE, true, 0);
        t.mintRecipient = bytes32(0);
        (v, r, s) = sign(USDC, t);
        vm.expectRevert(SetsunaBridgeSponsor.InvalidTransfer.selector);
        sponsor.bridgeUSDC(t, v, r, s);

        // Expired.
        t = transfer(1e6, "u8", BASE, true, 0);
        (v, r, s) = sign(USDC, t);
        vm.warp(t.validBefore + 1);
        vm.expectRevert();
        sponsor.bridgeUSDC(t, v, r, s);

        assertEq(USDC.balanceOf(alice), 50e6);
    }

    function testConstructorChecksThePool() public {
        vm.expectRevert(SetsunaBridgeSponsor.InvalidConfiguration.selector);
        new SetsunaBridgeSponsor(USDC, AUSD, POOL, 1, 0, MESSENGER);
        vm.expectRevert(SetsunaBridgeSponsor.InvalidConfiguration.selector);
        new SetsunaBridgeSponsor(USDC, AUSD, POOL, 0, 0, MESSENGER);
    }
}
