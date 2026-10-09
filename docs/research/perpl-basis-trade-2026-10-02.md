# Perpl basis-trade boilerplate — notes

**Author: Claude · 2 October 2026.** Repo shared in the hackathon Discord as
"a useful boilerplate from the team" for Perpl builders:
https://github.com/8ball030/perpl_basis_trade (MIT, created 2 Oct 2026, Solidity
contract + Rust executor). Read: README, `BasisTrader.sol`, `BasisMath.sol`,
`executor/src/strategy.rs`. Not run.

## What it is

Cash-and-carry: buy spot on Kuru, short the matching Perpl perp, in one
transaction, gated on realised edge net of fees. Markets: BTC (perp 1, cbBTC),
ETH (perp 20, WETH), MON (perp 10).

## Facts it reports from a mainnet fork (theirs, not re-verified)

- No tradeable AUSD book on Kuru: three AUSD/USDC books disabled or empty. **Spot
  must trade in USDC**; AUSD stays as Perpl margin.
- Thin depth: cbBTC/USDC and WETH/USDC fill $1,000, fail at $5,000; Perpl BTC
  bid ≈ 0.004 BTC near touch.
- "The live basis almost never pays"; the demo manufactures a dislocation.
- Perpl: `execOrder` needs no signature (`msg.sender` is the account);
  `whitelistingEnabled()` false; taker 345 ppm, maker 45 ppm; short entry price
  = `pricePNS + priceResiduePNSQ16 / 2**16`.
- Kuru Router `0xd651346d7c789536ebf06dc72aE3C8502cd695CC`, MarginAccount
  `0x2A68ba1833cDf93fa9Da1EEbd7F46242aD8E90c5`, books listed in its README.

## Relevance to Setsuna

1. **Not an Earn yield fix.** Rarely positive basis and $1–5k depth cannot carry
   pooled USDC. Do not add it as a setsUSDC destination.
2. **It names Setsuna's protection as its gap.** README "Known limits": margin is
   not managed automatically. Source check: `topUpPosition(perpId, amountCNS)` is
   `onlyKeeper` with **no cap, no trigger, no lifecycle binding**; nothing watches
   maintenance margin. A short perp leg is exactly what a price spike liquidates.
3. **Spot reference for Codex:** router call shape, addresses and the USDC-only
   finding save Stage 1 discovery for Kuru.
4. **Bounty crowding:** a team-endorsed bot template means many Perpl-API entries
   will be forks of it. Differentiation: protecting such positions, not running
   another basis bot.
