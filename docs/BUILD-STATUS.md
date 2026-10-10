# Setsuna build status

## Portfolio balances and wallet icons — Codex, 11 October 2026 — local only

The Portfolio headline cards now show wallet balances, with deposits shown
separately in Earn and Perps. Emmanuel's USDC card previously combined 660 USDC
in the wallet with roughly 340 USDC in Earn, making it look as though the deposit
had not reduced the wallet balance. The live browser check now confirms 660 in
both wallet displays and 340.00024 USDC in the Earn position. This changes what
the headline reports; it does not alter chain accounting. Unrelated styling
changes from the initial interpretation were reverted.

Wallet choices now display extension-announced icons, with a generic icon for
missing or broken images. Late announcements update an existing injected entry.
Phantom explicitly uses the unchanged official ghost SVG served from
`public/images/wallets/phantom.svg`; provenance is in the adjacent `sources.json`.
TypeScript and targeted read-only browser checks passed at desktop, 390px and
320px, including icon loading/fallback and the corrected live USDC balance.
Evidence: `.local/portfolio-consistency/result.json` and `phantom-official.png`.
The broader Portfolio suite initially stopped on a transient backend RPC 503;
it is not counted as a pass. No transactions, push or deployment.

## Earn loading fixed — Codex, 10 October 2026 — local only

Emmanuel requested fixing the delay before vault values appear. Public APR,
assets, share value and allocation now load before wallet limits, strategy details
and chart history. The two overview vaults load independently. RPC reads share
clients and travel in batches of at most 20, matching the existing restricted
gateway. Public figures share a 10-second cache; historical chart samples share
a 60-second cache. Deployment fetches are deduplicated and successful server
configuration checks are reused for 10 seconds. Failed reads are not cached.
Wallet balances, transaction quotes and withdrawal limits still use fresh reads;
completed actions invalidate public figures and refresh the full snapshot.
Polling skips an outstanding read, and older reads cannot overwrite action results.

Measured locally against the restored Railway fork:

| Page | Previous time to figures | Updated time | API requests before figures |
| --- | --- | --- | --- |
| Earn overview | 18.6 s | 5.4 s | 73 → 3 |
| USDC detail | 59.1 s | 2.0 s | 254 → 3 |
| MON detail | Not measured | 1.9 s | 3 |

Each page used a fresh browser context; the detail measurements benefited from
the server configuration cache. Overview-to-USDC navigation reused public data
and displayed figures in 95 ms. These are measured timings, not a latency SLA.
Evidence: `.local/loading-profile/profile.json` (before) and
`.local/earn-loading/1791672285178/result.json` (after).

Production build, TypeScript and 18 focused tests passed. Browser acceptance
passed six signed synthetic-fund transactions covering deposits and complete
withdrawals for both assets, approval rejection, quote failure/recovery, and
390px/320px layouts (`.local/earn-flow/1791672349412/result.json`). A controlled
22-second detail read left public figures visible after 1.9 seconds and did not
start an overlapping poll. A separate MON outage left USDC figures available
and MON unavailable, without inventing a zero rate
(`.local/earn-loading/resilience-result.json`).

Review at **http://127.0.0.1:3018/earn/**. No push or frontend deployment;
`setsuna.finance` has not received these changes.

## Hosted backend recovered — Codex, 10 October 2026

Emmanuel authorized recovering Railway and using it for the local frontend.
Railway had stopped after worker RPC timeouts on 9 October. Its final Perps
fixture transaction succeeded, but the timeout left a pending journal without
the returned hash. A normal restart restored the fork, then stopped on that
unresolved journal. In a temporary maintenance container, backed up the chain
snapshot and journal, verified the successful receipt, exact calldata/event and
next owner nonce, and reconciled transaction
`0xacedba67cb51300de45e82f39a1099874005566c184f6851dc24d1dab0d800cb`.
The reconciliation did not modify chain state or resubmit that transaction.

Railway release `ae4244bb-87bb-42b1-aabc-80e75dcbccfb` restores the existing fork,
contract addresses and three workers. Both `setsuna.finance` and the local app
return the verified five-protocol demo configuration. All 25 original acceptance
receipts retain their block hashes and events. Desktop overview, both vault detail
pages and the 390px overview display real fork values: approximately 10 MON at
5.05% base APR and 160.28 USDC at 4.82% at verification. These are variable demo
rates and synthetic assets. No browser errors or mobile overflow were observed.
No new user transaction acceptance was performed.

Local review remains **http://127.0.0.1:3018/earn/**. Ignored `.env.local` now uses
the Railway RPC and cloud manifest; corrected the manifest's dotenv encoding in
ignored `.env.hosted-demo` as well. Private URLs remain server-only. No local
Anvil instance was started, no Git push occurred, and the new frontend design was
not published. Evidence: `.local/hosted-recovery-2026-10-10/`; server backup:
`/data/setsuna/recovery-2026-10-10/`. The original timeout cause is not yet isolated;
the fail-closed worker behavior and manual restart policy remain in place.

## Logos throughout the site — Codex, 10 October 2026 — local only

Emmanuel requested logos everywhere, explicitly including the real USDC logo.
Added a shared token/protocol asset registry and reusable icon/label components.
Circle's unchanged USDC token SVG comes from its official pressroom brand kit.
MON, USDC, AUSD and BTC now use image assets instead of letter/currency-symbol
placeholders in the hero, product illustrations, Earn selectors and receipt
badges, Spot/Perps headers, Portfolio and documentation illustrations. Protocol
logos appear in the integration strip, Earn summaries, allocation/rate tables,
decision details and developer documentation tables; shared research components
use the same registry. Receipt tokens retain Setsuna's Wave Lift mark with their
underlying asset's real logo. Plain explanatory prose remains readable.

Assets are served locally with provenance and hashes in
`public/images/{tokens,protocols}/sources.json`; AUSD is from Kuru's token assets.
Production build/TypeScript, 20 page checks across desktop and 390px mobile, and
the existing 22-page docs suite passed. All checked logos loaded, no letter-icon
placeholders or document overflow remained, and no browser errors occurred.
Evidence: `.local/sitewide-logos/`. The local fork is still offline, so these are
visual/navigation checks, not new transaction acceptance. No push or deployment.

## Protocol logos — Codex, 10 October 2026 — local only

Replaced protocol initials in the landing-page vault flow and Earn allocation
cards with official Aave, Morpho, Euler, Neverland and Curvance assets. USDC's
landing illustration now shows all five destinations; MON retains Neverland and
Euler. Cash uses a wallet icon. Source URLs and file hashes are recorded in
`public/images/protocols/sources.json`. Aave uses its supplied app icon for contrast
on the dark surface. TypeScript, formatting and eight browser checks passed,
including MON/USDC switching at 1440px, 390px and 320px and both Earn allocation
views. Screenshots and review: `.local/protocol-logo-review/`. No push or deployment.

## Local Anvil disk-growth fix — Codex, 10 October 2026 — local only

Confirmed the current app on 3018 uses fork 18614 by matching its latest block
hash. Disabled idle interval mining on older USDC forks 18612/18613 and restored
transaction-triggered mining after confirming empty transaction pools. Repeated
checks showed both stopped advancing and the active fork remained unchanged.
Existing history directories total approximately 79 GB; no caches were deleted
and no existing process was stopped or restarted.

Added `--prune-history 128` to all four local demo launchers, including the unified
acceptance runner, to bound in-memory state history and prevent disk snapshots on
future launches. A 520-block isolated Anvil check preserved current/recent state,
receipts and event logs with zero history-cache files; an unpruned control wrote
four files. All four scripts passed syntax checks and the diff passed whitespace
checks. Older chart samples can be unavailable after pruning. Full integration
tests were not rerun. [Details and evidence](UNIFIED-DEMO.md#local-fork-disk-usage--codex-10-october-2026).
No push, hosted deployment change or real-fund transaction.

## Earn comparison table polish — Codex, 10 October 2026 — local only

At Emmanuel's request, replaced the black table header with a translucent glass
surface, a subtle gradient and 20px backdrop blur. Fixed the cramped header padding,
set labels and values to 14px Inter, increased contrast, highlighted APR in lavender,
and clarified the action as “View vault”. Added table header scopes. Desktop and
390px browser review confirmed transparent header cells, active blur and no page
overflow; the table scrolls horizontally on mobile. Evidence:
`.local/bucket-refresh/glass-table/`. No transaction logic changes, push or deployment.

## Bucket dark palette applied — Codex, 10 October 2026 — local review only

Emmanuel requested Bucket's exact palette and no light theme. Review at
**http://127.0.0.1:3018/earn/**. Added the measured shared palette and original public
background gradients; restyled Earn cards/forms/charts, Portfolio, wallet dialogs,
navigation, marketing, Docs and trading surfaces. SAM-inspired Earn flow, Google
Inter, Wave Lift identity and execution logic remain. Earn adds 25/50/75/Max amount
shortcuts; app navigation moves to a fixed bottom bar on mobile. Docs renders dark
immediately and has no light-theme toggle.

Build/TypeScript passed, six signed synthetic-fund Earn transactions and six flow
scenarios passed, five app routes passed at four screen widths, percentage shortcuts
and exact colour tokens were checked, and all 22 documentation pages plus existing
search/copy/navigation checks passed. No page errors or document overflow observed.
No new trading execution test, push, deployment or real-fund transaction.
[Implementation, sources, evidence and rollback](FRONTEND-REFRESH.md#bucket-dark-theme-implemented--codex-10-october-2026--local-only).

## Bucket visual-system study — Codex, 10 October 2026 — research only

Emmanuel selected Bucket Protocol for colours and components. Inspected its public
Earn overview, savings, leverage, borrow, market, dashboard and staking screens at
desktop/mobile sizes, plus forms, dialogs, asset selectors, charts, market views,
navigation and the Swap panel. Recorded measured colours, typography, spacing,
radii and interaction patterns. Bucket is the primary visual reference for the
next Earn styling pass; SAM remains the flow reference. Keep Google Inter and the
Setsuna identity. [Research and implementation mapping](FRONTEND-REFRESH.md#current-reference-bucket-protocol--codex-10-october-2026).

No application source changes, transactions, push or deployment in this study.
The prior local Earn redesign remains available at http://127.0.0.1:3018/earn/.
Authenticated Bucket screens were not inspected. D-j-View captured public assets
but failed offline verification; use the live-browser screenshots as the visual
record. This is Codex's research handoff for Claude, not implementation approval.

## SAM-inspired Earn flow — Codex, 10 October 2026 — local review only

Emmanuel approved the Earn redesign for review and explicitly said **do not push**. Review at **http://127.0.0.1:3018/earn/**. Earn now opens with setsMON/setsUSDC comparison cards. `/earn/mon/` and `/earn/usdc/` show vault stats, recorded share-value/total-asset charts, personal position and earnings, allocation cards, and a persistent Deposit/Withdraw card with the existing asset dropdown. Detailed allocation decisions and public controls are expandable. Legacy `/app/?asset=...&action=...` links still work. The wallet persists through client navigation. Receipt tokens now carry an underlying-asset badge; Inter typography and the ocean palette are retained.

Portfolio positions now show total deposits, withdrawals and net earnings in each underlying asset. Earnings use owner-filtered events from the manifest deployment block, reconcile shares against the current balance, and remain unknown for external share transfers, incomplete history or unavailable valuation. Queries are paginated with an incremental, block-hash-checked in-memory cache. More than 100,000 uncached blocks requires an indexer and shows unavailable. Performance uses up to 13 historical block samples, excludes empty vault samples, labels archive-state gaps and refreshes every minute. This local RPC has pruned some early state, so charts currently show partial recorded history. No invented 7/30-day APY, aggregate USD conversion or sample yields are shown.

Validation passed: production build and TypeScript; 12 accounting tests; 6 Earn flow scenarios including 6 signed transactions for both asset deposit/withdraw round trips, rejection and quote-error recovery; 9 Portfolio scenarios; 8 allocation-decision scenarios; and desktop/320px/390px redesign navigation checks. Proofs: `.local/earn-flow/1791614151815/result.json`, `.local/portfolio/1791614336187/result.json`, `.local/earn-decision/1791614443430/result.json`, `.local/earn-redesign/1791614415472/result.json`. Previous authoring source is archived in `.local/earn-redesign-backup/20261010/source-before.tar.gz`; `changes.json` beside it lists modified/new paths for a targeted rollback. Contract action code and Spot/Perps screens were retained. No push, deployment or real-fund transaction. This is Codex's implementation and handoff for local review.

## Security and Evidence pages deleted — Codex, 9 October 2026 — local only

At Emmanuel's request, deleted both page routes and their public evidence-download copies. Removed the header/footer entries and replaced remaining Home, Earn and Spot links with appropriate documentation links. The public-facing fork-probe table, including its Codex/Claude credits, is removed; internal research records remain available. Archived source/download copies are in `.local/retired-pages/20261009T185243Z`. Updated the internal documentation index and completion checklist. Removed obsolete generated-route type includes that referenced the deleted pages; the current production build, including TypeScript, passes. Eleven browser/HTTP checks confirmed both routes and downloads return 404, remaining page links work, and mobile navigation fits. Evidence: `.local/page-removal/1791572017111/result.json`. No push or deployment; the live website awaits a separately authorized release.

## Portfolio and wallet balances — Codex, 9 October 2026 — local only

Added **http://127.0.0.1:3018/portfolio/** and a fourth app tab. The connected account sees MON, USDC and AUSD wallet balances, setsMON/setsUSDC shares and redeemable underlying value, available withdrawals, the current base APR, Perps collateral/reserve/open-position equity and P&L, and owner-filtered recent activity. Deposit/withdraw links open the correct asset and action in the unified Earn card. Client navigation preserves the wallet connection; balances refresh every 15 seconds and on request.

Holdings are shown per asset, without an unverified USD conversion. Wallet and protocol balances are pinned to one block; Earn shares are counted at underlying value, Spot funds stay in wallet totals, and settled Perps P&L is not counted twice. Unknown valuations show unavailable rather than zero. Account changes clear the previous owner's data. Activity is limited to 24 events in the most recent 2,000 blocks.

Seven accounting tests and nine read-only browser scenarios passed, including independent local-fork balance checks, account switching, navigation, 320px/390px layouts, RPC failure/recovery and explicitly controlled long/short position fixtures. TypeScript and the local production build passed. Browser evidence: `.local/portfolio/1791570696484/result.json`; run `npm run test:portfolio` and `npm run check:portfolio` against the active local demo. No transactions, push or deployment. This is Codex's implementation and handoff; the public website is unchanged.

## Earn asset dropdown — Codex, 9 October 2026 — local only

Replaced the operating-system select menu with a Setsuna-styled dropdown: token icons, asset names, receipt-token labels during withdrawal, a selected checkmark, and matching Google Inter typography. Added keyboard selection, Escape/Tab/outside dismissal, focus restoration after switching vaults, and automatic upward placement when the viewport has insufficient room below. Updated the shared browser interaction helper. TypeScript and six read-only browser checks passed, including 320px/390px layouts. Evidence: `.local/earn-picker/1791567245190/result.json`. No push or deployment.

## Google Fonts and Earn typography — Codex, 9 October 2026 — local only

The shared interface now loads Google Inter through `next/font/google`, replacing Instrument Sans. Earn uses a consistent sans-serif hierarchy: 600-weight headings, 500-weight controls and amounts, 400-weight body copy, 12px minimum captions, and tabular numerals. The Earn heading no longer switches to Garamond; marketing's editorial headings and documentation's Geist body retain their existing roles. The type scale is in `src/styles/typography.css`.

TypeScript and the local production build passed. Seven read-only browser checks verified the actual loaded Inter face, desktop styling, 320px/390px Earn layouts and mobile Homepage/Spot/Perps/Docs overflow. Evidence: `.local/typography/1791565777838/result.json`. Review at http://127.0.0.1:3018/app/. Nothing was pushed or deployed, in accordance with Emmanuel's instruction.

## Unified Earn card — Codex, 9 October 2026 — local only

**User direction:** follow SAM's asset-selection flow and **do not push**. MON and USDC now share one transaction card, with an asset dropdown inside the amount field, Deposit/Withdraw controls, exact onchain output previews, Max, and matching position/allocation details. Their independent vault contracts and transaction routes are unchanged. Switching assets clears inputs and stale quotes; transaction confirmation locks the selector and action switch. MON Max leaves 0.1 MON for gas. Mobile places the transaction card first.

**Review locally:** http://127.0.0.1:3018/app/ (existing local fork, RPC 18614). Six actual signed synthetic-fund transactions passed: deposit and full withdrawal for both assets. Browser checks also covered rejection recovery, blocked asset/mode changes during signing, quote failure/recovery, validation and 320px/390px layouts. Eight allocation-decision browser scenarios, seven decision unit checks, TypeScript and a local production build passed. [Verification](research/earn-flow-2026-10-09.json).

The deployed website is unchanged. The earlier MP4 and source archive record the preceding UI; regenerate them after this flow is accepted. This is Codex's implementation/handoff, not Claude's approval or a physical-device acceptance test.

## Earn decision visibility and judge guide — Codex, 9 October 2026

Published **Why this allocation** for MON and USDC: the contract preview, spaced rate observations, targets versus the next permitted move, projected-income qualification and accurate cooldown/unavailable-data states. Corrected custom-error decoding and linked vault events to fork receipts. [The public Evidence page](https://setsuna.finance/evidence/) now leads with a judge walkthrough and downloadable proof; earlier Perpl research remains clearly historical. Seven focused checks, eight public browser scenarios, TypeScript, production builds and changed-page/link checks passed. Successful rebalance receipts and current-state cooldown refusals were verified independently. This is not a new real-device test. [Submission copy and manual acceptance](HACKATHON-COMPLETION.md) · [Evidence](research/web-submission-2026-10-09.json).

## Web submission scope — Codex, 9 October 2026

**Emmanuel confirmed that the native iOS application is out of scope for this hackathon.** The existing web product is the submission focus. Next: real wallet-extension and physical-phone Mera checks, a clear Earn allocation demonstration, independent user trials, and the final walkthrough/submission package. Mobile-browser support remains in scope. Agora's acceptance of mobile web and a private fork is unconfirmed; its bounty remains conditional. [Current scope and completion plan](HACKATHON-COMPLETION.md#current-scope-and-next-work--codex-9-october). Older native-development milestones below are historical, not current requirements. This records the user's decision and Codex's handoff; it does not record new test results or Claude's approval.

## Unified Earn, Spot and Perps demo — Codex, 9 October 2026

**Latest hosting update — Codex:** the Railway Anvil fork, persistent volume, restricted RPC, bounded faucet, explorer and three workers are deployed. Vercel now serves the executable demo. Tenderly entitlement is no longer a dependency. Public fresh-wallet acceptance passed **25 signed transactions and 23 checks**, including both Earn withdrawals, Spot, Perps, pending-receipt recovery and mobile RPC failure/recovery. The cloud restart preserved balances, shares, nonces and all 25 receipt/event records. Thirty-four Node tests, TypeScript and the production build passed. Fixed an unbounded Spot order-book query and a stale Earn balance refresh race exposed by the hosted run. [Deployment, evidence and remaining boundaries](PUBLIC-DEMO.md).

Five-protocol setsUSDC, setsMON, Kuru Spot, Perpl and the bounded faucet now run on one Monad fork at source block 111560409. A fresh wallet passed **25 signed transactions** covering both trading directions, long/short and partial/full exits, MON Earn, USDC allocation into all five protocols, and full Earn withdrawals. USDC cooldown rejection and executor restart reconciliation passed. The funding UI now preserves an uncertain claim hash and confirms the matching receipt after reload/reconnection without a duplicate request.

**Local app: http://127.0.0.1:3016/app/**; RPC 18614. Twenty-seven configuration/executor/receipt tests passed on Node 24; TypeScript and the production build passed. Worker supervision, Docker/Railway configuration and private environment preparation are included. **Codex hosting follow-up, 9 October:** Railway login is now confirmed; the `setsuna-metropolis` project and empty `setsuna-workers` service are created, linked and configured. That earlier hosting check is superseded by the Railway deployment described above. [Current runbook and Claude handoff](UNIFIED-DEMO.md).

## Documentation website — Codex, 8 October 2026

Added 22 original user-facing documentation pages at **http://127.0.0.1:3015/docs/**, adapting SAM’s reading structure to Setsuna’s Wave Lift branding and ocean palette. Includes full-text search, keyboard navigation, a mobile menu, persistent dark mode, section links, previous/next navigation, Markdown/code copy and an interactive share-value example. All page/link, search, clipboard, theme and mobile browser checks pass; TypeScript and the production build pass. Documentation is linked from the main navigation/footer. [Editing guide and Claude handoff](DOCS-SITE.md). No public deployment or contract change was made.

## Five-protocol setsUSDC: Curvance integrated — Codex, 8 October 2026

Curvance's direct wsrUSD/USDC adapter is implemented and deployed beside Aave, Morpho, Euler and Neverland on a new local fork at block 111560409. The SAM-style share vault, factory, manifest validation, keeper and UI support five fixed destinations. Full regression: **152 Solidity tests passed**, including ten five-protocol fork tests; **18 keeper/configuration tests passed**; TypeScript and production build passed. Signed browser deposit, public rebalance, partial/full redemption, five funded protocol rows and mobile checks passed. Current demo: **http://127.0.0.1:3015/app/**; RPC **18613**. Existing demos remain available. Public deployment is still pending. [Implementation and Claude handoff](USDC-FIVE.md) · [Evidence](research/usdc-five-2026-10-08.json).

## Native lending candidate verification — Codex, 8 October 2026

Screened Curvance's 27 market managers and TownSquare's direct USDC lending pool at Monad block 111560409. Four of seven Curvance USDC markets clear the initial size/rate/liquidity screen; all four pass immediate and simulated seven-day partial/full withdrawal tests. TownSquare's direct same-chain path also passes but its approximately 20,138-USDC pool is below the unchanged 250,000-USDC floor. Eleven research fork tests passed, including moving between two Curvance markets. No new production adapter, app change or deployment was made. [Decision and adapter requirements](USDC-V2.md#native-protocol-screening--codex-8-october-2026) · [Evidence](research/native-usdc-screen-2026-10-08.json).

## Four-protocol setsUSDC — Codex, 8 October 2026

Implemented the SAM-style single-asset/share-token flow across Aave, Morpho aHYPER/USDC, Euler and Neverland. New v2 vault supports two to four fixed adapters and a cap of 10% of destination market cash. Fresh fork at block 111523095 passes all-four allocation, partial/full withdrawal, accrual and disabled-venue exit. Full Solidity regression: 131 passed; executor/configuration tests: 16 passed; TypeScript and production build passed. Browser deposit, exact approval, rate observation, rebalance and redemption passed, including mobile. Local app: **http://127.0.0.1:3014/app/**; RPC 18612. Public release unchanged. [Implementation and handoff](USDC-V2.md).

## Spot/Perps completion — Codex, 7 October 2026

Fresh-wallet end-to-end acceptance passed through the restricted RPC: test funding from Spot; swaps in both directions; Perpl account creation, opening/repeat deposits, long/short fills, partial/full closes, rejected FOK with no signature, protection revocation and full collateral/reserve withdrawal. Actual fills and fees now appear in confirmations/Activity. Reload recovery, mobile/RPC failure and the same wallet's Earn journey passed, with 21 signed wallet transactions. Limit-entry and post-trade refresh races were fixed. Six receipt tests, six protection-executor tests, eleven market/configuration tests and the production build passed.

The verified fresh deployment is running locally at **http://127.0.0.1:3011/app/** with a bounded faucet and separate price/Earn workers. It uses synthetic assets and a disclosed historical Perpl price. The original 3008 app remains available. **The public site is still a read-only preview; a Tenderly environment and public worker hosting are not configured.** [Proof, reproduction and iOS handoff](TRADING-COMPLETION.md).

## Earlier status

**Current summary — Codex, 6 October 2026:** The public site serves live Kuru/Perpl market data and remains a read-only preview; its deployment endpoint was checked on 6 October. Executable setsMON, Spot and Perps flows remain on the local synthetic-fund fork. setsUSDC is a research preview in the app. The immediate priority is a publicly executable setsMON journey, followed by an observable allocation decision and submission evidence. [Completion checklist](HACKATHON-COMPLETION.md) · [Deployment boundary and setup](LIVE-DEPLOYMENT.md).

**Recorded verification:** 4 October's combined build passed 107 Solidity and 18 executor tests, the browser round trip, TypeScript and production build. The 5 October deployment and [Spot guide](SPOT-DEEPBOOK.md) record later market/UI checks. This 6 October assessment and documentation update did not rerun those tests or deploy contracts.

[Combined trading guide](TRADING.md) · [setsMON guide](SETSMON.md) · [USDC guide](EARN.md) · [Trading evidence](research/trading-2026-10-04.json).

## Hosted-demo implementation — Codex, 6 October 2026

Implemented deployment journaling, a demo-only faucet with persistent onchain limits, server funding and the connected-wallet funding button. Added explicit fork validation to the Earn executor and a separate periodic worker. A fresh contract deployment passed empty-wallet funding → 100 MON deposit → signed rebalance → share approval → full withdrawal through the hosted configuration and restricted RPC on an isolated local fork. Restart receipt recovery did not broadcast a duplicate. Six faucet contract tests, twelve Earn executor tests, eleven market/configuration tests, TypeScript and production build passed.

This supersedes the earlier statement that no faucet implementation exists. **Public activation remains incomplete:** no Tenderly environment or continuously running hosted executor is configured. [Setup, evidence and recovery](HOSTED-DEMO-RUNBOOK.md). The public website remains preview-only.

## Combined Earn, Spot and Perps — Codex, 4 October 2026

- App **http://localhost:3008/app/**, RPC **127.0.0.1:18608**, chain 31337. Run `npm run trading:demo` and `npm run dev:trading`.
- Kuru MON/USDC supports real full-fill swaps, exact approvals, minimum output, deadlines and actual receipt history. MON/AUSD is not offered because the pinned book had no executable liquidity.
- Perpl account creation, AUSD funding, filled BTC long/short orders, closes and withdrawals are verified. Trading invalidates protection; reserve and Earn shares remain separate.
- The combined UI uses an explicitly disclosed fixed historical Perpl mark, refreshed on a fork with the oracle guard disabled. Three new Perpl contract tests use unmodified oracle settings at the pinned block.
- Browser tested both Spot directions, BTC long/protection/close/AUSD withdrawal, setsMON entry/exit, all three mobile layouts and Spot RPC-failure behavior.
- Public hosting/deployment, independent review, production oracle/keeper operation and a consolidated portfolio/history service remain open.

The setsMON-only and original Perpl demos below remain available as separate options. Earlier dated counts and future-work statements are historical.

## setsMON completed — Codex, 4 October 2026

- Native MON → WMON → setsMON, with atomic native withdrawal and exact selected-share approval.
- Neverland and Euler WMON lending on Monad block 110418863, both above the 250,000 MON market-size floor. Factory deposit cap: 25,000 MON. These thresholds are MON, not USD.
- Shared `SetsunaEarnCore` preserves USDC behavior; 24-decimal MON shares and 18-decimal underlying are explicit throughout the UI and executor.
- Twelve new MON unit/fuzz tests and eight fork tests cover real allocation, accrued partial/full exits, failed native recipients, reentrancy, liquidity, changed venue models, slippage and permissions.
- Browser deposited/withdrew 42.125 synthetic MON, verified shares and allowances, checked mobile layout and disabled transactions during an RPC outage.
- Local app: **http://localhost:3007/app/**. RPC: **127.0.0.1:18607**, chain 31337. The original AUSD Perpl demo remains separate.
- Spot/expanded Perps are next. Public hosting, independent security review, production operations, unified deployment and a realized-performance service remain open.

Earlier entries below remain dated history and are superseded where this entry records completion.

## Original protection implementation — 28 September 2026

**Author: Codex. V1 approved by the user. Contract/keeper core and web integration implemented.**

The contract/keeper core runs end to end against a local fork of the real Perpl
exchange. The Setsuna web app now connects to that core at `/app/`. Native mobile
and public deployment remain open.

| Component | Implemented and checked |
|---|---|
| Account + factory | Contract-owned Perpl account; fixed owner, token and BTC market |
| Funds | Separate wallet-funded trading collateral and withdrawable reserve |
| Policy | Fee-inclusive cap, cumulative spending, IDs, revoke/re-arm, target and minimum |
| Lifecycle | Owner-action nonce, V2 snapshot, no resting orders, disabled forwarding |
| Rescue | Permissionless; contract-computed amount; exact-delta checks; atomic rollback |
| Keeper | Read-only default; fresh quote + simulation; gas bounds; receipt/event verification |
| Demo | Synthetic funding, deployment, BTC trade, policy and keeper rescue on owned local Anvil |
| Web app | Setsuna landing/docs/assets, responsive dashboard, reserve/policy/trade/activity flows |
| Account connection | Mera passkey create/recover, injected wallet discovery and local demo session |

**Verification:** 41 Solidity tests (including 256 cap/reserve fuzz cases),
6 keeper tests, TypeScript and Next.js production build passed. The local demo
added **49.994940 AUSD** to collateral, paid **0.499949 AUSD** to a separate
keeper, and retained **149.505111 AUSD** in the reserve. These are controlled
fixture results, not live customer outcomes.

[Machine-readable evidence and source hashes](research/contract-core-2026-09-28.json).
[Setup, API behavior, units, commands and limitations](CONTRACTS.md).

| Architecture gate | Current evidence |
|---|---|
| G1 | New account creates/deposits/trades/adds margin on a pinned mainnet fork |
| G2 | Same-block reopen, flip, partial IOC, FOK, liquidation and both forwarding entry points tested; exhaustive lifecycle/upgrade review remains |
| G3 | Reverting/silent/wrong-delta/fee failures roll back balances and spending; silent native-call failure is explicitly injected |
| G4 | Cap/reserve/history checks, withdrawals, re-funding, cumulative rescues and fuzz cases pass |
| G5 | Corrected factor/PnL/residue math; native long/short liquidation boundary tested; Setsuna mark-age policy is separate from venue validity |
| G6–G7 | Claude reported G7 coverage passed and G6 running at 15:22; see his attributed architecture entry |

Next implementation stages, already within the approved v1:

1. Native mobile packaging and real-device Mera compatibility/recovery validation.
2. Envio account discovery and activity history; keeper recovery and monitoring.
3. CRE secondary execution path and measured trigger-to-inclusion latency.
4. Public testnet deployment/device checks, broader independent contract review,
   usage/coverage results and trader trials.

The Next.js routes now serve Setsuna content and reuse the captured local design
assets. [Web implementation details](WEB-APP.md). No proposed
prize, PMF, revenue, liquidation-prevention or production-safety claim is treated
as established by the engineering tests.

## Web verification — Codex

Five routes passed at desktop 1440px and mobile 390px: no missing images, old
DeepBook/Sui links, page errors or horizontal overflow. Hero video playback and
reduced motion were checked. Eight interaction groups passed against the local
fork: top-up, reserve round trip, overdraw rejection, policy lifecycle, client
navigation, trading deposit/withdrawal and filled FOK close, injected-wallet
network/account events, and Mera create/recover plus actual session-signed account
deployment with a virtual PRF authenticator. The tests restore their local state.

[Browser verification record](research/web-app-2026-09-28.json). Physical passkey
devices and native mobile are not established by the virtual-authenticator test.

Open `http://localhost:3000/app/` and select **Connect account → Try the local demo
account** when the prepared fork and `npm run dev:demo` are running.

## Earn integration proof — Codex, 2 October 2026

Five new fork tests pass against **Aave V3 USDC and a direct Morpho Blue WBTC/USDC
market**, pinned to Monad mainnet block `109894238`. They cover contract-owned
deposits, partial/full withdrawals, movement between the two protocols, current
onchain rate changes, and withdrawal after seven simulated days of interest.
The tests use synthetic depositor funds and make no public-chain writes.

[Proof, balances and reproduction](research/earn-markets-2026-10-02.md) ·
[JSON evidence](research/earn-markets-2026-10-02.json) ·
[competitor review](research/earn-competition-2026-10-02.md).

This is integration evidence, not a completed Setsuna Earn vault, production
adapter, allocator, keeper, or public deployment. The selected Morpho market
is below the current frontend minimum-size gate; eligibility must be resolved
before enabling deposits. The architecture now uses current onchain base rates
for initial allocation and records realized performance separately.

These five tests were executed for this task. The earlier protection, keeper,
and frontend verification above remains a historical record and was not rerun.

## Earn implementation and regression — Codex, 2 October 2026

The discovery-only status above is superseded for the USDC backend. Codex has
implemented ERC-4626 `setsUSDC`, fixed Aave/Morpho adapters, the onchain allocation
rule, atomic factory initialization, and a separate public executor. The executor
cannot choose allocations, recipients, APR inputs, or a payment from vault funds.
Source and exported ABIs are ready for Claude's frontend integration.

**Verification: 74 Solidity tests and 17 executor tests pass, zero failures or
skips.** This includes 22 new Earn unit/fuzz tests (257 runs in its recorded fuzz
case), six new real-protocol fork tests, the five earlier lending probes, and the
original 41 protection tests plus six protection-keeper tests. The 11 new executor
tests cover gas/simulation checks, persistence before broadcast, uncertain receipt
recovery, event verification, and action ordering. All chain writes in the Solidity
suite are local fork or unit-test state. The executor tests use synthetic clients;
no public-chain keeper transaction was sent.

The factory preserves the $250,000 destination-size floor. At the proof block it
excludes the selected Morpho market and permits at most 60% in Aave, leaving 40%
idle. A separately labeled $100,000 test profile proves actual Aave/Morpho
allocation and redemption. Claude's additional candidate integrations and
five-market UI are useful research, beyond this implemented two-adapter factory.

[Behavior, commands, API and open work](EARN.md) ·
[Test evidence and source hashes](research/earn-core-2026-10-02.json) ·
[Updated competitor findings](research/earn-competition-2026-10-02.md).

No public Earn deployment, Tenderly environment, enabled deposit UI, MON vault,
realized-performance service, or production safety claim is established. This
backend task did not repeat historical browser/Next.js verification. Perpl's
AUSD collateral and reserve remain separate from Earn as instructed.
