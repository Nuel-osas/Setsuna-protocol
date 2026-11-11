The Earn keeper observes a vault and submits its public actions when the contract permits them. It does not supply rates, choose targets or take custody of deposits.

## Read before executing

The CLI is read-only by default. Inspect the deployed mainnet USDC vault:

```sh
node scripts/earn-keeper.mjs \
  --multi --asset USDC \
  --vault 0x0a531817EEFB7b1FFD7c511c0817F58ac343CC67 \
  --rpc https://rpc.monad.xyz
```

The RPC must report chain ID 143. Demo manifests and synthetic-fund execution are no longer supported.

## What the worker checks

The worker verifies network and contract links, inspects observations and cooldowns, simulates the candidate call, and enforces configured gas ceilings before broadcasting.

Execution requires an explicit `--execute` flag, a positive gas-price ceiling and a signer configured through `EARN_KEEPER_PRIVATE_KEY`. Keep the signing key out of browser code and public manifests.

## When it spends gas

The contract decides what a rebalance does; the keeper decides whether it is worth the gas. It prices one full cycle (two rate observations, then the rebalance) at the current gas price, with the gas each call is measured to use: `--observe-gas` and `--rebalance-gas`, defaulting to `--max-gas`.

- **A vault worth less than 20 cycles of gas is left alone.** Nothing is spent on dust.
- **A move that fixes a real limit always goes ahead.** That means a market the contract would force out (disabled, unusable, over its 60% cap or, for USDC, over 10% of the market's cash) or a cash buffer short of 10% by more than `--repair-tolerance-bps` (default 100, which is 1% of the vault).
- **Any other move must pay for itself.** The extra interest it earns over `--horizon-days` (default 90) must be at least `--profit-factor` (default 2) times the cycle's gas. A cash buffer that drifted below 10% only through accrued interest counts as this kind of move.

The MON vault pays gas in its own asset. The USDC vault converts gas to USDC at MON's live price: the Chainlink feed behind Perpl's MON market, else Perpl's mark price, each refused when older than 5 minutes, else a KyberSwap quote for 100 MON. With no price at all, it makes only the limit-fixing moves.

## A persistent process

`earn-keeper-watch.mjs` periodically invokes the one-action keeper. Durable signer locking and pending-transaction state prevent another action from being submitted before an uncertain transaction is reconciled.

A worker with an execution error halts for inspection. Review the saved state and receipt before restarting; do not start multiple independent workers for the same signer without shared locking state.

## Mainnet service

`scripts/start-mainnet-keepers.mjs` supervises a MON keeper and a USDC keeper, with the measured gas of each vault's calls (MON: 650,000 per observation and 1,750,000 per rebalance; USDC: 1,300,000 and 2,300,000). Configure `SETSUNA_MAINNET_EARN`, `MONAD_RPC_URL`, `SETSUNA_MAINNET_MON_KEEPER_PRIVATE_KEY`, `SETSUNA_MAINNET_USDC_KEEPER_PRIVATE_KEY` and `SETSUNA_KEEPER_STATE_DIR` on the worker host only. Each signer needs real MON for gas. Keep the two signing keys distinct and separate from the treasury key.

Use `Dockerfile.keepers` and `railway.json` for hosting. Mount durable storage at the journal directory. `/health` reports process liveness; successful onchain receipts are the evidence of completed observations and rebalances. No Anvil process or chain-state volume is needed.

## Earn and protection are different

The Perpl protection keeper uses a different account policy and fee model. Do not point an Earn worker at the trading account or treat the Earn vault as a protection reserve.
