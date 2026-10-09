// SPDX-License-Identifier: MIT
pragma solidity 0.8.30;

import {Script} from "forge-std/Script.sol";
import {SetsunaMONFactory} from "../src/earn/SetsunaMONFactory.sol";
import {SetsunaMONVault} from "../src/earn/SetsunaMONVault.sol";
import {SetsunaMONGateway} from "../src/earn/SetsunaMONGateway.sol";

/// @dev Script-only fork factory. The production factory still requires chain 143.
contract LocalMONFactory is SetsunaMONFactory {
    function _checkChain() internal view override {
        if (block.chainid != 31337) {
            revert WrongChain();
        }
    }
}

contract LocalEarnDemo is Script {
    function run() external {
        require(block.chainid == 31337, "LOCAL_FORK_ONLY");
        address owner = vm.envAddress("DEMO_OWNER");
        vm.startBroadcast(owner);
        LocalMONFactory factory = new LocalMONFactory();
        (SetsunaMONVault vault, SetsunaMONGateway gateway) = factory.createVault();
        vm.stopBroadcast();
        string memory key = "setsmon-demo";
        vm.serializeAddress(key, "factory", address(factory));
        vm.serializeAddress(key, "vault", address(vault));
        vm.serializeAddress(key, "gateway", address(gateway));
        vm.serializeAddress(key, "asset", factory.WMON());
        vm.serializeAddress(key, "owner", owner);
        vm.serializeAddress(key, "neverland", address(vault.adapters(0)));
        string memory data = vm.serializeAddress(key, "euler", address(vault.adapters(1)));
        vm.writeJson(data, "../.local/setsmon/deployed.json");
    }
}
