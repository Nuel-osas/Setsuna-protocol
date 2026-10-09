// SPDX-License-Identifier: MIT
pragma solidity 0.8.30;

import {Test} from "forge-std/Test.sol";
import {IERC20} from "@openzeppelin/contracts/token/ERC20/IERC20.sol";
import {SafeERC20} from "@openzeppelin/contracts/token/ERC20/utils/SafeERC20.sol";

// Test-only ABI subsets. Source revisions and deployment provenance are recorded
// in docs/research/earn-markets-2026-10-02.md. This is not a Setsuna vault/adapter.
interface IAaveEarnProof {
    function supply(address asset, uint256 amount, address onBehalfOf, uint16 referralCode) external;
    function withdraw(address asset, uint256 amount, address to) external returns (uint256);
}

interface IAaveDataEarnProof {
    struct Reserve {
        uint256 unbacked;
        uint256 accruedToTreasuryScaled;
        uint256 totalAToken;
        uint256 totalStableDebt;
        uint256 totalVariableDebt;
        uint256 liquidityRate;
        uint256 variableBorrowRate;
        uint256 stableBorrowRate;
        uint256 averageStableBorrowRate;
        uint256 liquidityIndex;
        uint256 variableBorrowIndex;
        uint40 lastUpdateTimestamp;
    }

    function getReserveData(address asset) external view returns (Reserve memory);
}

interface IMorphoEarnProof {
    struct Params {
        address loanToken;
        address collateralToken;
        address oracle;
        address irm;
        uint256 lltv;
    }

    struct Market {
        uint128 totalSupplyAssets;
        uint128 totalSupplyShares;
        uint128 totalBorrowAssets;
        uint128 totalBorrowShares;
        uint128 lastUpdate;
        uint128 fee;
    }

    function idToMarketParams(bytes32 id) external view returns (Params memory);
    function market(bytes32 id) external view returns (Market memory);
    function position(bytes32 id, address account) external view returns (uint256, uint128, uint128);
    function accrueInterest(Params memory params) external;
    function supply(Params memory params, uint256 assets, uint256 shares, address onBehalf, bytes memory data)
        external
        returns (uint256, uint256);
    function withdraw(
        Params memory params,
        uint256 assets,
        uint256 shares,
        address onBehalf,
        address receiver
    ) external returns (uint256, uint256);
}

interface IMorphoRateEarnProof {
    function borrowRateView(IMorphoEarnProof.Params memory params, IMorphoEarnProof.Market memory market)
        external
        view
        returns (uint256);
}

/// @notice Real lending-contract calls on an isolated, pinned Monad fork.
/// @dev Only the test depositor's USDC balance is synthetically funded. No mocked
/// venue calls, administrator impersonation, mainnet writes, or production keys.
contract EarnMarketsForkTest is Test {
    using SafeERC20 for IERC20;

    uint256 constant PINNED_BLOCK = 109_894_238;
    uint256 constant PINNED_TIMESTAMP = 1_790_944_138;
    bytes32 constant PINNED_PARENT_HASH = 0x14959d692dfb9ea7b5a5b21287854adc2a95339fbf74ff96f09e4ac9e4d29cac;
    IERC20 constant USDC = IERC20(0x754704Bc059F8C67012fEd69BC8A327a5aafb603);
    IAaveEarnProof constant AAVE = IAaveEarnProof(0x69a5F9AD4f96ebf0a0C792dD42a01cC5C0102fef);
    IERC20 constant A_USDC = IERC20(0x35a73BAcb179d3740395A3ceCc87FF2e581d6042);
    IAaveDataEarnProof constant AAVE_DATA = IAaveDataEarnProof(0xB65A68B98274ef7D9a60E0C0747dD1BEc3D32fad);
    IMorphoEarnProof constant MORPHO = IMorphoEarnProof(0xD5D960E8C380B724a48AC59E2DfF1b2CB4a1eAee);
    bytes32 constant MARKET_ID = 0xe35c5abc6418b6319b014e07aa3c86163a870a957284128f03cf7a9e414f8899;
    uint256 constant DEPOSIT = 1_000e6;
    IMorphoEarnProof.Params params;

    function setUp() public {
        vm.skip(!vm.envOr("RUN_FORK", false));
        vm.createSelectFork(vm.envOr("MONAD_RPC_URL", string("https://rpc.monad.xyz")), PINNED_BLOCK);
        assertEq(blockhash(PINNED_BLOCK - 1), PINNED_PARENT_HASH, "wrong fork parent hash");
        assertEq(block.chainid, 143);
        assertEq(block.number, PINNED_BLOCK);
        assertEq(block.timestamp, PINNED_TIMESTAMP);
        assertGt(address(AAVE).code.length, 0);
        assertGt(address(MORPHO).code.length, 0);
        params = MORPHO.idToMarketParams(MARKET_ID);
        assertEq(keccak256(abi.encode(params)), MARKET_ID);
        assertEq(params.loanToken, address(USDC));
        assertEq(params.collateralToken, 0x0555E30da8f98308EdB960aa94C0Db47230d2B9c);
        assertEq(params.irm, 0x09475a3D6eA8c314c592b1a3799bDE044E2F400F);
        assertEq(params.lltv, 0.86e18);
        deal(address(USDC), address(this), DEPOSIT);
        assertEq(USDC.balanceOf(address(this)), DEPOSIT);
        assertEq(A_USDC.balanceOf(address(this)), 0);
        assertEq(_morphoShares(), 0);
    }

    function _supplyAave(uint256 amount) internal {
        USDC.forceApprove(address(AAVE), amount);
        AAVE.supply(address(USDC), amount, address(this), 0);
        USDC.forceApprove(address(AAVE), 0);
        assertEq(USDC.allowance(address(this), address(AAVE)), 0);
    }

    function _supplyMorpho(uint256 amount) internal returns (uint256 shares) {
        USDC.forceApprove(address(MORPHO), amount);
        (uint256 supplied, uint256 minted) = MORPHO.supply(params, amount, 0, address(this), "");
        assertEq(supplied, amount);
        USDC.forceApprove(address(MORPHO), 0);
        assertEq(USDC.allowance(address(this), address(MORPHO)), 0);
        return minted;
    }

    function _morphoShares() internal view returns (uint256 shares) {
        (shares,,) = MORPHO.position(MARKET_ID, address(this));
    }

    function _redeemMorpho() internal returns (uint256 assets) {
        uint256 shares = _morphoShares();
        (assets, shares) = MORPHO.withdraw(params, 0, shares, address(this), address(this));
        assertGt(shares, 0);
        assertEq(_morphoShares(), 0);
    }

    // Instantaneous annualized base rate, excluding rewards. Approximate because
    // utilization/borrow rates can change; not a promised APY or earned return.
    function _morphoSupplyAprWad() internal view returns (uint256) {
        IMorphoEarnProof.Market memory m = MORPHO.market(MARKET_ID);
        uint256 borrowPerSecond = IMorphoRateEarnProof(params.irm).borrowRateView(params, m);
        return borrowPerSecond * 365 days * m.totalBorrowAssets / m.totalSupplyAssets * (1e18 - m.fee) / 1e18;
    }

    function testFork_AaveContractDepositsPartiallyWithdrawsAndFullyExits() public {
        uint256 cashBefore = USDC.balanceOf(address(A_USDC));
        _supplyAave(DEPOSIT);
        assertEq(USDC.balanceOf(address(this)), 0);
        assertEq(USDC.balanceOf(address(A_USDC)), cashBefore + DEPOSIT);
        assertApproxEqAbs(A_USDC.balanceOf(address(this)), DEPOSIT, 1);
        assertEq(AAVE.withdraw(address(USDC), 400e6, address(this)), 400e6);
        assertEq(USDC.balanceOf(address(this)), 400e6);
        // Deposit and partial withdrawal each round the scaled aToken position.
        // At this block the two conversions cost two USDC base units in total.
        uint256 remainingClaim = A_USDC.balanceOf(address(this));
        uint256 remaining = AAVE.withdraw(address(USDC), type(uint256).max, address(this));
        assertEq(remaining, remainingClaim);
        assertApproxEqAbs(remaining, 600e6, 2);
        assertEq(A_USDC.balanceOf(address(this)), 0);
        assertApproxEqAbs(USDC.balanceOf(address(this)), DEPOSIT, 2);
        emit log_named_uint("deposit USDC units", DEPOSIT);
        emit log_named_uint("partial withdrawal USDC units", 400e6);
        emit log_named_uint("final withdrawal USDC units", remaining);
        emit log_named_uint("ending wallet USDC units", USDC.balanceOf(address(this)));
    }

    function testFork_MorphoContractDepositsPartiallyWithdrawsAndFullyExits() public {
        uint256 cashBefore = USDC.balanceOf(address(MORPHO));
        uint256 shares = _supplyMorpho(DEPOSIT);
        assertGt(shares, 0);
        assertEq(_morphoShares(), shares);
        assertEq(USDC.balanceOf(address(this)), 0);
        assertEq(USDC.balanceOf(address(MORPHO)), cashBefore + DEPOSIT);
        (uint256 partialAssets, uint256 burned) =
            MORPHO.withdraw(params, 400e6, 0, address(this), address(this));
        assertEq(partialAssets, 400e6);
        assertGt(burned, 0);
        assertEq(USDC.balanceOf(address(this)), 400e6);
        uint256 remaining = _redeemMorpho();
        assertApproxEqAbs(remaining, 600e6, 2);
        assertApproxEqAbs(USDC.balanceOf(address(this)), DEPOSIT, 2);
        emit log_named_uint("deposit USDC units", DEPOSIT);
        emit log_named_uint("supply shares minted", shares);
        emit log_named_uint("partial withdrawal USDC units", partialAssets);
        emit log_named_uint("final withdrawal USDC units", remaining);
        emit log_named_uint("ending wallet USDC units", USDC.balanceOf(address(this)));
    }

    function testFork_ContractMovesUSDCBetweenDifferentProtocols() public {
        _supplyAave(DEPOSIT);
        uint256 fromAave = AAVE.withdraw(address(USDC), type(uint256).max, address(this));
        _supplyMorpho(fromAave);
        uint256 fromMorpho = _redeemMorpho();
        assertEq(A_USDC.balanceOf(address(this)), 0);
        assertEq(_morphoShares(), 0);
        assertApproxEqAbs(fromMorpho, DEPOSIT, 2);
        assertEq(USDC.balanceOf(address(this)), fromMorpho);
        emit log_named_uint("Aave exit USDC units", fromAave);
        emit log_named_uint("Morpho exit USDC units", fromMorpho);
    }

    function testFork_OnchainBaseRatesReactToNewSupply() public {
        MORPHO.accrueInterest(params);
        uint256 aaveBefore = AAVE_DATA.getReserveData(address(USDC)).liquidityRate;
        uint256 morphoBefore = _morphoSupplyAprWad();
        assertGt(aaveBefore, 0);
        assertGt(morphoBefore, 0);
        _supplyAave(500e6);
        _supplyMorpho(500e6);
        uint256 aaveAfter = AAVE_DATA.getReserveData(address(USDC)).liquidityRate;
        uint256 morphoAfter = _morphoSupplyAprWad();
        assertLt(aaveAfter, aaveBefore);
        assertLt(morphoAfter, morphoBefore);
        emit log_named_uint("Aave supply APR ray before", aaveBefore);
        emit log_named_uint("Aave supply APR ray after", aaveAfter);
        emit log_named_uint("Morpho supply APR wad before", morphoBefore);
        emit log_named_uint("Morpho supply APR wad after", morphoAfter);
    }

    function testFork_InterestAccruesAndCanBeWithdrawnAfterSevenSimulatedDays() public {
        _supplyAave(500e6);
        _supplyMorpho(500e6);
        vm.warp(block.timestamp + 7 days);
        uint256 fromAave = AAVE.withdraw(address(USDC), type(uint256).max, address(this));
        uint256 fromMorpho = _redeemMorpho();
        assertGt(fromAave, 500e6);
        assertGt(fromMorpho, 500e6);
        assertEq(A_USDC.balanceOf(address(this)), 0);
        assertEq(_morphoShares(), 0);
        assertEq(USDC.balanceOf(address(this)), fromAave + fromMorpho);
        emit log_named_uint("simulated elapsed seconds", 7 days);
        emit log_named_uint("Aave 500 USDC exit units", fromAave);
        emit log_named_uint("Morpho 500 USDC exit units", fromMorpho);
        emit log_named_uint("ending wallet USDC units", USDC.balanceOf(address(this)));
    }
}
