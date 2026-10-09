// SPDX-License-Identifier: MIT
pragma solidity 0.8.30;
import {Script} from "forge-std/Script.sol";
import {IERC20} from "@openzeppelin/contracts/token/ERC20/IERC20.sol";
import {SetsunaFactory} from "../src/SetsunaFactory.sol";
import {IPerplExchange} from "../src/interfaces/IPerplExchange.sol";
import {SetsunaSpot, IKuruSpotMarket} from "../src/spot/SetsunaSpot.sol";

contract LocalTradingDemo is Script {
    function run() external {
        require(block.chainid == 31337, "LOCAL_FORK_ONLY");
        address owner = vm.envAddress("DEMO_OWNER");
        address market = 0x065C9d28E428A0db40191a54d33d5b7c71a9C394;
        address usdc = 0x754704Bc059F8C67012fEd69BC8A327a5aafb603;
        vm.startBroadcast(owner);
        SetsunaFactory factory = new SetsunaFactory(
            IPerplExchange(0x34B6552d57a35a1D042CcAe1951BD1C370112a6F),
            IERC20(0x00000000eFE302BEAA2b3e6e1b18d08D69a9012a), 1
        );
        SetsunaSpot spot = new SetsunaSpot(IKuruSpotMarket(market), IERC20(usdc));
        vm.stopBroadcast();
        string memory key = "trading-demo";
        vm.serializeAddress(key, "perplFactory", address(factory));
        vm.serializeAddress(key, "spotGateway", address(spot));
        vm.serializeAddress(key, "spotMarket", market);
        string memory data = vm.serializeAddress(key, "usdc", usdc);
        vm.writeJson(data, "../.local/trading/deployed.json");
    }
}
