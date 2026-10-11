// SPDX-License-Identifier: MIT
pragma solidity 0.8.30;
import {Script, console2} from "forge-std/Script.sol";
import {SetsunaUSDCV2Factory, USDCV2VaultDeployer} from "../src/earn/SetsunaUSDCV2Factory.sol";
import {SetsunaUSDCVault} from "../src/earn/SetsunaUSDCVault.sol";
import {SetsunaMONFactory} from "../src/earn/SetsunaMONFactory.sol";
import {SetsunaMONVault} from "../src/earn/SetsunaMONVault.sol";
import {SetsunaMONGateway} from "../src/earn/SetsunaMONGateway.sol";

/// Deploys capped Earn vaults to Monad mainnet: five-protocol setsUSDC (Aave,
/// Morpho, Euler, Neverland, Curvance; 2,000 USDC cap) and setsMON (Neverland,
/// Euler; the factory's fixed 25,000 MON cap). The broadcaster becomes the guardian, which
/// can only pause deposits or disable a destination; it cannot move funds.
/// SETSUNA_TREASURY receives 2% of yield and can never change.
contract MainnetEarn is Script {
    address constant USDC = 0x754704Bc059F8C67012fEd69BC8A327a5aafb603;
    uint256 constant EARN_FEE_BPS = 200; // 2% of yield, never principal
    uint256 constant DEPOSIT_CAP = 2_000e6; // capped beta: unaudited contracts

    function run() external {
        require(block.chainid == 143 || vm.envOr("SETSUNA_REHEARSAL", false), "MONAD_MAINNET_ONLY");
        address treasury = vm.envAddress("SETSUNA_TREASURY");
        require(treasury != address(0), "TREASURY_REQUIRED");
        vm.startBroadcast();
        USDCV2VaultDeployer holder = new USDCV2VaultDeployer(treasury, EARN_FEE_BPS, DEPOSIT_CAP);
        SetsunaUSDCV2Factory factory = new SetsunaUSDCV2Factory(holder);
        SetsunaUSDCVault vault = factory.createFiveProtocolVault();
        SetsunaMONFactory monFactory = new SetsunaMONFactory(treasury, EARN_FEE_BPS);
        (SetsunaMONVault monVault, SetsunaMONGateway gateway) = monFactory.createVault();
        vm.stopBroadcast();

        require(vault.asset() == USDC, "VAULT_ASSET");
        require(vault.depositCap() == DEPOSIT_CAP, "VAULT_CAP");
        require(vault.feeRecipient() == treasury && vault.performanceFeeBps() == EARN_FEE_BPS, "VAULT_FEE");
        require(address(vault.adapters(4)) != address(0), "VAULT_DESTINATIONS");
        require(monVault.asset() == monFactory.WMON(), "MON_ASSET");
        require(monVault.feeRecipient() == treasury && monVault.performanceFeeBps() == EARN_FEE_BPS, "MON_FEE");
        require(address(monVault.adapters(1)) != address(0), "MON_DESTINATIONS");

        console2.log("setsUSDC", address(vault));
        console2.log("setsMON", address(monVault));
        string memory key = "mainnet-earn";
        vm.serializeUint(key, "chainId", block.chainid);
        vm.serializeUint(key, "deployedAtBlock", block.number);
        vm.serializeAddress(key, "vault", address(vault));
        vm.serializeAddress(key, "factory", address(factory));
        vm.serializeAddress(key, "vaultDeployer", address(holder));
        vm.serializeAddress(key, "asset", USDC);
        vm.serializeAddress(key, "treasury", treasury);
        vm.serializeUint(key, "depositCap", DEPOSIT_CAP);
        vm.serializeAddress(key, "monVault", address(monVault));
        vm.serializeAddress(key, "monGateway", address(gateway));
        vm.serializeAddress(key, "monFactory", address(monFactory));
        vm.serializeAddress(key, "monNeverland", address(monVault.adapters(0)));
        vm.serializeAddress(key, "monEuler", address(monVault.adapters(1)));
        vm.serializeUint(key, "monDepositCap", monVault.depositCap());
        string memory data = vm.serializeUint(key, "performanceFeeBps", EARN_FEE_BPS);
        vm.writeJson(data, vm.envOr("SETSUNA_DEPLOY_OUT", string("../.local/mainnet-earn/deployed.json")));
    }
}
