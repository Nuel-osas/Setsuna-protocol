# Setsuna Protocol

Setsuna leads with automated yield vaults on Monad: USDC → `setsUSDC`, MON → `setsMON`. Each independent vault computes bounded lending allocations and permits anyone to trigger a valid rebalance. Spot and Perps are supporting flows; Perpl collateral and protection reserves remain AUSD, separate from Earn.

**Current status — Codex, 9 October 2026:** The public test-fund demo is deployed at **https://setsuna.finance/app/**. Five-protocol setsUSDC, setsMON, Kuru Spot, Perpl and funding share a persistent Railway-hosted Monad fork. Tenderly is no longer a dependency. [Public deployment, acceptance and recovery](docs/PUBLIC-DEMO.md) · [Local reproduction](docs/UNIFIED-DEMO.md).

This is a synthetic-fund fork, chain 31337, with a disclosed historical Perps price. It is not a mainnet launch.

```sh
forge build --root contracts
npm run demo:unified
```

This creates and verifies an isolated synthetic-fund demo, then leaves the app and workers running only after acceptance succeeds. It refuses occupied ports. Documentation is available on the same app at `/docs/`.

**Documentation website:** [Open the public docs](https://setsuna.finance/docs/) or visit `/docs/` on any local website preview. The 22 pages cover user guides, the vault mechanism, calculations, trading and developer setup. [Editing guide and verification](docs/DOCS-SITE.md).

Start with the [documentation index](docs/README.md), [product architecture](docs/ARCHITECTURE-V2.md),
[Earn implementation](docs/EARN.md), and [current build status](docs/BUILD-STATUS.md).

## Run the website preview

Use Node 24+, Foundry and Chrome/Chromium for browser checks.

```sh
npm ci
npm run setup:contracts
npm run dev
```

Open **http://localhost:3000**. `/app/` shows the Earn asset selector; transaction access requires a configured local demo. The `/docs/` site works without a running fork. The five-protocol USDC demo uses separate commands and environment details in [USDC-FIVE.md](docs/USDC-FIVE.md).

## Run Earn, Spot and Perps together

```sh
# Terminal 1: owned fork with synthetic funds and explicit historical Perpl price fixture.
npm run trading:demo

# Terminal 2: the combined app.
npm run dev:trading
```

Open **http://localhost:3008/app/** and choose **Connect → Try the local demo account**.
Use the Earn, Spot and Perps tabs. The fixed-price fixture disables Perpl's oracle guard
only on the local fork; it is not live price data. [Walkthrough and verification](docs/TRADING.md).

## Run the setsMON demo

```sh
# Terminal 1: owned local Monad fork, synthetic MON, contracts and executor.
npm run earn:demo

# Terminal 2: app with the local Earn deployment.
npm run dev:earn
```

Open **http://localhost:3007/app/**. Select **Connect account → Try the local demo account**, deposit MON, then use available shares and withdraw. The app and receipts use the same local fork. [Exact walkthrough and limitations](docs/SETSMON.md).

## Run the local Perpl protection demo

The existing demo provisions the Perpl account and reserve. It does not deploy
the new Earn vault or enable Earn deposits.

```sh

# Terminal 1: deploy, fund, trade and arm a synthetic account on an isolated fork.
npm run demo:local -- --keep --prepare-only

# Terminal 2: serve Setsuna with access to that local demo.
npm run dev:demo
```

Open **http://localhost:3000/app/?tab=trade**, then **Connect account → Try the
local demo account**. Its funded BTC position, reserve and policy come from the
contracts. Execute a top-up, fund/withdraw reserves, change/revoke/re-arm policy,
or use the trading tab. Every write opens a transaction review.

`npm run dev` serves the website without exposing the local demo account. In
that mode wallet/passkey connection works, but public Setsuna contract deployment
is not configured and contract writes are unavailable. No public-chain deployment
or transaction is part of this build.

## Account connection

- Mera 0.2.0: create and recover a passkey-derived EVM account, with signing
  material held only in memory. Same passkey + same hostname + the versioned
  Setsuna PRF salt recover the same account. Use `localhost`, not `127.0.0.1`,
  for local passkey ceremonies. Browser/authenticator WebAuthn PRF support is needed.
- Browser wallets: EIP-6963 discovery and injected EIP-1193 fallback; explicit
  connection and chain switching, with session invalidation on account change.
- Local demo: explicit use of Anvil's public unlocked development account,
  available only with `SETSUNA_LOCAL_DEMO=1`, `SETSUNA_LOCAL_EARN=1` or `SETSUNA_LOCAL_TRADING=1`, a valid local deployment manifest,
  localhost and chain ID 31337. No personal key is read by this flow.

Passkey accounts need their own gas and AUSD before funding contracts. The
prepared demo account already has synthetic funds. Passkeys created on localhost
will not automatically be usable on a different production domain. Native mobile
packaging and physical-device validation remain open work.

## Pages and source

- `/`: Earn landing page with live research rates, allocation illustration and supporting trading explanation.
- `/app/`: Earn; `/app/?tab=spot`: Kuru Spot; `/app/?tab=perps`: Perpl. Legacy `?tab=trade` also opens Perps. Writes require a validated local deployment.
- `/evidence/`: dated Perpl activity research; this is not evidence of Earn adoption or vault performance.
- `/faq/`, `/privacy-policy/`, `/terms-of-use/`: Setsuna preview content.
- `src/components/setsuna/`: Earn research display, account session, transaction review and trading dashboard.
- `src/lib/setsuna/`: reads, formatting, data types and the five-market UI research rule.
- `contracts/src/earn/`: separate USDC/MON vaults, four fixed adapters, a shared allocation rule and native MON gateway.
- `scripts/earn-keeper.mjs`: separate Earn executor, read-only by default.
- `src/styles/setsuna.css`: warm paper, ink and ultramarine; Bricolage Grotesque,
  Instrument Sans and JetBrains Mono.
- `public/` and `brand/`: brand files and local assets. `asset-manifest.json`
  records the earlier reference capture, not a complete inventory of the redesign.

Original DeepBook TSX/CSS/motion and the old browser checker are archived under
ignored `reference/original-nextjs/`. The initial D-j-View capture remains in
`reference/deepbook/`. Reference artwork and fonts retain their original owners
and licenses. Old metrics, Sui links, DeepBook branding and copied legal documents
are not served as Setsuna content. The original migration script is historical;
do not use `--regenerate` on the Setsuna app.

## Verification

```sh
npm run typecheck
npm run build
# With the local fork and dev:demo running:
npm run check:browser

npm run contracts:test
npm run contracts:test:fork
npm run contracts:test:earn
npm run test:keeper
npm run test:earn-keeper
```

`contracts:test` skips fork suites unless `RUN_FORK=true`. To run the full
contract regression with forks, use `RUN_FORK=true npm run contracts:test`.
The latest recorded run passed **74 Solidity tests and 17 executor tests**;
[results, source hashes and scope](docs/research/earn-core-2026-10-02.json).
Those backend results do not establish that the current Earn UI is connected
to a deployed vault. Browser checks remain a separate task.

The browser check snapshots/reverts its local chain changes; run it on a dedicated
local demo, not alongside manual transactions. It uses a virtual PRF authenticator
and local synthetic funds. `CHROME_PATH` and `PREVIEW_URL` override the browser
binary and preview URL. Screenshots and reports are written to `evidence/`.

[Documentation index](docs/README.md) · [Earn guide](docs/EARN.md) ·
[Perpl contract guide](docs/CONTRACTS.md) · [Build status](docs/BUILD-STATUS.md) ·
[Current Claude/Codex architecture log](docs/ARCHITECTURE-V2.md).

## Live release — Codex, 5 October 2026

Public site: https://setsuna.finance. Live Monad market feeds are connected for Kuru Spot and Perpl. The public release is read-only; executable setsMON/Spot/Perps flows remain on the local synthetic-fund fork until the hosted fork is configured. See [deployment status and setup](docs/LIVE-DEPLOYMENT.md). setsUSDC remains a research preview.
