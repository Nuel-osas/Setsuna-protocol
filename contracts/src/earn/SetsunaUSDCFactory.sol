// SPDX-License-Identifier: MIT
pragma solidity 0.8.30;

import {IERC20} from "@openzeppelin/contracts/token/ERC20/IERC20.sol";
import {SetsunaEarnVault} from "./SetsunaEarnVault.sol";
import {AaveUSDCAdapter} from "./AaveUSDCAdapter.sol";
import {MorphoUSDCAdapter} from "./MorphoUSDCAdapter.sol";
import {ILendingAdapter} from "./ILendingAdapter.sol";
import {IAaveEarnPool, IAaveEarnData, IMorphoEarn} from "./VenueInterfaces.sol";

// Separate creation-code holders keep every runtime below the EIP-170 size limit.
contract EarnVaultDeployer {
    address private immutable factory = msg.sender;

    function create(IERC20 asset, address guardian) external returns (SetsunaEarnVault) {
        require(msg.sender == factory);
        return new SetsunaEarnVault(asset, guardian, 25_000e6, 250_000e6);
    }

    function initialize(SetsunaEarnVault vault, ILendingAdapter[2] calldata adapters) external {
        require(msg.sender == factory);
        vault.initialize(adapters);
    }
}

contract AaveAdapterDeployer {
    address private immutable factory = msg.sender;

    function create(address vault, address asset, address pool, address data, address receipt)
        external
        returns (ILendingAdapter)
    {
        require(msg.sender == factory);
        return new AaveUSDCAdapter(vault, asset, IAaveEarnPool(pool), IAaveEarnData(data), IERC20(receipt));
    }
}

contract MorphoAdapterDeployer {
    address private immutable factory = msg.sender;

    function create(address vault, address asset, address morpho, bytes32 market)
        external
        returns (ILendingAdapter)
    {
        require(msg.sender == factory);
        return new MorphoUSDCAdapter(vault, asset, IMorphoEarn(morpho), market);
    }
}

/// @notice Atomic deployment with fixed Monad venues and the existing 250k-USDC eligibility floor.
/// @dev At the proof block the WBTC market is below that floor: its target must remain zero.
contract SetsunaUSDCFactory {
    EarnVaultDeployer private immutable _vaultDeployer;
    AaveAdapterDeployer private immutable _aaveDeployer;
    MorphoAdapterDeployer private immutable _morphoDeployer;
    address public constant USDC = 0x754704Bc059F8C67012fEd69BC8A327a5aafb603;
    address public constant AAVE = 0x69a5F9AD4f96ebf0a0C792dD42a01cC5C0102fef;
    address public constant AAVE_DATA = 0xB65A68B98274ef7D9a60E0C0747dD1BEc3D32fad;
    address public constant A_USDC = 0x35a73BAcb179d3740395A3ceCc87FF2e581d6042;
    address public constant MORPHO = 0xD5D960E8C380B724a48AC59E2DfF1b2CB4a1eAee;
    bytes32 public constant MARKET = 0xe35c5abc6418b6319b014e07aa3c86163a870a957284128f03cf7a9e414f8899;
    error WrongChain();
    event VaultCreated(
        address indexed vault, address indexed guardian, address aaveAdapter, address morphoAdapter
    );

    constructor() {
        _vaultDeployer = new EarnVaultDeployer();
        _aaveDeployer = new AaveAdapterDeployer();
        _morphoDeployer = new MorphoAdapterDeployer();
    }

    function createVault() external returns (SetsunaEarnVault vault) {
        if (block.chainid != 143) {
            revert WrongChain();
        }
        vault = _vaultDeployer.create(IERC20(USDC), msg.sender);
        ILendingAdapter[2] memory venues;
        venues[0] = _aaveDeployer.create(address(vault), USDC, AAVE, AAVE_DATA, A_USDC);
        venues[1] = _morphoDeployer.create(address(vault), USDC, MORPHO, MARKET);
        _vaultDeployer.initialize(vault, venues);
        emit VaultCreated(address(vault), msg.sender, address(venues[0]), address(venues[1]));
    }
}
