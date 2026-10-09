# Hosted setsMON demo: deployment and recovery

**Codex · 6 October 2026.** Deployment, funding and the executor path are implemented and verified on an isolated local fork. No Tenderly environment or hosted worker has been deployed. This is implementation evidence and a handoff for Claude, not a public-launch claim.

## Implemented and tested

- Deployment of a fresh MON factory/vault/gateway/adapters, Spot gateway, Perpl account factory and faucet, with an operation journal and verified receipts.
- Empty-wallet funding: 101 synthetic MON, 1,000 USDC and 1,000 AUSD. The dispatcher pays gas for the initial claim; funding transfers assets without overwriting existing user balances.
- Onchain faucet limits: one claim per recipient per 24 hours of **demo chain time**, with a permanent budget of 100 claims per deployment. Failed transfers roll back all payouts and quota. Only chain 31337 is supported.
- The private administrator RPC serves only the fixed `claim(recipient)` call from the faucet's immutable dispatcher. Request parameters cannot select amounts, tokens, sender or arbitrary calls. The public RPC still blocks unsigned transactions, impersonation, signing and storage edits.
- Explicit fork support in the Earn executor: validates chain, original fork hash, selected asset, vault/gateway and adapters before signing. Without `--demo-manifest`, it still requires Monad chain 143.
- A separate periodic worker retains the existing signer lock and durable pending-hash/receipt recovery. It stops on errors requiring inspection. Vercel does not run this background loop.

No Earn allocation rule or production vault contract was changed. The faucet is synthetic-fund demo infrastructure, not a production or Sybil-resistant distribution mechanism.

## Environment and deployment

Create a dedicated Monad fork from block `110418863` with chain ID **31337**. Reviewed source hash: `0xed4f56748e560219f9926e46d78591ec746b5bca4497e65d0734062fbb46a97b`.

Put the endpoints in an ignored `.env.hosted-demo` file; never put administrator credentials in chat, client code or a `NEXT_PUBLIC_` variable:

```dotenv
SETSUNA_DEMO_RPC_URL="https://YOUR_RESTRICTED_DEMO_RPC"
SETSUNA_DEMO_ADMIN_RPC_URL="https://YOUR_PRIVATE_ADMIN_RPC"
```

Tenderly documents the setup-only `tenderly_setBalance` and `tenderly_setErc20Balance` methods and administrator `eth_sendTransaction` in its [RPC reference](https://docs.tenderly.co/virtual-environments/admin-rpc). Our hosted funding branch follows that interface but still needs verification against the actual Tenderly service. The completed local proof uses explicitly restricted Anvil equivalents.

Using Node 24+ and Foundry:

```sh
forge build --root contracts
node --env-file=.env.hosted-demo scripts/deploy-hosted-demo.mjs --output .local/hosted-release
node --env-file=.env.hosted-demo scripts/deploy-hosted-demo.mjs --output .local/hosted-release --execute
```

The first Node command checks endpoints without chain writes. The second requires a **new** output directory and generates:

- `manifest.json`: actual contracts, fork identity, faucet address and receipt.
- `deployment-journal.json`: nonces, expected addresses/hashes and confirmation states.
- `keeper.env`: a new dedicated demo signer and RPC, written with owner-only permissions. This is a secret file, not a submission artifact.

The script initializes the vault, funds the executor/dispatcher and seeds the synthetic faucet pool. It stops on uncertain results; inspect the journal before retrying. It does not replace existing deployments silently or accept mainnet IDs. For a reviewed existing manifest without a faucet, use `scripts/deploy-demo-faucet.mjs --manifest PATH --output NEW_PATH --execute` with the same environment variables.

`--local-admin` is only for loopback Anvil verification, not Tenderly. Build all Foundry artifacts, including the script-only fork factory, before deployment.

**Codex update, 7 October:** the deployment script now configures Perpl's explicitly disclosed historical-price fixture. It requires the reviewed source block/hash and synthetic chain 31337, checks both endpoints identify the same fork, then sets the fork-only oracle bypass and the recorded mark of 85,190.5 USD. This is a controlled simulation, not a live BTC oracle. The fixture worker below must run separately; Vercel does not keep it alive.

## App and executor activation

Set Vercel's server-side `SETSUNA_DEMO_RPC_URL`, `SETSUNA_DEMO_ADMIN_RPC_URL` and `SETSUNA_DEMO_MANIFEST` (single-line generated manifest JSON). Redeploy, then inspect `/api/deployment/`: it must return `mode: "demo"`, expected addresses and the app's `/api/rpc/`. A failed contract/network check falls back to preview. Neither administrator credentials nor an unlocked wallet are returned to the browser. Funding appears only for a connected wallet with a configured demo faucet.

Run the executor on a continuously running host with persistent storage:

```sh
node --env-file=.local/hosted-release/keeper.env scripts/earn-keeper-watch.mjs \
  --demo-manifest .local/hosted-release/manifest.json \
  --asset MON --vault ACTUAL_VAULT_ADDRESS \
  --execute --max-gas-price-gwei 200 --max-gas 1500000 \
  --state-dir .local/hosted-release/executor-state
```

Checks run every 15 seconds by default (`EARN_KEEPER_INTERVAL_SECONDS`, allowed 15–300). Contract observations remain at least five minutes apart and rebalances retain their ten-minute cooldown. The worker does not advance time. A fresh vault starts without observations; allocation is not immediate.

The tested MON profile uses a **1,500,000 gas ceiling**: a two-venue rebalance estimate plus the executor's 20% allowance exceeded the older 1,000,000 default. This bound is not a fee guarantee. Keep the dedicated signer funded with synthetic gas and monitor its logs. No continuously running host has been configured yet.

For the disclosed Perps price fixture, on the same persistent worker host:

```sh
node --env-file=.env.hosted-demo scripts/demo-trading-watch.mjs \
  --manifest .local/hosted-release/manifest.json \
  --execute --watch --journal .local/hosted-release/perps-price.json
```

Without `--execute` this checks configuration without writes. The worker refreshes the **same historical price** every 15 seconds; it never imports live prices or advances chain time. It records pending/confirmed operations and refuses restart with an unresolved operation. Inspect its transaction receipt before correcting the journal; never mark an unknown transaction confirmed just to restart. `--local-admin` is only for loopback Anvil tests. It is a demo price refresher, not a production oracle or a Perps protection keeper.

For a local fresh-wallet demo, with the existing source fork running at 18608 and all Foundry artifacts compiled, use `npm run demo:verified`. It clones the source into a separate 18610 fork, deploys fresh contracts, verifies trading and Earn, and keeps the successful app at **http://127.0.0.1:3011/app/** plus its price/Earn workers alive. It refuses occupied ports. The evidence directory contains `services.json` with the PIDs for stopping only those owned processes. `npm run check:journey` runs the same acceptance test and cleans up instead.

## Acceptance and recovery

Before advertising access, use a fresh wallet on the public URL to claim funds, deposit 100 MON, inspect shares/holdings, observe a confirmed executor rebalance, approve shares and withdraw. Check receipts in the hosted explorer. Repeat with a supported wallet/mobile device and verify that unavailable RPC disables transactions. Local automation does not replace these hosted/device checks.

- Preserve executor state. An unresolved `pending` hash must be checked on its exact chain before another action; do not discard it to force a retry. Confirmed pending work is reconciled without a second broadcast.
- A receipt missing the expected vault event remains unresolved. An abnormal exit may leave a `.lock`: confirm no worker is active and inspect pending state before removing only that stale lock. Use one worker per signer and one persistent state directory.
- For lost responses during deployment, inspect the recorded nonce/hash and explorer before resending or starting over.
- Faucet exhaustion returns unavailable. Its 100-claim lifetime cap cannot be reset by adding funds; replacing it requires a new reviewed deployment and manifest update. Address rotation can exhaust a public demo, so monitor the claim budget during judging.
- Do not reset a fork containing judge sessions without making the reset explicit and updating deployment metadata.

## Evidence

`node scripts/check-hosted-journey.mjs` clones the running local trading fork into an owned process, deploys a **fresh** contract set, tests the hosted configuration/restricted proxy, and stops only its own processes. It does not modify the user's running demo.

Latest successful evidence: `.local/hosted-readiness/1791301934881/result.json`, with screenshots and journals beside it. It covers empty-wallet native/token funding; duplicate-claim and invalid input/origin rejection; blocked public administrator methods; executor chain/asset/vault/fork guards; deposit/shares/rebalance/approval/full withdrawal; cleared allowance; restart reconciliation without another broadcast; mobile overflow and RPC-failure handling.

[Portable evidence and source hashes](research/hosted-readiness-2026-10-06.json). App-side changes were deployed to [the public website](https://setsuna-metropolis.vercel.app) on 6 October. Production build passed; the deployed configuration still returns `preview`, unconfigured funding returns 503 and malformed funding input is rejected. This deployment does not activate test transactions.

Six faucet contract tests, twelve Earn executor tests and eleven market/configuration tests passed. TypeScript and the production Next build passed. A browser compatibility fix permits JSON-RPC calls that omit the optional `params` array while preserving the method allowlist.

The 6 October evidence above covers Earn. For the subsequent Spot/Perps work, use the dated [trading completion and iOS handoff](TRADING-COMPLETION.md). No Tenderly deployment, hosted worker uptime, real-fund transaction or physical-iPhone wallet proof is established by these local tests.
