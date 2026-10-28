// SPDX-License-Identifier: MIT
pragma solidity 0.8.30;

import {Test} from "forge-std/Test.sol";
import {IERC20} from "@openzeppelin/contracts/token/ERC20/IERC20.sol";
import {IERC4626} from "@openzeppelin/contracts/interfaces/IERC4626.sol";
import {SetsunaAUSDWrapper, ICurveStablePool} from "../src/earn/SetsunaAUSDWrapper.sol";

interface IAUSD is IERC20 {
    function DOMAIN_SEPARATOR() external view returns (bytes32);
    function receiveWithAuthorization(
        address from,
        address to,
        uint256 value,
        uint256 validAfter,
        uint256 validBefore,
        bytes32 nonce,
        uint8 v,
        bytes32 r,
        bytes32 s
    ) external;
}

/// @dev A relayer-side contract like a payments app would run: it carries out a holder's signatures
/// and pays the gas. The holder never sends a transaction.
contract SignedSaver {
    IAUSD public immutable ausd;
    SetsunaAUSDWrapper public immutable wrapper;

    constructor(IAUSD ausd_, SetsunaAUSDWrapper wrapper_) {
        ausd = ausd_;
        wrapper = wrapper_;
        ausd_.approve(address(wrapper_), type(uint256).max);
    }

    function save(address owner, uint256 value, uint256 validBefore, bytes32 nonce, uint8 v, bytes32 r, bytes32 s)
        external
        returns (uint256)
    {
        ausd.receiveWithAuthorization(owner, address(this), value, 0, validBefore, nonce, v, r, s);
        return wrapper.deposit(value, owner);
    }

    function withdraw(address owner, uint256 shares, uint256 deadline, uint8 v, bytes32 r, bytes32 s)
        external
        returns (uint256)
    {
        wrapper.permit(owner, address(this), shares, deadline, v, r, s);
        return wrapper.redeem(shares, owner, owner);
    }
}

contract SetsunaAUSDWrapperForkTest is Test {
    IAUSD constant AUSD = IAUSD(0x00000000eFE302BEAA2b3e6e1b18d08D69a9012a);
    IERC20 constant USDC = IERC20(0x754704Bc059F8C67012fEd69BC8A327a5aafb603);
    IERC4626 constant SETS_USDC = IERC4626(0x0a531817EEFB7b1FFD7c511c0817F58ac343CC67);
    ICurveStablePool constant POOL = ICurveStablePool(0x942644106B073E30D72c2C5D7529D5C296ea91ab);

    bytes32 constant RECEIVE_TYPEHASH = keccak256(
        "ReceiveWithAuthorization(address from,address to,uint256 value,uint256 validAfter,uint256 validBefore,bytes32 nonce)"
    );
    bytes32 constant PERMIT_TYPEHASH =
        keccak256("Permit(address owner,address spender,uint256 value,uint256 nonce,uint256 deadline)");

    SetsunaAUSDWrapper wrapper;
    SignedSaver saver;
    uint256 aliceKey = 0xA11CE;
    address alice;
    address relayer = address(0xBEEF);

    function setUp() public {
        vm.skip(!vm.envOr("RUN_FORK", false));
        vm.createSelectFork(vm.envOr("MONAD_RPC_URL", string("https://rpc2.monad.xyz")));
        assertEq(block.chainid, 143);
        wrapper = new SetsunaAUSDWrapper(SETS_USDC, POOL, AUSD, 0, 1, "Setsuna AUSD Savings", "setsAUSD");
        saver = new SignedSaver(AUSD, wrapper);
        alice = vm.addr(aliceKey);
        fundAUSD(alice, 100e6);
    }

    // AUSD's storage layout defeats `deal`, so tests are funded from a large holder on the fork.
    address constant AUSD_HOLDER = 0xf33286E3222D1c829dACeac48c0Ec651F6452470;

    function fundAUSD(address to, uint256 amount) internal {
        vm.prank(AUSD_HOLDER);
        AUSD.transfer(to, amount);
        assertEq(AUSD.balanceOf(to), amount);
    }

    function signReceive(uint256 value, bytes32 nonce) internal view returns (uint8, bytes32, bytes32) {
        bytes32 structHash =
            keccak256(abi.encode(RECEIVE_TYPEHASH, alice, address(saver), value, 0, block.timestamp + 600, nonce));
        return vm.sign(aliceKey, keccak256(abi.encodePacked("\x19\x01", AUSD.DOMAIN_SEPARATOR(), structHash)));
    }

    function signPermit(uint256 shares, uint256 deadline) internal view returns (uint8, bytes32, bytes32) {
        bytes32 structHash =
            keccak256(abi.encode(PERMIT_TYPEHASH, alice, address(saver), shares, wrapper.nonces(alice), deadline));
        return vm.sign(aliceKey, keccak256(abi.encodePacked("\x19\x01", wrapper.DOMAIN_SEPARATOR(), structHash)));
    }

    function testConfiguration() public view {
        assertEq(wrapper.asset(), address(AUSD));
        assertEq(address(wrapper.usdc()), address(USDC));
        assertEq(wrapper.decimals(), SETS_USDC.decimals());
        assertEq(wrapper.maxMint(alice), 0);
        assertEq(wrapper.maxWithdraw(alice), 0);
    }

    /// The whole flow without the holder ever sending a transaction or holding MON.
    function testGaslessSaveAndWithdrawThroughRelayer() public {
        assertEq(alice.balance, 0);
        bytes32 nonce = keccak256("save-1");
        uint256 expected = wrapper.previewDeposit(50e6);
        (uint8 v, bytes32 r, bytes32 s) = signReceive(50e6, nonce);
        vm.prank(relayer);
        uint256 shares = saver.save(alice, 50e6, block.timestamp + 600, nonce, v, r, s);

        assertGe(shares, expected, "minted less than previewed");
        assertLe(shares - expected, expected / 5_000, "preview far below the result");
        assertEq(wrapper.balanceOf(alice), shares);
        assertEq(SETS_USDC.balanceOf(address(wrapper)), wrapper.totalSupply());
        assertEq(AUSD.balanceOf(alice), 50e6);
        assertGe(wrapper.totalAssets(), 49.98e6);

        uint256 quote = wrapper.previewRedeem(shares);
        (v, r, s) = signPermit(shares, block.timestamp + 600);
        vm.prank(relayer);
        uint256 back = saver.withdraw(alice, shares, block.timestamp + 600, v, r, s);

        assertEq(back, quote);
        assertEq(AUSD.balanceOf(alice), 50e6 + back);
        assertGe(back, 49.95e6, "round trip costs more than 0.1%");
        assertEq(wrapper.balanceOf(alice), 0);
        assertEq(wrapper.totalSupply(), 0);
        assertEq(SETS_USDC.balanceOf(address(wrapper)), 0);
        assertEq(USDC.balanceOf(address(wrapper)), 0);
        assertEq(AUSD.balanceOf(address(wrapper)), 0);
        assertEq(alice.balance, 0);
    }

    function testReplayedOrForeignSignaturesFail() public {
        bytes32 nonce = keccak256("save-2");
        (uint8 v, bytes32 r, bytes32 s) = signReceive(10e6, nonce);
        vm.prank(relayer);
        saver.save(alice, 10e6, block.timestamp + 600, nonce, v, r, s);
        vm.expectRevert();
        saver.save(alice, 10e6, block.timestamp + 600, nonce, v, r, s);

        uint256 shares = wrapper.balanceOf(alice);
        vm.expectRevert();
        vm.prank(relayer);
        wrapper.redeem(shares, relayer, alice);
        (v, r, s) = signPermit(shares, block.timestamp + 600);
        vm.prank(relayer);
        saver.withdraw(alice, shares, block.timestamp + 600, v, r, s);
        vm.expectRevert();
        saver.withdraw(alice, shares, block.timestamp + 600, v, r, s);
    }

    function testDirectDepositRedeemAndMinimums() public {
        vm.startPrank(alice);
        AUSD.approve(address(wrapper), type(uint256).max);
        uint256 preview = wrapper.previewDeposit(20e6);
        vm.expectRevert();
        wrapper.depositWithMinShares(20e6, alice, preview * 10_003 / 10_000);
        uint256 shares = wrapper.depositWithMinShares(20e6, alice, preview);
        uint256 quote = wrapper.previewRedeem(shares);
        vm.expectRevert();
        wrapper.redeemWithMinAssets(shares, alice, alice, quote + 1);
        assertEq(wrapper.redeemWithMinAssets(shares, alice, alice, quote), quote);
        vm.stopPrank();
    }

    function testUnwrapHandsBackPlainSetsUSDC() public {
        vm.startPrank(alice);
        AUSD.approve(address(wrapper), type(uint256).max);
        uint256 shares = wrapper.deposit(30e6, alice);
        wrapper.unwrap(shares, alice, alice);
        assertEq(SETS_USDC.balanceOf(alice), shares);
        assertEq(wrapper.totalSupply(), 0);
        IERC20(address(SETS_USDC)).approve(address(wrapper), shares);
        wrapper.wrap(shares, alice);
        assertEq(wrapper.balanceOf(alice), shares);
        assertEq(SETS_USDC.balanceOf(address(wrapper)), shares);
        vm.stopPrank();
    }

    function testExactOutputFunctionsAreNotOffered() public {
        vm.expectRevert(SetsunaAUSDWrapper.Unsupported.selector);
        wrapper.mint(1e12, alice);
        vm.expectRevert(SetsunaAUSDWrapper.Unsupported.selector);
        wrapper.withdraw(1e6, alice, alice);
    }

    /// A depeg (the pool pushed far off one-for-one) stops deposits instead of filling them badly.
    function testDepegStopsDepositsButUnwrapStillWorks() public {
        vm.startPrank(alice);
        AUSD.approve(address(wrapper), type(uint256).max);
        uint256 shares = wrapper.deposit(10e6, alice);
        vm.stopPrank();

        address whale = address(0xD0D0);
        fundAUSD(whale, 3_000_000e6);
        vm.startPrank(whale);
        AUSD.approve(address(POOL), type(uint256).max);
        POOL.exchange(0, 1, 3_000_000e6, 0);
        vm.stopPrank();
        assertLt(POOL.get_dy(0, 1, 10e6), 9.98e6, "pool not depegged enough for the test");

        vm.prank(alice);
        vm.expectRevert();
        wrapper.deposit(10e6, alice);

        vm.prank(alice);
        wrapper.unwrap(shares, alice, alice);
        assertEq(SETS_USDC.balanceOf(alice), shares);
    }

    function testFuzzSharesStayBackedOneForOne(uint96 amount) public {
        uint256 value = bound(uint256(amount), 1e6, 90e6);
        vm.startPrank(alice);
        AUSD.approve(address(wrapper), type(uint256).max);
        uint256 shares = wrapper.deposit(value, alice);
        assertEq(SETS_USDC.balanceOf(address(wrapper)), wrapper.totalSupply());
        wrapper.redeem(shares / 2, alice, alice);
        assertEq(SETS_USDC.balanceOf(address(wrapper)), wrapper.totalSupply());
        vm.stopPrank();
    }
}
