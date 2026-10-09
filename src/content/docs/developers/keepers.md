The Earn keeper observes a vault and submits its public actions when the contract permits them. It does not supply rates, choose targets or take custody of deposits.

## Read before executing

The CLI is read-only by default. To inspect a locally running five-protocol USDC vault, substitute the vault address from its manifest:

```sh
node scripts/earn-keeper.mjs \
  --multi --asset USDC \
  --vault YOUR_LOCAL_VAULT_ADDRESS \
  --rpc http://127.0.0.1:18613 \
  --demo-manifest .local/setsusdc-five/demo.json
```

The placeholder is intentional. Use the actual address from your own deployment. Omitting the demo manifest selects the production-chain validation path, which requires chain ID 143.

## What the worker checks

The worker verifies network and contract links, inspects observations and cooldowns, simulates the candidate call, and enforces configured gas ceilings before broadcasting.

Execution requires an explicit `--execute` flag, a positive gas-price ceiling and a signer configured through `EARN_KEEPER_PRIVATE_KEY`. Keep the signing key out of browser code and public manifests.

## A persistent process

`earn-keeper-watch.mjs` periodically invokes the one-action keeper. Durable signer locking and pending-transaction state prevent another action from being submitted before an uncertain transaction is reconciled.

A worker with an execution error halts for inspection. Review the saved state and receipt before restarting; do not start multiple independent workers for the same signer without shared locking state.

## Local demo setup

`npm run usdc:demo:five` creates and funds a dedicated synthetic-fund executor on its owned local fork, then starts the watcher. No production wallet key is needed for that launcher.

An automatic cash-buffer repair was confirmed in the October 8 demo across all five destinations. That record establishes local execution. On October 9, separate MON and USDC workers were also deployed alongside the public Railway fork. They retain the same observation intervals, cooldowns and transaction journals. The hosted demo stops on an unresolved worker failure so its operator can inspect receipts before restarting.

## Earn and protection are different

The Perpl protection keeper uses a different account policy and fee model. Do not point an Earn worker at the trading account or treat the Earn vault as a protection reserve.
