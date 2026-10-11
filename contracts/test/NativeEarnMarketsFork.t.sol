// SPDX-License-Identifier: MIT
pragma solidity 0.8.30;

import {Test} from "forge-std/Test.sol";
import {IERC20} from "@openzeppelin/contracts/token/ERC20/IERC20.sol";
import {SafeERC20} from "@openzeppelin/contracts/token/ERC20/utils/SafeERC20.sol";

// Research-only ABI subsets, not production adapters. See the associated native
// market screening report for deployment provenance and source revisions.
interface ICurvanceNativeProof is IERC20 {
    function asset() external view returns (address);
    function centralRegistry() external view returns (address);
    function totalAssets() external view returns (uint256);
    function assetsHeld() external view returns (uint256);
    function maxDeposit(address) external view returns (uint256);
    function deposit(uint256, address) external returns (uint256);
    function withdraw(uint256, address, address) external returns (uint256);
    function redeem(uint256, address, address) external returns (uint256);
    function convertToAssets(uint256) external view returns (uint256);
}

interface ITownSpokeNativeProof {
    struct MessageParams {
        uint16 adapterId;
        uint16 returnAdapterId;
        uint256 receiverValue;
        uint256 gasLimit;
        uint256 returnGasLimit;
    }
    function createAccount(MessageParams calldata, bytes32, bytes4, bytes32) external payable;
    function createLoan(MessageParams calldata, bytes32, bytes4, uint16, bytes32) external payable;
    function topup(MessageParams calldata, bytes32, bytes32, uint256) external payable;
    function withdraw(MessageParams calldata, bytes32, bytes32, uint8, uint16, uint256, bool) external payable;
}

interface ITownLoansNativeProof {
    struct Collateral {
        uint256 balance;
        uint256 rewardIndex;
    }

    struct Borrow {
        uint256 amount;
        uint256 balance;
        uint256 lastInterestIndex;
        uint256 stableInterestRate;
        uint256 lastStableUpdateTimestamp;
        uint256 rewardIndex;
    }
    function retrieveUserLoan(bytes32)
        external
        view
        returns (bytes32, uint16, uint8[] memory, uint8[] memory, Collateral[] memory, Borrow[] memory);
}

interface ITownPoolNativeProof {
    struct DepositData {
        uint16 optimalUtilisationRatio;
        uint256 totalAmount;
        uint256 interestRate;
        uint256 interestIndex;
    }
    function getDepositData() external view returns (DepositData memory);
}

/// @notice Actual Monad contracts; only this test contract's funds are synthetic.
/// No protocol administrator, oracle, pause flag or market state is overridden.
contract NativeEarnMarketsForkTest is Test {
    using SafeERC20 for IERC20;

    uint256 constant PINNED_BLOCK = 111_560_409;
    uint256 constant PINNED_TIMESTAMP = 1_791_447_513;
    IERC20 constant USDC = IERC20(0x754704Bc059F8C67012fEd69BC8A327a5aafb603);
    address constant REGISTRY = 0x1310f352f1389969Ece6741671c4B919523912fF;
    uint256 constant AMOUNT = 1_000e6;
    address[4] candidates = [
        0x8EE9FC28B8Da872c38A496e9dDB9700bb7261774, // WMON
        0x9891178A1178E4C740Fa61Fd6e30A9D92D897590, // savUSD
        0x207340D15F4E3C63AE610429f34b87C73a5D55e5, // aguaUSDCgc
        0x7f779f7F5316F6164dC5a25422A5ee51504B284A // wsrUSD
    ];

    function setUp() public {
        vm.skip(!vm.envOr("RUN_FORK", false));
        vm.createSelectFork(
            vm.envOr("MONAD_RPC_URL", string("https://rpc-mainnet.monadinfra.com")), PINNED_BLOCK
        );
        assertEq(block.chainid, 143);
        assertEq(block.number, PINNED_BLOCK);
        assertEq(block.timestamp, PINNED_TIMESTAMP);
        assertEq(
            blockhash(PINNED_BLOCK - 1), 0x19ae1b058fd08d90d2ad7c126546e3c7783e9ce7d54d447f54a11c7e7312af57
        );
        deal(address(USDC), address(this), AMOUNT);
    }

    function _deposit(address destination) internal returns (ICurvanceNativeProof venue) {
        venue = ICurvanceNativeProof(destination);
        assertEq(venue.asset(), address(USDC));
        assertEq(venue.centralRegistry(), REGISTRY);
        assertGe(venue.totalAssets(), 250_000e6, "market below Setsuna size floor");
        assertGe(venue.assetsHeld() / 10, AMOUNT, "exceeds 10% market cash bound");
        assertGe(venue.maxDeposit(address(this)), AMOUNT);
        assertEq(venue.balanceOf(address(this)), 0);
        USDC.forceApprove(destination, AMOUNT);
        uint256 minted = venue.deposit(AMOUNT, address(this));
        USDC.forceApprove(destination, 0);
        assertGt(minted, 0);
        assertEq(minted, venue.balanceOf(address(this)));
        assertEq(USDC.balanceOf(address(this)), 0);
        assertEq(USDC.allowance(address(this), destination), 0);
        assertApproxEqAbs(venue.convertToAssets(minted), AMOUNT, 2);
        emit log_named_address("Curvance destination", destination);
        emit log_named_uint("Shares minted", minted);
    }

    function _roundTrip(uint256 index, bool simulateTime) internal {
        ICurvanceNativeProof venue = _deposit(candidates[index]);
        if (simulateTime) {
            vm.warp(block.timestamp + 7 days);
        }
        venue.withdraw(400e6, address(this), address(this));
        assertEq(USDC.balanceOf(address(this)), 400e6);
        uint256 finalPayment = venue.redeem(venue.balanceOf(address(this)), address(this), address(this));
        assertEq(venue.balanceOf(address(this)), 0);
        assertEq(USDC.balanceOf(address(this)), 400e6 + finalPayment);
        assertGe(USDC.balanceOf(address(this)), AMOUNT - 2, "material round-trip loss");
        emit log_named_uint("Final USDC (6 decimals)", USDC.balanceOf(address(this)));
    }

    function testFork_CurvanceWMON_ImmediateRoundTrip() public {
        _roundTrip(0, false);
    }

    function testFork_CurvanceSavUSD_ImmediateRoundTrip() public {
        _roundTrip(1, false);
    }

    function testFork_CurvanceAgua_ImmediateRoundTrip() public {
        _roundTrip(2, false);
    }

    function testFork_CurvanceWsrUSD_ImmediateRoundTrip() public {
        _roundTrip(3, false);
    }

    function testFork_CurvanceWMON_SevenDayRoundTrip() public {
        _roundTrip(0, true);
    }

    function testFork_CurvanceSavUSD_SevenDayRoundTrip() public {
        _roundTrip(1, true);
    }

    function testFork_CurvanceAgua_SevenDayRoundTrip() public {
        _roundTrip(2, true);
    }

    function testFork_CurvanceWsrUSD_SevenDayRoundTrip() public {
        _roundTrip(3, true);
    }

    function testFork_CurvanceMoveBetweenMarketsAndExit() public {
        ICurvanceNativeProof first = _deposit(candidates[0]);
        uint256 recovered = first.redeem(first.balanceOf(address(this)), address(this), address(this));
        assertEq(first.balanceOf(address(this)), 0);
        ICurvanceNativeProof second = ICurvanceNativeProof(candidates[3]);
        USDC.forceApprove(address(second), recovered);
        second.deposit(recovered, address(this));
        USDC.forceApprove(address(second), 0);
        second.redeem(second.balanceOf(address(this)), address(this), address(this));
        assertEq(second.balanceOf(address(this)), 0);
        assertEq(USDC.allowance(address(this), address(second)), 0);
        assertApproxEqAbs(USDC.balanceOf(address(this)), AMOUNT, 4);
        emit log_named_uint("USDC after moving across two markets", USDC.balanceOf(address(this)));
    }

    // A compatibility probe only: this pool is BELOW Setsuna's size floor.
    // No deployed TownSqVault wrapper, queued redemption, or cross-chain route
    // is exercised. Both message adapters select TownSquare's same-chain path.
    function _townRoundTrip(bool simulateTime) internal {
        ITownSpokeNativeProof ops = ITownSpokeNativeProof(0x63CB1CF5aCCbCC57e0cCa047bE9673EA5022b8DB);
        ITownSpokeNativeProof tokenOps = ITownSpokeNativeProof(0xA457235B68606a7921b7c525D92e9592e793b4C0);
        ITownPoolNativeProof pool = ITownPoolNativeProof(0xdb4E67F878289A820046f46f6304fd6Ee1449281);
        assertLt(pool.getDepositData().totalAmount, 250_000e6, "reassess size decision");
        ITownSpokeNativeProof.MessageParams memory params =
            ITownSpokeNativeProof.MessageParams(1, 1, 0, 5_000_000, 5_000_000);
        bytes4 nonce = 0x53455453;
        bytes32 account =
            keccak256(abi.encodePacked(bytes32(uint256(uint160(address(this)))), uint16(143), nonce));
        bytes32 loan = keccak256(abi.encodePacked(account, nonce));
        ops.createAccount(params, account, nonce, bytes32(0));
        ops.createLoan(params, account, nonce, 1, bytes32("SETSUNA RESEARCH"));
        USDC.forceApprove(address(tokenOps), 100e6);
        tokenOps.topup(params, account, loan, 100e6);
        USDC.forceApprove(address(tokenOps), 0);
        assertEq(USDC.balanceOf(address(this)), AMOUNT - 100e6);
        assertGt(_townShares(loan), 0, "same-chain supply not settled");
        if (simulateTime) {
            vm.warp(block.timestamp + 7 days);
        }
        ops.withdraw(params, account, loan, 10, 143, 40e6, false);
        assertEq(USDC.balanceOf(address(this)), AMOUNT - 60e6, "partial withdrawal not settled");
        uint256 shares = _townShares(loan);
        ops.withdraw(params, account, loan, 10, 143, shares, true);
        assertEq(_townShares(loan), 0, "residual TownSquare position");
        assertGe(USDC.balanceOf(address(this)), AMOUNT - 2);
        assertEq(USDC.allowance(address(this), address(tokenOps)), 0);
        emit log_named_uint(
            "TownSquare USDC returned for 100 deposit", USDC.balanceOf(address(this)) - (AMOUNT - 100e6)
        );
    }

    function _townShares(bytes32 loan) internal view returns (uint256 shares) {
        (
            ,,
            uint8[] memory pools,
            uint8[] memory borrowPools,
            ITownLoansNativeProof.Collateral[] memory collateral,
        ) = ITownLoansNativeProof(0xC4C20EFbEfA4Bde14091a3040d112cF981d8B2DB).retrieveUserLoan(loan);
        assertEq(borrowPools.length, 0, "research position must not borrow");
        for (uint256 i; i < pools.length; ++i) {
            if (pools[i] == 10) {
                shares += collateral[i].balance;
            }
        }
    }

    function testFork_TownSquare_ImmediateRoundTripBelowSizeFloor() public {
        _townRoundTrip(false);
    }

    function testFork_TownSquare_SevenDayRoundTripBelowSizeFloor() public {
        _townRoundTrip(true);
    }
}
