// SPDX-License-Identifier: MIT
pragma solidity 0.8.30;
import {IERC20} from "@openzeppelin/contracts/token/ERC20/IERC20.sol";
import {SetsunaUSDCVault} from "./SetsunaUSDCVault.sol";
import {ILendingAdapterV2} from "./ILendingAdapterV2.sol";
import {AaveAdapterDeployer, MorphoAdapterDeployer} from "./SetsunaUSDCFactory.sol";
import {EulerUSDCAdapter} from "./EulerUSDCAdapter.sol";
import {IEulerEarn} from "./EulerMONAdapter.sol";
import {NeverlandUSDCAdapter} from "./NeverlandUSDCAdapter.sol";
import {CurvanceUSDCAdapter, ICurvanceEarn} from "./CurvanceUSDCAdapter.sol";
import {IAaveEarnPool, IAaveEarnData} from "./VenueInterfaces.sol";

contract USDCV2VaultDeployer {
    mapping(address => address) private creators;

    function create(address asset, address guardian) external returns (SetsunaUSDCVault) {
        SetsunaUSDCVault vault = new SetsunaUSDCVault(IERC20(asset), guardian, 25_000e6, 250_000e6);
        creators[address(vault)] = msg.sender;
        return vault;
    }

    function initialize(SetsunaUSDCVault vault, ILendingAdapterV2[] calldata venues) external {
        require(msg.sender == creators[address(vault)]);
        delete creators[address(vault)];
        vault.initialize(venues);
    }
}

contract EulerUSDCDeployer {
    address private immutable factory = msg.sender;

    function create(address vault, address asset, address market) external returns (ILendingAdapterV2) {
        require(msg.sender == factory);
        return ILendingAdapterV2(address(new EulerUSDCAdapter(vault, asset, IEulerEarn(market))));
    }
}

contract NeverlandUSDCDeployer {
    address private immutable factory = msg.sender;

    function create(address vault, address asset, address pool, address data, address receipt)
        external
        returns (ILendingAdapterV2)
    {
        require(msg.sender == factory);
        return ILendingAdapterV2(
            address(
                new NeverlandUSDCAdapter(
                    vault, asset, IAaveEarnPool(pool), IAaveEarnData(data), IERC20(receipt)
                )
            )
        );
    }
}

/// @notice Fixed Monad destinations. aHYPER collateral is a managed strategy, not cash collateral.
contract CurvanceUSDCDeployer {
    address private immutable factory = msg.sender;

    function create(address vault, address asset) external returns (ILendingAdapterV2) {
        require(msg.sender == factory);
        return new CurvanceUSDCAdapter(
            vault,
            asset,
            ICurvanceEarn(0x7f779f7F5316F6164dC5a25422A5ee51504B284A),
            0x1310f352f1389969Ece6741671c4B919523912fF,
            0x27a4fC8aa36d0ae896C85E8a34e80Fa061E8b4c4
        );
    }
}

contract SetsunaUSDCV2Factory {
    USDCV2VaultDeployer private immutable vaultDeployer;
    AaveAdapterDeployer private immutable aaveDeployer = new AaveAdapterDeployer();
    MorphoAdapterDeployer private immutable morphoDeployer = new MorphoAdapterDeployer();
    EulerUSDCDeployer private immutable eulerDeployer = new EulerUSDCDeployer();
    NeverlandUSDCDeployer private immutable neverlandDeployer = new NeverlandUSDCDeployer();
    CurvanceUSDCDeployer private immutable curvanceDeployer = new CurvanceUSDCDeployer();
    address public constant USDC = 0x754704Bc059F8C67012fEd69BC8A327a5aafb603;
    bytes32 public constant MORPHO_MARKET =
        0x9e8441e7af65860feac831ebc117473e3033321abf528ebc8fbde1eeaaa3a626;
    error WrongChain();
    event VaultCreated(address indexed vault, address indexed guardian, address[] adapters);

    // Separate code holder keeps factory initcode below EIP-3860's 49,152-byte limit.
    constructor(USDCV2VaultDeployer vaultDeployer_) {
        // Deployment tooling supplies the verified code holder; this reference cannot be changed.
        require(address(vaultDeployer_).code.length > 0);
        vaultDeployer = vaultDeployer_;
    }

    function createVault() external returns (SetsunaUSDCVault vault) {
        return _createVault(false);
    }

    /// @notice Fresh immutable five-protocol vault. Existing four-protocol vaults are unchanged.
    function createFiveProtocolVault() external returns (SetsunaUSDCVault vault) {
        return _createVault(true);
    }

    function _createVault(bool withCurvance) private returns (SetsunaUSDCVault vault) {
        if (block.chainid != 143 && block.chainid != 31337) {
            revert WrongChain();
        }
        vault = vaultDeployer.create(USDC, msg.sender);
        ILendingAdapterV2[] memory venues = new ILendingAdapterV2[](withCurvance ? 5 : 4);
        venues[0] = ILendingAdapterV2(
            address(
                aaveDeployer.create(
                    address(vault),
                    USDC,
                    0x69a5F9AD4f96ebf0a0C792dD42a01cC5C0102fef,
                    0xB65A68B98274ef7D9a60E0C0747dD1BEc3D32fad,
                    0x35a73BAcb179d3740395A3ceCc87FF2e581d6042
                )
            )
        );
        venues[1] = ILendingAdapterV2(
            address(
                morphoDeployer.create(
                    address(vault), USDC, 0xD5D960E8C380B724a48AC59E2DfF1b2CB4a1eAee, MORPHO_MARKET
                )
            )
        );
        venues[2] = eulerDeployer.create(address(vault), USDC, 0x1905EDDF5943ef6C92Ccf1469bd40fC2cB4A77b0);
        venues[3] = neverlandDeployer.create(
            address(vault),
            USDC,
            0x80F00661b13CC5F6ccd3885bE7b4C9c67545D585,
            0xfd0b6b6F736376F7B99ee989c749007c7757fDba,
            0x38648958836eA88b368b4ac23b86Ad44B0fe7508
        );
        if (withCurvance) {
            venues[4] = curvanceDeployer.create(address(vault), USDC);
        }
        vaultDeployer.initialize(vault, venues);
        address[] memory addresses = new address[](venues.length);
        for (uint256 i; i < venues.length; ++i) {
            addresses[i] = address(venues[i]);
        }
        emit VaultCreated(address(vault), msg.sender, addresses);
    }
}
