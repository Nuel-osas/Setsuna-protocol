// SPDX-License-Identifier: MIT
pragma solidity 0.8.30;
import {Script, console2} from "forge-std/Script.sol";
import {SetsunaAUSDWrapper} from "../src/earn/SetsunaAUSDWrapper.sol";
import {SetsunaAUSDSaver} from "../src/earn/SetsunaAUSDSaver.sol";

/// Deploys the saver Setsuna's relayer uses to sponsor gas for setsAUSD savers. No owner.
contract MainnetAUSDSaver is Script {
    SetsunaAUSDWrapper constant WRAPPER = SetsunaAUSDWrapper(0x551903E3687820A733FBe406DD33Fee8D12bd2F3);

    function run() external {
        require(block.chainid == 143, "MONAD_MAINNET_ONLY");
        vm.startBroadcast();
        SetsunaAUSDSaver saver = new SetsunaAUSDSaver(WRAPPER);
        vm.stopBroadcast();
        require(address(saver.wrapper()) == address(WRAPPER), "WRAPPER");
        require(address(saver.ausd()) == 0x00000000eFE302BEAA2b3e6e1b18d08D69a9012a, "AUSD");
        console2.log("SetsunaAUSDSaver", address(saver));
    }
}
