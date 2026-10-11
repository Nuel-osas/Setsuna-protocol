// SPDX-License-Identifier: MIT
pragma solidity 0.8.30;
import {Script, console2} from "forge-std/Script.sol";
import {IERC20} from "@openzeppelin/contracts/token/ERC20/IERC20.sol";
import {SetsunaFactory} from "../src/SetsunaFactory.sol";
import {IPerplExchange} from "../src/interfaces/IPerplExchange.sol";
import {SetsunaSpot, IKuruSpotMarket} from "../src/spot/SetsunaSpot.sol";

import {SetsunaSpotOrders, IKuruLimitMarket, IKuruMargin} from "../src/spot/SetsunaSpotOrders.sol";

/// Deploys the Spot gateway (Kuru MON/USDC) and the Perps account factory
/// (Perpl BTC) to Monad mainnet, including the Spot order-account factory.
/// Factories and gateways have no mutable admin:
/// every address is fixed at construction and checked again after deployment.
/// Earn is not deployed here; it stays on the hosted mainnet fork.
/// SETSUNA_TREASURY is required: it receives the fixed fees and can never change.

contract MainnetTrading is Script {
    address constant KURU_MON_USDC = 0x065C9d28E428A0db40191a54d33d5b7c71a9C394;
    address constant USDC = 0x754704Bc059F8C67012fEd69BC8A327a5aafb603;
    address constant PERPL_EXCHANGE = 0x34B6552d57a35a1D042CcAe1951BD1C370112a6F;
    address constant AUSD = 0x00000000eFE302BEAA2b3e6e1b18d08D69a9012a;
    uint256 constant BTC_PERP = 1;
    uint256 constant SPOT_FEE_BPS = 10; // 0.10% of each swap's output
    uint256 constant PERPS_PROTECTION_FEE_BPS = 100; // 1% of each margin top-up

    function run() external {
        require(block.chainid == 143, "MONAD_MAINNET_ONLY");
        for (uint256 i; i < 4; ++i) {
            address venue = [KURU_MON_USDC, USDC, PERPL_EXCHANGE, AUSD][i];
            require(venue.code.length > 0, "VENUE_HAS_NO_CODE");
        }
        address treasury = vm.envAddress("SETSUNA_TREASURY");
        require(treasury != address(0), "TREASURY_REQUIRED");
        vm.startBroadcast();
        SetsunaFactory factory = new SetsunaFactory(
            IPerplExchange(PERPL_EXCHANGE), IERC20(AUSD), BTC_PERP, treasury, PERPS_PROTECTION_FEE_BPS
        );
        SetsunaSpot spot =
            new SetsunaSpot(IKuruSpotMarket(KURU_MON_USDC), IERC20(USDC), treasury, SPOT_FEE_BPS);
        SetsunaSpotOrders orders = new SetsunaSpotOrders(
            IKuruLimitMarket(KURU_MON_USDC),
            IKuruMargin(0x2A68ba1833cDf93fa9Da1EEbd7F46242aD8E90c5),
            IERC20(USDC)
        );
        vm.stopBroadcast();

        require(address(factory.exchange()) == PERPL_EXCHANGE, "FACTORY_EXCHANGE");
        require(address(factory.collateral()) == AUSD, "FACTORY_COLLATERAL");
        require(factory.perpId() == BTC_PERP, "FACTORY_PERP");
        require(address(spot.market()) == KURU_MON_USDC, "SPOT_MARKET");
        require(address(spot.usdc()) == USDC, "SPOT_USDC");
        require(
            factory.protocolFeeRecipient() == treasury
                && factory.protocolFeeBps() == PERPS_PROTECTION_FEE_BPS,
            "FACTORY_FEE"
        );
        require(spot.feeRecipient() == treasury && spot.feeBps() == SPOT_FEE_BPS, "SPOT_FEE");

        console2.log("SetsunaFactory", address(factory));
        console2.log("SetsunaSpot", address(spot));
        string memory key = "mainnet-trading";
        vm.serializeUint(key, "chainId", block.chainid);
        vm.serializeUint(key, "deployedAtBlock", block.number);
        vm.serializeAddress(key, "perplFactory", address(factory));
        vm.serializeAddress(key, "spotGateway", address(spot));
        vm.serializeAddress(key, "spotMarket", KURU_MON_USDC);
        vm.serializeAddress(key, "spotOrdersFactory", address(orders));
        vm.serializeAddress(key, "usdc", USDC);
        vm.serializeAddress(key, "exchange", PERPL_EXCHANGE);
        vm.serializeAddress(key, "treasury", treasury);
        vm.serializeUint(key, "spotFeeBps", SPOT_FEE_BPS);
        vm.serializeUint(key, "perpsProtectionFeeBps", PERPS_PROTECTION_FEE_BPS);
        string memory data = vm.serializeAddress(key, "collateral", AUSD);
        vm.writeJson(data, vm.envOr("SETSUNA_DEPLOY_OUT", string("../.local/mainnet-trading/deployed.json")));
    }
}
