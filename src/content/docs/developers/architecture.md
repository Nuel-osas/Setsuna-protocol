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

`SetsunaSpot` uses a fixed Kuru route. `SetsunaFactory` creates immutable-owner `SetsunaAccount` instances for Perpl. The account has separate trading-collateral and reserve operations; it is not a general arbitrary-call wallet.

## Verification boundary

The October 8 five-protocol delivery passed 152 Solidity tests, 18 keeper/configuration tests and a signed browser journey. Some tests use fault injection; fork tests use synthetic funding and simulated time. Tests substantiate those scenarios, not an independent audit or production guarantee.

Reproduction and source live in `contracts/`, `scripts/` and the repository's engineering `docs/` directory. Start with [the local demo](/docs/developers/local-demo/).
