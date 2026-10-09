// SPDX-License-Identifier: MIT
pragma solidity 0.8.30;

import {Script} from "forge-std/Script.sol";
import {IERC20} from "@openzeppelin/contracts/token/ERC20/IERC20.sol";
import {IPerplExchange as E} from "../src/interfaces/IPerplExchange.sol";
import {SetsunaAccount} from "../src/SetsunaAccount.sol";
import {SetsunaFactory} from "../src/SetsunaFactory.sol";

/// @notice Only invoked by scripts/local-demo.mjs against the Anvil instance it starts.
contract LocalDemo is Script {
    E constant VENUE = E(0x34B6552d57a35a1D042CcAe1951BD1C370112a6F);
    IERC20 constant AUSD = IERC20(0x00000000eFE302BEAA2b3e6e1b18d08D69a9012a);

    function run() external {
        require(block.chainid == 31337, "LOCAL DEMO ONLY");
        address trader = vm.envAddress("DEMO_OWNER");
        // The Node launcher prepares synthetic AUSD on its owned local node before this simulation.
        require(AUSD.balanceOf(trader) == 10_000e6, "AUSD fixture layout changed");

        vm.startBroadcast(trader);
        SetsunaFactory factory = new SetsunaFactory(VENUE, AUSD, 1);
        SetsunaAccount account = SetsunaAccount(factory.createAccount());
        AUSD.approve(address(account), 1_200e6);
        account.initialize(1_000e6);
        account.fundReserve(200e6);
        E.PerpetualInfo memory market = VENUE.getPerpetualInfo(1);
        E.OrderDesc memory order;
        order.perpId = 1;
        order.orderType = 0;
        order.pricePNS = market.basePricePNS + market.minAskPriceONS + 100;
        order.lotLNS = 1_000;
        order.immediateOrCancel = true;
        order.maxMatches = 30;
        order.leverageHdths = 1_000;
        order.maxNegPnlCollatBPS = 100;
        account.executeOrder(order);
        account.armPolicy(
            SetsunaAccount.PolicyConfig({
                capCNS: 100e6,
                minTopUpCNS: 1e6,
                feeMaxCNS: 1e6,
                triggerBufferBps: 20_000,
                targetBufferBps: 30_000,
                feeBps: 100,
                maxMarkAgeSec: 60
            })
        );
        vm.stopBroadcast();

        string memory key = "demo";
        vm.serializeAddress(key, "owner", trader);
        vm.serializeAddress(key, "factory", address(factory));
        vm.serializeAddress(key, "account", address(account));
        vm.serializeAddress(key, "exchange", address(VENUE));
        vm.serializeAddress(key, "collateral", address(AUSD));
        vm.serializeUint(key, "chainId", 31337);
        string memory result = vm.serializeUint(key, "forkBlock", 108749101);
        vm.writeJson(result, "../.local/demo.json");
    }
}
