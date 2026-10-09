# Native-USDC lending proof, part 2 — Euler, Neverland, Morpho aHYPER

**Author: Claude · 2 October 2026.** Extends Codex's
[two-protocol proof](earn-markets-2026-10-02.md) so setsUSDC has enough eligible
destinations for its caps to stop forcing idle cash.

## Result

Each destination: synthetic 1,000 USDC (impersonating Aave's aUSDC on the fork),
deposit, advance 7 days, withdraw everything. Every transaction is checked for
`status 1`; any revert aborts the run with a trace.

| Destination | Contract | Deposited | Withdrew after 7 simulated days | Annualised | Position after exit |
|---|---|---|---|---|---|
| Euler eUSDC-12 (governed perspective) | `0x1905EDDF5943ef6C92Ccf1469bd40fC2cB4A77b0` | 1,000.000000 | 1,001.204262 | 6.28% | 0 shares |
| Neverland USDC (Aave V3 fork) | Pool `0x80F00661b13CC5F6ccd3885bE7b4C9c67545D585` | 1,000.000000 | 1,000.345699 | 1.80% | 0 aToken |
| Morpho Blue aHYPER/USDC | market `0x9e8441e7…a626` | 1,000.000000 | 1,001.486408 | 7.75% | 0 shares |

Fork: Monad mainnet, chain 143, block `109905890`, hash
`0xff6af8a28b59b7086a8c116bbd315e19e0acc6a92ca3c3da78fa58b4a8214907`, upstream
`rpc-mainnet.monadinfra.com`. Simulated time with no outside trades; not a forecast.

Reproduce: `PORT=18605 scripts/research/earn_fork_probe.sh` (local anvil only).

## Findings that matter for the adapters

- **Gas estimation under-shoots Euler deposits.** With estimated gas the EVK
  deposit reverted `ReentrancySentryOOG`; with an explicit 1,500,000 limit it
  succeeded (~163k used). Production adapters and keepers must not rely on
  `eth_estimateGas` for EVK calls through the EVC.
- **aHYPER is the share token of "Hyperithm Delta Neutral Vault"** (USDC-denominated,
  ~84M supply). Lending into this market is a dependency on that one strategy.
  The UI states the collateral.
- **Thin cash at high utilisation.** Euler eUSDC-12 had $433k withdrawable against
  $5.8M supplied (92.6% utilisation); Morpho aHYPER $4.2M against $38.3M.
  Fine for a hackathon-size pool; the vault's per-destination exposure should
  also be bounded by withdrawable cash, as section 6.5 already proposes.
- **Curvance cUSDC is not eligible:** `totalAssets` ≈ 707 USDC at read time.

**Codex follow-up, 8 October 2026:** The Curvance observation above concerns one market, not protocol-wide eligibility. A fresh enumeration of all 27 registry market managers found seven USDC markets, four above the unchanged 250,000-USDC floor. All four passed contract-depositor fork round trips. TownSquare's direct USDC flow also passed but its pool remained below the floor. See [native protocol screening](../USDC-V2.md#native-protocol-screening--codex-8-october-2026) and [the complete evidence](native-usdc-screen-2026-10-08.json). This is Codex's attributed follow-up, not a change to Claude's historical measurements.

## Live reading after adding them (block 109906235)

Aave 4.08% · Euler 6.29% · Morpho aHYPER 7.78% · Neverland 1.80% · Morpho WBTC 1.10%
(below $250k, skipped). Split by the UI rule: 18.4 / 28.4 / 35.1 / 8.1 / 0, cash
10%. **Blended 5.41% base APR**, above Aave alone.
