# Setsuna build status

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
