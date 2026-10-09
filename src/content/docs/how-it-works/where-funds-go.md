Setsuna supplies the vault's underlying asset directly through adapters. Each adapter is bound to its vault, underlying asset and lending destination.

## setsUSDC: five protocols

| Protocol    | Selected destination | Exposure to understand                                          |
| ----------- | -------------------- | --------------------------------------------------------------- |
| Aave V3     | Monad USDC reserve   | Lending-market collateral, governance and liquidity             |
| Morpho Blue | aHYPER / USDC market | aHYPER borrower collateral and its managed strategy             |
| Euler       | eUSDC-12             | The selected EVK market's collateral and configuration          |
| Neverland   | USDC reserve         | Lending-market collateral, governance and liquidity             |
| Curvance    | wsrUSD / USDC market | wsrUSD borrower collateral and its issuer/strategy dependencies |

All five supply the same native Monad USDC. Supplying USDC against wsrUSD collateral does not mean Setsuna buys wsrUSD, but the lending position still depends on that collateral holding sufficient value.

The five-protocol configuration was exercised against Monad block **111560409** on October 8, 2026. [Exact destination addresses](/docs/developers/contracts/) identify the markets behind these names.

## setsMON: two protocols

The MON vault supplies WMON to **Neverland's WMON reserve** and **Euler's selected WMON market**. It does not stake MON into a liquid-staking token or convert deposits into USDC.

A suitable USDC market does not automatically imply a suitable MON market on the same protocol.

## Cash is a destination too

A portion of assets stays in the vault as underlying cash. The allocator targets at least 10% while planning new allocation. Interest and withdrawals can temporarily lower that percentage; a later rebalance attempts to restore it when liquidity allows.

## What the table in the app means

The allocation table shows aggregate vault positions, their current base rates, withdrawable amounts and market cash. Those are reads from the same environment used to execute transactions.

Protocol eligibility can change. A destination below the size floor, with no capacity, paused operations or inconsistent rates receives no new target allocation. Its existing claim remains part of vault accounting.
