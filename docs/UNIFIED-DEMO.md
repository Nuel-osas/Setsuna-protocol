# Unified Setsuna demo and hosted release

**Codex · 9 October 2026.** The hosted release now uses a persistent Railway Anvil fork and Vercel. Tenderly is no longer required. See [the current public deployment, acceptance and recovery guide](PUBLIC-DEMO.md). This document preserves the combined local reproduction and earlier Tenderly/worker-only setup. No Claude approval is implied.

## One environment

The `--unified` deployment creates setsMON (Neverland/Euler), setsUSDC (Aave/Morpho/Euler/Neverland/Curvance), Kuru MON/USDC Spot, Perpl BTC/AUSD accounts and a bounded test faucet on one Monad fork. Both Earn vaults retain their existing rules and receipt tokens. The combined manifest rejects Earn entries from different source blocks.

The pinned source is Monad block **111560409**, hash `0xc8a3dcf05b4b35daf91e0abc74bc91ebc2ec45830d93a8f2b6451cff8214a84b`. Read-only source verification on 9 October found Perpl BTC mark `829642` (82,964.2 USD), timestamp `1791447488`. The fixture uses that historical mark and a disclosed fork-only oracle bypass. It does not fetch live BTC prices. The earlier block/price profile remains available to older demos.

```sh
forge build --root contracts
npm run demo:unified
```

This starts an isolated fork on **18614**, deploys fresh contracts, runs the fresh-wallet acceptance checks and, only on success, leaves the app at **http://127.0.0.1:3016/app/** with MON/USDC executors and a price worker. It refuses occupied ports and does not reset other demos. `npm run check:unified` runs acceptance and then stops its owned services instead.

The runner uses Chrome at the installed macOS path and Node 24+. It records a unique directory under `.local/unified-demo/`; `latest.json` points to the latest successful run. `services.json` records owned PIDs. Old successful deployments are not overwritten. Reconnect the browser wallet after a full reload; signing sessions are held in memory.

Choose **Browser wallet**, claim test funds, and switch between Earn, Spot and Perps without changing environments. The public RPC proxy exposes ordinary reads and signed transactions; administrator methods and unlocked accounts remain blocked. Acceptance advances time on its owned fork to exercise observation intervals and cooldowns; running workers do not advance time.

## Earlier Tenderly option — superseded by Railway

The account findings below remain historical evidence. This setup is optional; the active fork runs on Railway.

**Codex account check · 9 October:** authenticated browser access is now established. The current account's Virtual Environments page offers **“Contact us for Console”** and no Create control. Billing confirms **Free**, simulations not included, monthly requests `0 / 0`, and **no network entitlements**. The Metropolis benefit is not active on this account. No hosted fork was created, no paid upgrade was purchased, and no support message was sent. The current dependency is sponsor entitlement activation; logging in again will not resolve it. [Observed account state](research/tenderly-entitlement-2026-10-09.json).

Suggested request for Emmanuel to send through the Metropolis participant/support channel:

> We are building Setsuna for the Monad Metropolis hackathon. How do we activate the advertised Tenderly Pro benefit? Our Tenderly account currently shows Free, no network entitlements, and “Contact us for Console” under Virtual Environments. We need a Monad Mainnet fork with ordinary/Admin RPC access and a public explorer for judging.

Claim the Metropolis Tenderly benefit before purchasing a plan. The local hackathon brief records complimentary Pro access for teams; account activation, duration and usage entitlement still need confirmation. Tenderly's [current general pricing](https://tenderly.co/pricing) describes ordinary Free as browser-only without API access, so a generic Free account is not evidence of hosted-fork entitlement. Worker hosting is separate.

**Dashboard setup:** open [Tenderly](https://dashboard.tenderly.co/), select the project, then **Virtual Environments → Create Virtual Environment** (formerly Virtual TestNets). Name it `setsuna-metropolis-demo`, choose Monad Mainnet as the parent network, and use the pinned source block below. Set the custom chain ID to `31337`, disable state sync, and enable the public explorer. Copy both the ordinary RPC and the separate Admin RPC into the local file; never use the admin endpoint as the browser RPC. [Current Tenderly quickstart](https://docs.tenderly.co/virtual-environments/quickstart) · [Admin RPC reference](https://docs.tenderly.co/virtual-environments/admin-rpc).

Create a dedicated Monad fork from the pinned block with chain ID **31337**. Keep state sync off for this reviewed snapshot. Put its endpoints in ignored `.env.hosted-demo`:

```dotenv
SETSUNA_DEMO_RPC_URL="https://RESTRICTED_OR_PUBLIC_FORK_RPC"
SETSUNA_DEMO_ADMIN_RPC_URL="https://PRIVATE_ADMIN_FORK_RPC"
SETSUNA_DEMO_EXPLORER_URL="https://PUBLIC_FORK_EXPLORER"
```

Run the read-only preflight, then deploy to a **new** output directory:

```sh
node --env-file=.env.hosted-demo scripts/deploy-hosted-demo.mjs --unified --output .local/hosted-unified
node --env-file=.env.hosted-demo scripts/deploy-hosted-demo.mjs --unified --output .local/hosted-unified --execute
node --env-file=.env.hosted-demo scripts/prepare-demo-workers.mjs --deployment .local/hosted-unified --output .env.workers
```

The generated manifest contains the actual shared-chain addresses. `keeper.env` and `usdc-keeper.env` hold **different** funded executor keys, avoiding nonce contention. `.env.workers` combines the private worker configuration with owner-only file permissions; the preparation command refuses existing output paths. Do not publish those files or place keys in Vercel/client variables.

Setup validates both RPC endpoints, the source hash and chain ID. Deployments record pending nonces/addresses before broadcast and confirmed receipts afterward. Inspect journals after uncertain outcomes before resuming. Tenderly administrator-method behavior still needs verification against the actual service; local acceptance uses loopback-only Anvil equivalents.

## Earlier worker-only hosting plan

The active deployment now includes Anvil, the RPC gateway, explorer and workers in one `Dockerfile.demo` service with a persistent volume. Use [PUBLIC-DEMO.md](PUBLIC-DEMO.md) for current settings. The worker-only preparation below predates that deployment.

`Dockerfile.workers` uses Node 24. `.dockerignore` limits the build context to runtime source, dependencies and public ABIs, excluding environment files and local state. `railway.workers.json` records the intended settings, but the new service uses settings applied directly through Railway's environment API. Railway now [deprecates Config as Code for new services](https://docs.railway.com/config-as-code); do not depend on that JSON file being selected or applied. The image must still be built on an available Docker engine/host.

**Codex hosting update · 9 October:** Railway login is confirmed. Project [setsuna-metropolis](https://railway.com/project/aaff010d-31bf-4867-a0fc-59cfb2901534) and its empty `setsuna-workers` service are created and linked locally. The production environment is `a5fc46c3-b9d4-453b-b2c9-31ac3b358f32`; service ID is `de9dd037-d25f-4157-8d63-a5b94ef568f8`. Read-back confirmed `DOCKERFILE`, `Dockerfile.workers`, `/health`, a 120-second health timeout, restart policy `NEVER`, and one replica in `us-west2`. Only non-secret `NODE_ENV`, `PORT` and `SETSUNA_WORKER_STATE_DIR` are configured. Vercel CLI access was authenticated earlier.

Tenderly's RPC and explorer fields remain empty in owner-only `.env.hosted-demo`. No source upload, image build, active deployment or persistent volume exists on Railway yet. After the hosted-chain deployment and worker preflight succeed, attach a persistent volume at `/data`, privately import the generated `.env.workers`, and deploy the worker source. `SETSUNA_WORKER_STATE_DIR=/data/setsuna` is already set, but that variable alone does not provision storage. Keep one replica to avoid concurrent writers using the same signers.

CLI note for automation: Railway 4.27.4 prioritizes piped stdin over `--service-config`, even when stdin is empty. Send a JSON environment patch through stdin and verify the saved configuration; a zero exit code with `No changes to apply` does not mean settings were changed. Never print imported keys or RPC secrets.

```sh
# Read-only network, vault, funded-signer and price-fixture checks:
node --env-file=.env.workers scripts/start-demo-workers.mjs
# Run all three workers:
node --env-file=.env.workers scripts/start-demo-workers.mjs --execute
```

The supervisor gives each Earn worker only its own signer and no admin RPC. Only the fixed-price worker receives the admin endpoint. MON has a 1.5-million gas ceiling; USDC has a 3.5-million ceiling. Each signer has separate durable receipt state. `/health` reports process liveness only, not successful rebalancing. A child failure shuts down the group and preserves journals; inspect receipts before restarting. A state directory cannot silently switch deployments.

Railway setup references: [environment configuration](https://docs.railway.com/cli/environment), [persistent volumes](https://docs.railway.com/volumes). The empty service has no running worker or volume; hosted acceptance remains pending.

### Worker upload package

**Codex · 9 October follow-up:** `scripts/prepare-demo-worker-bundle.mjs` creates a new directory containing only 18 explicit runtime inputs, including the Dockerfile, dependency lockfile, worker modules and required public ABIs. It refuses existing destinations and checks the copied source hashes. The manifest remains outside the upload directory. Private environment files, deployment journals, browser assets and research data are excluded by construction.

```sh
node scripts/prepare-demo-worker-bundle.mjs --output .local/railway-workers-2026-10-09
```

This package already exists locally. Its supervisor passed read-only preflight on Node 24 against the existing local fork: reviewed source, both vaults, distinct funded signers and the historical price fixture. That check did not start extra workers, modify the fork or build a Linux image.

After Tenderly deployment, persistent-volume attachment and private worker-variable import, upload the prepared source directory:

```sh
railway up .local/railway-workers-2026-10-09/source --path-as-root --project aaff010d-31bf-4867-a0fc-59cfb2901534 --environment production --service setsuna-workers --detach
```

Regenerate into a new directory if runtime source changes. As of this follow-up the package has not been uploaded, and all Tenderly endpoint fields remain empty.

## Demo environment and eligibility

**Codex · 9 October:** a fork is a demonstration choice, not a universal requirement for winning. [Mantle Vault's ETHGlobal submission](https://ethglobal.com/showcase/mantle-vault-yzns7) records public-testnet deployments and a Mantle pool prize. This is evidence that prize-winning DeFi projects can use public testnets; it does not establish Metropolis eligibility.

Setsuna uses a hosted fork to exercise the integrated Monad contracts with synthetic balances. Disclose its pinned source block, historical Perps price fixture and fork-only overrides. It establishes functional integration in that environment, not production yield, real user traction or native Monad settlement-performance measurements.

The [public Metropolis FAQ](https://www.monad.xyz/metropolis), checked on 9 October, asks for a working product, demo, write-up and code link, and directs eligibility restrictions to the application platform. It does not specify fork/testnet/mainnet deployment in the public page. The [application portal](https://hackathon.monad.xyz/) requires authentication. Acceptance of a fork-only submission and each sponsor bounty's network requirements therefore remain unverified; do not describe the hosted fork as sufficient proof of those requirements.

## Web activation and acceptance

Current hosted results are recorded in [PUBLIC-DEMO.md](PUBLIC-DEMO.md). The local results below retain their original scope.

Set only the shared manifest and RPC variables on Vercel, redeploy, and check `/api/deployment/` reports `demo`, both Earn vaults, Spot, Perpl, the faucet and the restricted `/api/rpc/`. Vercel does not run the continuous workers. Publish the current public explorer URL with the manifest.

Repeat the complete fresh-wallet journey against that public environment, including a real supported wallet/device, funding, both Earn exits, Spot both ways, Perps open/close and full AUSD withdrawal. Verify executor receipts and recovery on the hosted chain and keep the environment available for judging. Local evidence does not establish this step.

Funding recovery now retains a submitted-but-unconfirmed hash, checks the configured faucet's event for the same recipient, and resumes after reload/reconnection. It never resends the claim while that hash is unresolved. A successful transaction without the expected event is not described as funded.

## Verification record

**Passed on 9 October:** the combined acceptance runner completed 25 signed user transactions, including the existing trading and MON journey, five actual USDC positions, exact approval, signed USDC rebalancing, cooldown rejection without fund movement, restart reconciliation without another broadcast, partial/full redemption and mobile RPC failure/recovery. `scripts/check-funding-recovery.mjs` passed a deliberately withheld funding confirmation and reload with exactly one claim request. Twenty-seven configuration/executor/receipt tests passed on Node 24. TypeScript and the production build passed.

The worker supervisor passed read-only preflight, startup, confirmed MON/USDC/price receipts, graceful shutdown and restart with preserved state on Node 24. Its local health endpoint is on port 3017. The worker image has not been built because the local Docker daemon is unavailable. Local worker execution does not establish hosted uptime.

[Portable proof and source hashes](research/unified-demo-2026-10-09.json). Raw evidence: `.local/unified-demo/1791542463431/`. This run is the current app at port 3016.

Contract source was not modified for this integration. Existing 152-test contract results remain dated evidence from 8 October; they are not relabeled as a new run.
