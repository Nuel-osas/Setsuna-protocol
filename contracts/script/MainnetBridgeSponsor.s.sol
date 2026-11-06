// SPDX-License-Identifier: MIT
pragma solidity 0.8.30;
import {Script, console2} from "forge-std/Script.sol";
import {IERC20} from "@openzeppelin/contracts/token/ERC20/IERC20.sol";
import {
    SetsunaBridgeSponsor,
    ICurveStablePool,
    ITokenMessengerV2
} from "../src/bridge/SetsunaBridgeSponsor.sol";

/// Deploys the sponsor Setsuna's relayer uses to bridge USDC and AUSD out of Monad on a signature. No owner.
/// Addresses: USDC and Circle's TokenMessengerV2 from Circle's CCTP V2 chain list (Bridge Kit's Monad
/// definition; the messenger is the same address on every CCTP V2 EVM chain and reports
/// MessageTransmitterV2 0x81D4…4B64 as its local transmitter). AUSD and the Curve pool are the ones
/// SetsunaAUSDWrapper already uses (coins 0 and 1, checked again by the constructor).
contract MainnetBridgeSponsor is Script {
    IERC20 constant USDC = IERC20(0x754704Bc059F8C67012fEd69BC8A327a5aafb603);
    IERC20 constant AUSD = IERC20(0x00000000eFE302BEAA2b3e6e1b18d08D69a9012a);
    ICurveStablePool constant POOL = ICurveStablePool(0x942644106B073E30D72c2C5D7529D5C296ea91ab);
    ITokenMessengerV2 constant MESSENGER = ITokenMessengerV2(0x28b5a0e9C621a5BadaA536219b3a228C8168cf5d);

    function run() external {
        require(block.chainid == 143, "MONAD_MAINNET_ONLY");
        vm.startBroadcast();
        SetsunaBridgeSponsor sponsor = new SetsunaBridgeSponsor(USDC, AUSD, POOL, 0, 1, MESSENGER);
        vm.stopBroadcast();
        require(address(sponsor.usdc()) == address(USDC), "USDC");
        require(address(sponsor.ausd()) == address(AUSD), "AUSD");
        require(address(sponsor.tokenMessenger()) == address(MESSENGER), "MESSENGER");
        console2.log("SetsunaBridgeSponsor", address(sponsor));
    }
}
