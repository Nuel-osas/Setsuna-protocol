// SPDX-License-Identifier: MIT
pragma solidity 0.8.30;

import {IERC20} from "@openzeppelin/contracts/token/ERC20/IERC20.sol";
import {SetsunaMONVault} from "./SetsunaMONVault.sol";
import {SetsunaMONGateway} from "./SetsunaMONGateway.sol";
import {NeverlandMONAdapter} from "./NeverlandMONAdapter.sol";
import {EulerMONAdapter, IEulerEarn} from "./EulerMONAdapter.sol";
import {ILendingAdapter} from "./ILendingAdapter.sol";
import {IAaveEarnPool, IAaveEarnData} from "./VenueInterfaces.sol";

contract MONVaultDeployer {
    address private immutable factory = msg.sender;

    function create(IERC20 asset, address guardian) external returns (SetsunaMONVault) {
        require(msg.sender == factory);
        return new SetsunaMONVault(asset, guardian, 25_000 ether, 250_000 ether);
    }

    function initialize(SetsunaMONVault vault, ILendingAdapter[2] calldata venues) external {
        require(msg.sender == factory);
        vault.initialize(venues);
    }
}

contract MONAdapterDeployer {
    address private immutable factory = msg.sender;

    function neverland(address vault, address asset, address pool, address data, address receipt)
        external
        returns (ILendingAdapter)
    {
        require(msg.sender == factory);
        return
            new NeverlandMONAdapter(vault, asset, IAaveEarnPool(pool), IAaveEarnData(data), IERC20(receipt));
    }

    function euler(address vault, address asset, address market) external returns (ILendingAdapter) {
        require(msg.sender == factory);
        return new EulerMONAdapter(vault, asset, IEulerEarn(market));
    }
}

/// @notice Immutable Monad WMON venues, 25k MON deposit cap and 250k MON market floor.
/// @dev Amounts are MON units, not USD equivalents. Every deployment is initialized atomically.
contract SetsunaMONFactory {
    address public constant WMON = 0x3bd359C1119dA7Da1D913D1C4D2B7c461115433A;
    address public constant NEVERLAND = 0x80F00661b13CC5F6ccd3885bE7b4C9c67545D585;
    address public constant NEVERLAND_DATA = 0xfd0b6b6F736376F7B99ee989c749007c7757fDba;
    address public constant N_WMON = 0xD0fd2Cf7F6CEff4F96B1161F5E995D5843326154;
    address public constant EULER_WMON = 0x7B4BcAEAC5Eb67ae947903F24BBa660eE06A5231;
    MONVaultDeployer private immutable _vaultDeployer;
    MONAdapterDeployer private immutable _adapterDeployer;
    error WrongChain();
    event VaultCreated(
        address indexed vault,
        address indexed guardian,
        address gateway,
        address neverlandAdapter,
        address eulerAdapter
    );

    constructor() {
        _vaultDeployer = new MONVaultDeployer();
        _adapterDeployer = new MONAdapterDeployer();
    }

    function _checkChain() internal view virtual {
        if (block.chainid != 143) {
            revert WrongChain();
        }
    }

    function createVault() external returns (SetsunaMONVault vault, SetsunaMONGateway gateway) {
        _checkChain();
        vault = _vaultDeployer.create(IERC20(WMON), msg.sender);
        ILendingAdapter[2] memory venues;
        venues[0] = _adapterDeployer.neverland(address(vault), WMON, NEVERLAND, NEVERLAND_DATA, N_WMON);
        venues[1] = _adapterDeployer.euler(address(vault), WMON, EULER_WMON);
        _vaultDeployer.initialize(vault, venues);
        gateway = new SetsunaMONGateway(vault);
        emit VaultCreated(
            address(vault), msg.sender, address(gateway), address(venues[0]), address(venues[1])
        );
    }
}
