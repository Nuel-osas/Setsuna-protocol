The implementation separates pooled lending, native-asset handling and trading authority. The user-facing docs describe the current contracts; dated engineering notes in the repository preserve earlier versions and test evidence.

## Earn contracts

| Contract             | Responsibility                                                                       |
| -------------------- | ------------------------------------------------------------------------------------ |
| SetsunaUSDCVault     | ERC-4626 USDC share vault using the multi-destination core                           |
| SetsunaMultiEarnCore | Two to five immutable adapters, accounting, rate observations and bounded allocation |
| SetsunaUSDCV2Factory | Atomic four- or five-protocol vault creation                                         |
| USDCV2VaultDeployer  | Separate vault code holder and creator-bound initialization                          |
| CurvanceUSDCAdapter  | Fixed direct wsrUSD/USDC lending destination with accrual and cash checks            |
| SetsunaMONVault      | Two-destination WMON lending vault                                                   |
| SetsunaMONGateway    | Native MON wrapping, deposit, share redemption and unwrapping                        |

The five-protocol factory entry point is `createFiveProtocolVault()`. The older `createVault()` entry point retains four destinations. Neither modifies an already deployed vault.

## Adapter boundary

```solidity
function totalAssets() external view returns (uint256);
function availableLiquidity() external view returns (uint256);
function depositCapacity() external view returns (uint256);
function supplyApr(int256 delta) external view returns (uint256);
function sync() external returns (uint256);
function deposit(uint256 assets) external;
function withdraw(uint256 assets) external returns (uint256);
```

These are interface excerpts. State-changing adapter functions are restricted to the linked vault. The multi-vault additionally reads `marketSupply()` and `marketLiquidity()` for its eligibility and exposure checks.

## Trading boundary

`SetsunaSpot` uses a fixed Kuru route. The app's market swaps no longer go through it: they are signed straight to KyberSwap's router, and limit orders rest on Kuru through each wallet's account from the Spot limit-order factory. `SetsunaFactory` creates immutable-owner `SetsunaAccount` instances for Perpl. The account has separate trading-collateral and reserve operations; it is not a general arbitrary-call wallet.

## Bridge boundary

`SetsunaBridgeSponsor` lets a relayer pay the Monad gas for a user's CCTP V2 transfer out of Monad. The user signs one EIP-3009 `ReceiveWithAuthorization` on USDC or AUSD with the sponsor as recipient. Its nonce hashes every bridge detail (destination, recipient, fee ceiling, finality, forwarding, swap minimum), so the relayer cannot change any of them. AUSD is swapped to USDC on the Curve pool setsAUSD uses, refusing less than 99.8% of one-for-one, then burned through Circle's `TokenMessengerV2`. The contract has no owner and holds nothing between transfers. See [sponsored bridging](/docs/developers/bridge/).

## Verification boundary

The October 8 five-protocol delivery passed 152 Solidity tests, 18 keeper/configuration tests and a signed browser journey. That historical run included fault injection and fork tests with synthetic funding and simulated time. Those fork suites have since been removed; current contract tests use local mocks, except the bridge sponsor's, which run on a fork of Monad mainnet. Tests substantiate those scenarios, not an independent audit or production guarantee.

Reproduction and source live in `contracts/`, `scripts/` and the repository's engineering `docs/` directory. Start with [local development](/docs/developers/local-demo/).
