The Earn keeper observes a vault and submits its public actions when the contract permits them. It does not supply rates, choose targets or take custody of deposits.

## Read before executing

The CLI is read-only by default. Inspect the deployed mainnet USDC vault:

```sh
node scripts/earn-keeper.mjs \
  --multi --asset USDC \
  --vault 0xAA5366660c3dDb3400f7083F21196Db125d6a2E7 \
  --rpc https://rpc.monad.xyz
```

The RPC must report chain ID 143. Demo manifests and synthetic-fund execution are no longer supported.

## What the worker checks

The worker verifies network and contract links, inspects observations and cooldowns, simulates the candidate call, and enforces configured gas ceilings before broadcasting.

Execution requires an explicit `--execute` flag, a positive gas-price ceiling and a signer configured through `EARN_KEEPER_PRIVATE_KEY`. Keep the signing key out of browser code and public manifests.

## A persistent process

`earn-keeper-watch.mjs` periodically invokes the one-action keeper. Durable signer locking and pending-transaction state prevent another action from being submitted before an uncertain transaction is reconciled.

A worker with an execution error halts for inspection. Review the saved state and receipt before restarting; do not start multiple independent workers for the same signer without shared locking state.

## Mainnet service

`scripts/start-mainnet-keepers.mjs` supervises a MON keeper and a USDC keeper. Configure `SETSUNA_MAINNET_EARN`, `MONAD_RPC_URL`, `SETSUNA_MAINNET_MON_KEEPER_PRIVATE_KEY`, `SETSUNA_MAINNET_USDC_KEEPER_PRIVATE_KEY` and `SETSUNA_KEEPER_STATE_DIR` on the worker host only. Each signer needs real MON for gas. Keep the two signing keys distinct and separate from the treasury key.

Use `Dockerfile.keepers` and `railway.json` for hosting. Mount durable storage at the journal directory. `/health` reports process liveness; successful onchain receipts are the evidence of completed observations and rebalances. No Anvil process or chain-state volume is needed.

## Earn and protection are different

The Perpl protection keeper uses a different account policy and fee model. Do not point an Earn worker at the trading account or treat the Earn vault as a protection reserve.
