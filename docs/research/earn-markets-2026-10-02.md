# Native-USDC lending proof — Monad

> **Codex status note — 2 October 2026:** This is the original five-test discovery
> record. The adapters, vault, allocator and executor have since been implemented;
> see [EARN.md](../EARN.md) and [the later evidence](earn-core-2026-10-02.json).
> The implementation/frontend handoff below is historical: the current UI uses
> five direct research markets, while the factory has two fixed adapters.

**Author: Codex · 2 October 2026.** Response to the user's Earn integration request and Claude's corrected Earn-first plan. **Result: five passing integration tests against two different lending protocols on a pinned mainnet fork.** This establishes venue compatibility for further implementation, not a deployed Setsuna vault or approval to accept public deposits.

## Selected proof destinations

Both destinations use Circle's native Monad USDC, `0x754704Bc059F8C67012fEd69BC8A327a5aafb603`, with six decimals. The address is in [Circle's registry](https://developers.circle.com/stablecoins/usdc-contract-addresses); the decimals and Aave receipt's underlying were checked onchain.

| Detail | Aave V3 | Morpho Blue |
|---|---|---|
| Destination | Direct USDC reserve | Direct USDC lending against WBTC collateral |
| Entry contract | Pool `0x69a5F9AD4f96ebf0a0C792dD42a01cC5C0102fef` | Core `0xD5D960E8C380B724a48AC59E2DfF1b2CB4a1eAee` |
| Position | aUSDC `0x35a73BAcb179d3740395A3ceCc87FF2e581d6042` | Internal supply shares for the market ID below |
| Base supply APR at the pinned state | 4.076725% | Approximately 1.218280%, after accruing interest |
| Liquidity observation | 14,447,374.702276 USDC held by aUSDC | 47,773.640894 USDC market supply minus borrowing, before accrual |
| Routing | Direct supply and withdrawal | Direct supply and withdrawal; no curated vault wrapper |

These rates are a dated snapshot, exclude external reward incentives, and are not promised APYs. Neither cash observation guarantees future liquidity. The selection demonstrates different underlying protocols, not the highest achievable return or independent economic risks.

Morpho market ID:

```text
0xe35c5abc6418b6319b014e07aa3c86163a870a957284128f03cf7a9e414f8899
```

Its complete parameters are:

| Parameter | Value |
|---|---|
| Loan asset | `0x754704Bc059F8C67012fEd69BC8A327a5aafb603` |
| Collateral, WBTC | `0x0555E30da8f98308EdB960aa94C0Db47230d2B9c` |
| Oracle | `0xff07261c87763cc5693ab78746d0b6735Ec626F5` |
| Interest model | `0x09475a3D6eA8c314c592b1a3799bDE044E2F400F` |
| Liquidation loan-to-value | 86% |

The test checks the market ID against the hash of the returned parameters. This market was discovered through Steakhouse's V1 withdrawal queue, but our proof supplies directly to Morpho. It does not inherit Steakhouse's curation, allocation, or performance fee. Setsuna would assume responsibility for market selection and monitoring.

## Reproduce and inspect

[Executable test](../../contracts/test/EarnMarketsFork.t.sol) · [Machine-readable evidence](earn-markets-2026-10-02.json)

| Fork field | Value |
|---|---|
| Chain | Monad mainnet, chain ID `143` |
| Block | `109894238` |
| Block hash | `0x3eecc9010c1283f06368591874bcfeac276ceb12e2920388292053498ce09923` |
| Parent hash | `0x14959d692dfb9ea7b5a5b21287854adc2a95339fbf74ff96f09e4ac9e4d29cac` |
| Block time | `2026-10-02T12:28:58Z` |
| Read-only source | `https://rpc.monad.xyz` |

From the `setsuna` directory, with the existing Foundry dependencies installed:

```sh
cast chain-id --rpc-url https://rpc.monad.xyz
cast block 109894238 --json --rpc-url https://rpc.monad.xyz
RUN_FORK=true MONAD_RPC_URL=https://rpc.monad.xyz forge test --root contracts --match-contract EarnMarketsForkTest -vv
```

Check the chain and block hash against the table. The test additionally asserts chain ID, number, timestamp, and parent hash. An RPC serving the pinned historical state is required. `RUN_FORK=true` is necessary: the suite deliberately skips without it. To capture machine-readable output, append `--json` to the test command. Successful evidence must show **five Success results and no skipped tests**, not merely a zero process exit code.

Each test starts from an independent fork and synthetically funds only the test depositor with 1,000 USDC. Protocol storage, interest models, and lending calls use the actual forked deployments. A Solidity contract owns the receipts, proving that the paths work for a contract depositor. Exact approvals are cleared after supplies. No protocol administrator is impersonated, and no transactions are sent to mainnet. Forge assertions and logs are the evidence; there are no public transaction receipts for these local tests.

| Passing test | Observed outcome |
|---|---|
| Aave supply, partial withdrawal, full exit | Supply 1,000; withdraw 400 and 599.999998 USDC; ending aUSDC balance zero |
| Morpho supply, partial withdrawal, full exit | Supply 1,000; withdraw 400 and 599.999999 USDC; ending supply shares zero |
| Transfer between protocols | 1,000 USDC → Aave → Morpho → 999.999998 USDC; both positions fully closed |
| Rates respond to added supply | Adding 500 USDC to each lowers their respective current base supply rates |
| Interest accounting and full exit | Supply 500 to each, advance fork time seven days, withdraw 500.390916 from Aave and 500.096790 from Morpho |

The one- and two-micro-USDC round-trip differences are observed rounding costs, not hidden test tolerances for material losses. The Aave test also matches the final withdrawal to its actual remaining aToken claim. The seven-day result is **simulated time with no intervening outside trades**; it is not seven days of actual customer yield or a forecast of future earnings. Gas costs are excluded from these balance totals.

## Day-one allocation inputs

Use current protocol state without waiting for weeks of Setsuna history:

- **Aave:** `getReserveData(USDC).liquidityRate` from data provider `0xB65A68B98274ef7D9a60E0C0747dD1BEc3D32fad`. It is an annualized ray-scaled supply rate (`1e27`); reserve-factor effects are already reflected. Do not subtract the reserve factor twice.
- **Morpho:** accrue to the current timestamp, then use the deployed IRM's `borrowRateView`, accrued utilization, and market fee to derive the instantaneous supplier APR. Use a checked expected-accrual view for read-only display, or simulate the actual accrual path. Stored totals alone can omit interest since the last market update.

```text
Aave supply APR fraction = liquidityRate / 1e27
Morpho supply APR fraction ≈ borrowRatePerSecondWad / 1e18
                          × 31,536,000
                          × totalBorrowAssets / totalSupplyAssets
                          × (1 - feeWad / 1e18)
```

Handle empty markets, invalid values, failed calls, and unit conversion explicitly in production adapters. The proof uses a nonempty market. Normalize both inputs to the same APR unit and exclude incentives from the base-rate score. Aave's stored rate and Morpho's accrued rate are observations, not a complete projected-allocation model: simulate the proposed new balances and their rate impact before moving funds.

The test observed Aave APR change from 4.0767246568% to 4.0767004809%, and Morpho from 1.2182798954% to 1.2088423221%, after 500 USDC of additional supply each. Large flows can move rates materially. Rate freshness means a fresh chain state and correct accrual/model evaluation; an old lending-market update timestamp alone does not mean a fresh RPC response is stale.

The contract should enforce eligible destinations, concentration caps, cash buffer, movement limits, cooldown, rate sanity checks, and a deterministic target rule. A public caller can trigger that rule; it must not be able to supply an arbitrary trusted APR. Measure actual share-value performance separately, correcting for deposits, withdrawals, fees, and donations. Short history should display its actual duration rather than imply a stable annual return.

At the snapshot rates, a hypothetical 60% Aave / 30% Morpho / 10% idle portfolio estimates roughly **2.812% base APR before gas**, even before accounting for rate impact. That is below direct Aave's observed rate. Exposure limits and liquid cash have a cost; we cannot promise the best yield merely by adding an allocator.

## Implementation and frontend handoff

1. Build typed Aave and direct-Morpho adapters, then the `setsUSDC` ERC-4626 vault. These tests do not implement share pricing, vault authorization, rebalance validation, or loss handling.
2. Review Aave governance/upgrade and pause powers, reserve supply caps, Morpho collateral/oracle/liquidation risks, liquidity stress, and correlated dependencies before selecting production exposure limits. Both destinations still share native USDC and Monad.
3. The tested Morpho market had about **105,538 USDC supplied**, below `src/lib/setsuna/earn.ts`'s current **$250,000 minimum-size gate**. It is a proof candidate, not automatically eligible under that UI policy. Review that rule or select a larger verified market before deployment; do not silently relax it to make the demo allocate.
4. Claude's current UI reads four curated Morpho vaults through an API and blends their net APYs. Those are different destinations and a different rate basis from this proof. Align the UI's destinations, units, eligibility, weights, and displayed liquidity with the implemented contract before enabling deposits. This snapshot must not become a hardcoded “live” rate or be combined with those unrelated APYs.
5. Show estimated base APR, actual earned return/history duration, and withdrawal capacity separately. A buffer is shared cash, not a reserved amount for every holder. This architecture refreshes all position valuations before redemption; a failed valuation can therefore block even a buffer-sized exit. Either preserve that condition in the claim or explicitly redesign and verify a safe alternative.
6. A public Tenderly demo remains separate work. These tests do not create a persistent Virtual TestNet or establish Kuru/Perpl operation there. `setsMON` remains in the intended Earn family with its own integration gate; Perpl continues to use AUSD.

[Competitive review](earn-competition-2026-10-02.md): the available evidence does not establish that Setsuna's proposed feature combination is unique on Monad.

## Pinned technical sources

Repository revisions establish ABI and deployment provenance; they are not a byte-for-byte audit of every deployed implementation.

- [Monad deployment registry — Aave](https://github.com/monad-crypto/protocols/blob/a9efca6aa04cd17aef089c0a9977d7b607ad272a/mainnet/aave_v3.jsonc) and [Morpho](https://github.com/monad-crypto/protocols/blob/a9efca6aa04cd17aef089c0a9977d7b607ad272a/mainnet/morpho.jsonc).
- [Aave Monad address book](https://github.com/bgd-labs/aave-address-book/blob/f648e5dd3763467b836dfa35484ffe7024e6572a/src/AaveV3Monad.sol), [reserve data provider](https://github.com/aave-dao/aave-v3-origin/blob/8305565ae342f1773c42cd2e4593f175fe5968a0/src/contracts/helpers/AaveProtocolDataProvider.sol), and [rate data types](https://github.com/aave-dao/aave-v3-origin/blob/8305565ae342f1773c42cd2e4593f175fe5968a0/src/contracts/protocol/libraries/types/DataTypes.sol).
- [Morpho market interface](https://github.com/morpho-org/morpho-blue/blob/8e26ca6a8dbc5089edcd67fb576248810fd2870a/src/interfaces/IMorpho.sol), [IRM interface](https://github.com/morpho-org/morpho-blue/blob/8e26ca6a8dbc5089edcd67fb576248810fd2870a/src/interfaces/IIrm.sol), and [core accounting](https://github.com/morpho-org/morpho-blue/blob/8e26ca6a8dbc5089edcd67fb576248810fd2870a/src/Morpho.sol).
