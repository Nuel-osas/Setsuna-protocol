# Public Setsuna demo

> **Local UI update — Codex, 9 October:** the unified SAM-style Earn card is available at http://127.0.0.1:3018/app/. Select MON or USDC in its asset dropdown; use Deposit/Withdraw and Max. The user explicitly said not to push, so the production release and screenshots described below still use the previous interface. See [build status](BUILD-STATUS.md) for local verification.

**Codex implementation · 9 October 2026.** This is Codex's delivery and handoff for Emmanuel and Claude; it does not record Claude's approval.

The public application uses an Anvil fork hosted on Railway, with persistent storage and its own MON, USDC and historical-price workers. Tenderly entitlement is no longer a deployment dependency.

- Application: https://setsuna.finance/app/
- Documentation: https://setsuna.finance/docs/
- Fork explorer: https://setsuna-workers-production.up.railway.app/
- Service health: https://setsuna-workers-production.up.railway.app/health

**Domain update — Codex, 9 October:** Emmanuel linked `setsuna.finance` to the project. HTTPS, the app, the current Evidence page, same-origin RPC, both Earn decision views and the existing-recipient faucet cooldown were verified. Google and Cloudflare DNS returned `76.76.21.21`; this machine's OS lookup was still stale, so those browser/HTTPS checks used that verified address explicitly with normal certificate validation. The Vercel hostname remains a fallback. Mera credentials are scoped to the hostname: a passkey made on the Vercel domain does not automatically recover on `setsuna.finance`. Existing recording and test evidence retain their actual origins.

## Try the product

Open the app, connect a browser wallet and select **Get test funds**. The faucet provides **101 MON, 1,000 USDC and 1,000 AUSD** with no monetary value. Accept the Setsuna demo network, chain **31337**, when the wallet requests it. The onchain faucet limits repeat claims and has a total budget of 100 claims.

Earn offers separate MON → setsMON and USDC → setsUSDC deposits. Use available shares to withdraw. Spot swaps MON/USDC through Kuru. Perps creates a Setsuna account, uses AUSD for the trading balance, and supports BTC long/short trades and closing/withdrawing. Earn shares do not automatically fund trades.

## Environment and boundaries

The source is Monad mainnet, chain 143, block **111560409**, hash `0xc8a3dcf05b4b35daf91e0abc74bc91ebc2ec45830d93a8f2b6451cff8214a84b`. All user transactions settle on the separate synthetic-fund fork. This is not a mainnet launch or a measurement of Monad's production performance.

USDC integrates Aave, Morpho aHYPER/USDC, Euler eUSDC12, Neverland and Curvance wsrUSD/USDC. MON integrates Neverland and Euler WMON. The allocation engine retains its existing caps, market eligibility, five-minute observation interval and ten-minute rebalance cooldown. Deposits may remain idle until a permitted rebalance. Withdrawals depend on liquidity; the shared cash buffer does not guarantee an exit.

Perps uses a **fixed historical BTC mark of $82,964.20**, with a disclosed fork-only oracle guard bypass. The worker refreshes the fixture timestamp; it does not stream live BTC prices. Historical Kuru liquidity and lending state evolve through this fork's activity, not external mainnet transactions. Time-based lending interest may accrue as the fork clock advances; it is not evidence of live mainnet returns.

## Deployed services

| Component | Deployment |
|---|---|
| Railway project | `aaff010d-31bf-4867-a0fc-59cfb2901534` |
| Railway service | `setsuna-workers`, `de9dd037-d25f-4157-8d63-a5b94ef568f8` |
| Railway release | `35a65b95-0465-4514-af14-156dc05ce2d9` |
| Persistent volume | `0c77e333-301f-49e7-bd3a-12eabc24ab15`, mounted at `/data` |
| Vercel release | `dpl_Ec7X4yrufj5mz2t48LYgtpD5M3z2` |
| MON vault | `0x114255d235bA6EfF3b0F6b6498035c62F1A62a7F` |
| USDC vault | `0x55EcE31A7fC5f99460a1F3970d60Dd701B7E8021` |

`/api/deployment/` supplies verified public contract addresses and the same-origin `/api/rpc/`. Server credentials are not published. Vercel holds the actual cloud manifest and two private URLs: ordinary restricted RPC and a separate bounded faucet relay. The legacy variable name `SETSUNA_DEMO_ADMIN_RPC_URL` now refers to that faucet relay, **not** a general administrator endpoint. It only permits the configured faucet's `claim(address)` transaction from its dispatcher. General administrative RPC remains inside the Railway container on loopback.

After a partial Earn withdrawal, action refreshes now finish before background polling can replace them. Withdrawal validation also checks current available USDC shares before asking the wallet to sign. The public test exposed and reproduced this stale-balance race; the vault rejected the oversized attempt before broadcast.

The Spot display now reads Kuru’s bounded `getL2Book(16,16)` overload. The previous unbounded book scan timed out against the cold hosted fork and stalled worker requests. A bounded read returned 2,112 bytes in 423 ms on the hosted service. Both preview and demo displays request only the levels they can render.

The image uses Node 24 and Anvil 1.5.1. One service replica owns the fork and all three workers. `Dockerfile.demo` is configured directly through Railway's environment settings. `/health` indicates node/supervisor readiness; it does not prove that every rebalance is profitable or recently successful. Railway usage and storage incur hosting charges; the service is not described as free or a fixed $5 total.

## Persistence and recovery

The gateway serializes mutations, waits for mined receipts and writes a coherent fork snapshot before acknowledging successful writes. Snapshot replacement uses file and directory fsync. Contracts, balances, nonces, receipts and events persist in `/data/setsuna/chain-state.json`; deployment records and separate keeper keys/journals live beside it. On restart the supervisor restores that state and a monotonic clock before resuming workers. It refuses incomplete bootstrap state rather than silently deploying replacement contracts.

Restart policy is intentionally **NEVER**: a failed worker shuts down the group and retains evidence for inspection. If health fails, inspect the service logs and pending transaction receipts before restarting. This single-service setup is not highly available. Persistent storage is not an independent off-service backup.

```sh
railway service status --json
railway logs --deployment --lines 80
# After inspecting pending receipts and resolving the cause:
railway restart --service setsuna-workers --yes
```

Never delete the persistent volume, clear bootstrap files, reset the chain or replace the manifest to recover from an uncertain transaction. Keep one replica so signers and fork state have one writer. If an update changes a runtime input, prepare a new bundle and redeploy against the same volume. Do not upload `.local`, private environment files, keys or browser profiles.

```sh
node scripts/prepare-anvil-demo-bundle.mjs --output .local/railway-anvil-NEXT
railway up .local/railway-anvil-NEXT/source --path-as-root --project aaff010d-31bf-4867-a0fc-59cfb2901534 --environment production --service setsuna-workers --detach
```

The deployed bundle is `.local/railway-anvil-release-2026-10-09-v4/source`, containing 27 explicitly selected runtime inputs plus generated ignore files. Fresh bootstrap and forced-crash preservation of user balances, shares, nonces and receipts passed on the v2 package and the serialized-RPC v3 package. A subsequent crash during an unacknowledged keeper broadcast correctly stopped workers for reconciliation; user-state preservation is not a guarantee of unattended worker recovery. The v4 package also releases stale process locks at supervisor startup while retaining pending transaction journals. Its Linux image built and restored the existing cloud volume successfully.

## Acceptance and remaining work

**Web submission update — Codex, 9 October:** both Earn views now expose the contract's allocation preview, recorded rate inputs, target versus next-move amounts and explicit refusal reasons. Custom-error decoding distinguishes cooldowns from unavailable reads; the MON rebalance control now uses the same preview/gain checks as USDC. The minimum gain and cooldown are read from each deployed vault. Events link to the fork explorer. Seven focused decision checks, eight public browser scenarios (including clearly controlled RPC-response fixtures), TypeScript and the production builds passed. Four updated documentation/research pages and the [public judge guide](https://setsuna.finance/evidence/) passed their mobile/rendering/link checks. These read-only checks did not repeat the original 25 signed transactions below. [Current review evidence](research/web-submission-2026-10-09.json).

The public evidence page preserves earlier Perpl research as historical context and distinguishes it from Earn demand. Downloadable acceptance records and a new [rule-refusal proof](research/earn-rule-proof-2026-10-09.json) are available there. Recorded successful rebalances were verified; independent current-state simulations for both vaults returned `CooldownActive` without a broadcast or state override.

**Passed on 9 October:** the public fresh-wallet journey completed **25 signed transactions and 23 checks**, including funding, both Spot directions, Perps long/short and partial/full closes, full AUSD/reserve withdrawal, MON deposit/full withdrawal, and USDC partial/full withdrawal. Receipt recovery, exact allowances, mobile layouts, RPC failure/recovery and explorer access passed. There were no browser runtime errors. All 25 transactions have successful receipts. The browser evidence is `.local/public-demo/1791552592937/result.json`; [portable evidence](research/public-demo-2026-10-09.json).

**Cloud restart also passed:** a different Anvil process restored the same contract manifest, both test wallets’ native/token balances and shares, their nonces, and all 25 receipts with identical block hashes and events. The clock remained monotonic and all three workers returned healthy. Evidence: `.local/cloud-persistence-result.json`; reproduction: `node scripts/check-railway-persistence.mjs --execute`. This is a verified graceful cloud restart, separate from the local hard-crash tests.

The same run included actual hosted keeper allocation between user actions; no administrator calls or artificial clock changes were used. Thirty-four configuration, market, faucet, executor and receipt tests passed on Node 24. TypeScript and the Vercel production build passed. All 22 public documentation pages passed link, search, clipboard, theme, desktop and mobile browser checks with no runtime errors.

Public browser acceptance is recorded with `scripts/check-public-demo.mjs`. It uses a fresh injected EIP-1193 test wallet and actual signatures through the public Vercel RPC; it does not expose administrator methods or artificially advance the hosted clock. This is distinct from testing a real wallet extension or physical device.

```sh
node scripts/check-public-demo.mjs https://setsuna.finance
```

Earlier local evidence remains in [the unified demo guide](UNIFIED-DEMO.md), including 25 signed transactions, all-five USDC allocation, cooldown rejection and executor receipt reconciliation. Contract tests were not rerun for this hosting and frontend change; the 152-test Solidity result remains dated 8 October.

The cloud fork also contains a disclosed demonstration account with 10 MON and 100 USDC supplied through normal signed transactions. Its address is `0x2670C7589E783f10C0Cc3930681bFbBCf4105165`; the key is kept in ignored owner-only local storage. Other automated test balances may remain on the fork. These are synthetic fixtures, not customer deposits or traction. Workers allocate them over ordinary elapsed time without bypassing observation or cooldown rules. All-five destination funding was proven in the separate local test with disclosed time advancement; do not describe that local scenario as instant public allocation.

The deployment build reports two dependency audit findings: Next.js 16.3.6 and transitive source-map-js 1.2.1. These were recorded, not resolved or represented as an independent security review in this hosting change. A patch-version dependency update and validation remain maintenance work before a production release.

Remaining submission work includes a concise recorded walkthrough, independent users and real wallet/device checks, organizer confirmation of fork-only eligibility and sponsor requirements, and keeping the service funded/available through judging. Envio indexing, a realized-performance ledger and independent security review remain unfinished. Hosting success does not establish product-market fit or guarantee a prize.

**User-confirmed scope update — Codex, 9 October:** the native iOS application is deliberately out of scope for this hackathon. Focus on the web product, an understandable Earn allocation demonstration and submission evidence. Mera and mobile-browser checks remain in scope; Agora's acceptance of mobile web and the private fork remains unconfirmed. [Current completion plan](HACKATHON-COMPLETION.md#current-scope-and-next-work--codex-9-october).

**Recorded workflow:** [captioned web demo](../brand/video/setsuna-web-demo-2026-10-09/Setsuna-Web-Demo.mp4), with [recording proof](../brand/video/setsuna-web-demo-2026-10-09/recording-proof.json). A fresh synthetic wallet approved and deposited 100 USDC, then redeemed all shares in three successful signed transactions. The video shows Spot/Perps screens without making additional trades. It was recorded on the Vercel hostname and ends with the newly verified `setsuna.finance` address. This is silent, captioned footage using an explicitly identified automated signing wallet, not a real-extension or phone test.

**Claude handoff:** review the public Earn story against the actual manifest and receipts. Preserve the test-fund, historical-price and withdrawal disclosures. Do not present Tenderly activation as the current blocker, or the Railway fork as Monad mainnet. Attribute any subsequent review or changes separately.
