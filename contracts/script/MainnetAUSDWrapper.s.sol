// SPDX-License-Identifier: MIT
pragma solidity 0.8.30;
import {Script, console2} from "forge-std/Script.sol";
import {IERC20} from "@openzeppelin/contracts/token/ERC20/IERC20.sol";
import {IERC4626} from "@openzeppelin/contracts/interfaces/IERC4626.sol";
import {SetsunaAUSDWrapper, ICurveStablePool} from "../src/earn/SetsunaAUSDWrapper.sol";

/// Deploys setsAUSD on Monad mainnet: AUSD savings in the live setsUSDC vault through the Curve
/// AUSD/USDC/USDT0 stable pool, with permit on its shares. No owner; nothing to configure after.
contract MainnetAUSDWrapper is Script {
    IERC4626 constant SETS_USDC = IERC4626(0x0a531817EEFB7b1FFD7c511c0817F58ac343CC67);
    ICurveStablePool constant POOL = ICurveStablePool(0x942644106B073E30D72c2C5D7529D5C296ea91ab);
    IERC20 constant AUSD = IERC20(0x00000000eFE302BEAA2b3e6e1b18d08D69a9012a);
    address constant USDC = 0x754704Bc059F8C67012fEd69BC8A327a5aafb603;

    function run() external {
        require(block.chainid == 143, "MONAD_MAINNET_ONLY");
        vm.startBroadcast();
        SetsunaAUSDWrapper wrapper =
            new SetsunaAUSDWrapper(SETS_USDC, POOL, AUSD, 0, 1, "Setsuna AUSD Savings", "setsAUSD");
        vm.stopBroadcast();

        require(address(wrapper.vault()) == address(SETS_USDC), "VAULT");
        require(wrapper.asset() == address(AUSD) && address(wrapper.usdc()) == USDC, "TOKENS");
        require(wrapper.decimals() == 12 && wrapper.totalSupply() == 0, "SHARES");
        console2.log("setsAUSD", address(wrapper));
    }
}
