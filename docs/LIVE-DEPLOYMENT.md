# Setsuna live deployment

**Current deployment — Codex, 9 October 2026:** the active demo uses a Railway-hosted Anvil fork, persistent storage, bounded faucet and three workers. The public app is https://setsuna-metropolis.vercel.app/app/. [Current deployment, proof and recovery](PUBLIC-DEMO.md) supersedes the preview-only status and Tenderly dependency in the dated notes below.

Author: **Codex** · 5 October 2026. Implementation handoff for Claude and Emmanuel.

**Update — Codex, 7 October:** [Spot/Perps fresh-wallet completion](TRADING-COMPLETION.md) passed on an isolated local deployment through the restricted proxy. Deployment now configures the disclosed Perpl historical-price fixture and has a separate guarded price worker. The executable local app is at 3011; the public site's `preview` boundary remains in force until Tenderly and hosted workers are configured.

**Update — Codex, 6 October:** deployment automation, a bounded demo faucet/API/UI and explicit hosted-fork executor are implemented and tested on an isolated local fork. [Current runbook](HOSTED-DEMO-RUNBOOK.md). This supersedes earlier statements below that no faucet implementation exists. Tenderly deployment, hosted executor operation and public activation remain incomplete; the public release is still a market preview.

## Current release

Public URL: **https://setsuna-metropolis.vercel.app**. The public release is a **market preview**. It displays live Monad mainnet data without accepting deposits or trades. The local combined demo at `http://localhost:3008/app/` executes setsMON, Kuru Spot and Perpl transactions with synthetic funds. These environments are deliberately separate.

- Kuru MON/USDC: resting order book, cumulative depth and historical closing prices at 15m/1h/4h intervals.
- Perpl BTC/AUSD: mark, real order book and historical candles at 15m/1h/4h intervals.
- Public reads need no wallet. Wallet connection uses the existing injected wallet or Mera passkey flow. Contract actions remain unavailable without a verified demo deployment.
- setsMON deposits, withdrawals, allocations and local executor work on the local fork.
- **setsUSDC is still a research preview. Its deposit button is not connected to a deployed vault.** It must not be described as available.

Local market refresh is 8 seconds. Public snapshot refresh is also 8 seconds, with a 5-second server cache; history refresh is 30 seconds. This is polling, not a WebSocket stream. Mainnet books are never used as execution data for the fork.

## Market sources and data handling

Perpl's [official API documentation](https://github.com/PerplFoundation/api-docs) supplies the public context, book, ticker and candle interfaces. Price and size decimals come from BTC's market config. Book and ticker timestamps older than two minutes are rejected. Mainnet contract identity comes from the verified Monad network configuration.

Kuru depth is read at one block through `getMarketParams()` and `getL2Book()`; the packed book block must match the requested block. The format follows the [official Kuru SDK](https://github.com/Kuru-Labs/kuru-sdk/blob/main/src/market/orderBook.ts). Depth excludes AMM liquidity and is not an executable swap quote.

Kuru chart history comes from its application's `api.kuru.io/api/v2/<market>/trades/history` endpoint. This interface is observed from the official application, not a versioned SDK guarantee. Several real responses on 5 October had open values outside the supplied high/low range. We preserve their supplied closes and show a **closing-price line**, rather than invent OHLC values. Perpl's validated OHLC series is rendered as candles.

Feed failures clear the displayed book and mark. Chart errors are shown separately. Local-fork charts remain session observations; the Perpl historical fixture remains explicitly labeled.

## Vercel

The CLI is linked to `nues-projects-a2cec4ad/setsuna-metropolis`. Node 24, Next.js server routes, and `npm ci` are configured. `.vercelignore` excludes `.local`, environment files, captured sites, brand source material, contract broadcasts and build artifacts. No RPC administrator credential, wallet private key or unlocked account is shipped to browsers.

```sh
npm run test:markets
npm run typecheck
npm run build
vercel deploy --prod --yes --scope nues-projects-a2cec4ad
```

No environment variables are required for the read-only release. See `.env.example` for remote demo settings.

## Hosted test-fund trading

**Still required: a hosted Monad fork, deployed contracts, synthetic wallet funding and a running executor.** There is no Tenderly testnet or credential configured in this workspace. Vercel hosts the app, not the blockchain or continuously running keeper.

Use a dedicated Tenderly Virtual Environment fork of Monad. The existing fork deployment scripts require **chain ID 31337** and are explicitly unsuitable for mainnet. The pinned, proven local source is block `110418863`. Do not publish local Anvil's unrestricted RPC or unlocked accounts. Tenderly's [administrator methods](https://docs.tenderly.co/virtual-environments/admin-rpc) allow impersonation and arbitrary state changes; keep that endpoint private.

Configure server-only variables:

- `SETSUNA_DEMO_RPC_URL`: the HTTPS upstream RPC for the dedicated fork. Prefer the restricted/public Tenderly endpoint. It is never returned by the deployment API.
- `SETSUNA_DEMO_MANIFEST`: a single-line JSON object containing the actual addresses deployed on that fork:

```json
{
  "mode": "HOSTED_FORK_ONLY",
  "syntheticFunding": true,
  "forkChainId": 143,
  "chainId": 31337,
  "forkBlock": "110418863",
  "startBlock": "ACTUAL_DEPLOYMENT_BLOCK",
  "perplFactory": "DEPLOYED_PERPL_FACTORY",
  "spotGateway": "DEPLOYED_SPOT_GATEWAY",
  "vault": "DEPLOYED_SETSMON_VAULT",
  "gateway": "DEPLOYED_MON_GATEWAY",
  "neverland": "DEPLOYED_NEVERLAND_ADAPTER",
  "euler": "DEPLOYED_EULER_ADAPTER"
}
```

These are placeholders, not deployable addresses. Do not copy `.local/trading/demo.json` addresses onto a different chain: a manifest does not deploy contracts. If the fork uses the same fixed Perpl fixture, include `perplFixture` with its actual `mode`, `markPNS` and `oracleGuardDisabledOnFork`; the app will disclose it. A hosted fixture refresher and Earn executor still need to be deployed and tested.

`/api/deployment/` verifies the chain ID and onchain links for the MON vault/gateway/adapters, Spot market/USDC, and Perpl exchange/collateral/market before advertising writes. Invalid or unavailable configurations fall back to the read-only preview. Mainnet IDs are rejected by demo configuration.

The browser receives only the app's `/api/rpc/` endpoint. That endpoint allows ordinary reads and signed raw transactions. It rejects `eth_sendTransaction`, account impersonation, signing, state edits and other administrator methods, including inside mixed batches. It checks the upstream chain on each request. The local unlocked demo wallet is never available in hosted mode. Visitors must connect their own wallet/passkey and receive synthetic assets on the fork. **A public faucet is not implemented in this release.**

After configuring the hosted fork, verify with a fresh wallet: fund synthetic MON/USDC/AUSD; deposit/redeem setsMON; swap both directions; create/fund a Perpl account; open/close a BTC position; withdraw AUSD; execute a vault rebalance with the independent keeper; inspect all receipts in the hosted explorer. None of this is claimed complete on Tenderly yet.

## Validation recorded by Codex

- `npm run test:markets`: nine decoder, numeric scaling, malformed-series and demo/RPC restriction tests pass.
- `npm run check:trading`: real synthetic-fund browser flows for Spot, Perps and setsMON pass, including unresolved receipt recovery.
- `node scripts/check-live-markets.mjs`: actual upstream data, history intervals, mobile layouts and feed-failure clearing pass.
- `node scripts/check-hosted-config.mjs`: validates the hosted configuration path against the actual local deployment; reads through the proxy succeed and unsigned/admin methods are rejected. This validates application plumbing, **not Tenderly deployment**.
- Production build and TypeScript pass on the Mac and Vercel Node 24.
- The same market browser checks pass against the public Vercel URL. All marketing/app pages, the favicon and deployment API return successfully, including `/evidence/`.

Evidence: `.local/live-wiring/review/`, `.local/trading-terminal/`, and existing trading browser reports. Screenshots are local artifacts, not public production evidence.
