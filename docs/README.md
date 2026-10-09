# Setsuna documentation

**Maintained by Codex · updated 9 October 2026.** Start here for the current
product and implementation. Dated research and collaboration entries describe
what was known when written; later implementation notes supersede their status.

## Which document to use

| Need | Document |
|---|---|
| Active public app, Railway fork, acceptance, explorer and recovery | [Public demo — Codex, 9 October](PUBLIC-DEMO.md) · [Open app](https://setsuna.finance/app/) |
| Judge walkthrough, actual receipts and downloadable proof | [Public Evidence page](https://setsuna.finance/evidence/) · [Submission copy and manual-test worksheets](HACKATHON-COMPLETION.md#submission-copy--codex-draft-9-october) |
| Captioned USDC deposit-to-withdrawal recording and transaction proof | [Web demo MP4](../brand/video/setsuna-web-demo-2026-10-09/Setsuna-Web-Demo.mp4) · [Recording proof](../brand/video/setsuna-web-demo-2026-10-09/recording-proof.json) |
| Unified five-protocol USDC + MON + Spot + Perps demo and hosted worker setup | [Unified demo — Codex, 9 October](UNIFIED-DEMO.md) · [Local app](http://127.0.0.1:3016/app/) |
| SAM-inspired public documentation, page structure, editing and browser checks | [Documentation website](DOCS-SITE.md) · [Local preview](http://127.0.0.1:3015/docs/) |
| Web submission scope, prioritized completion checklist and acceptance evidence | [Completion plan — Codex, updated 9 October](HACKATHON-COMPLETION.md) |
| Tested hosted-demo deployment, test funding, executor setup and recovery | [Hosted demo runbook — Codex, 6 October](HOSTED-DEMO-RUNBOOK.md) |
| Public preview, hosted-fork configuration and remaining deployment work | [Live deployment](LIVE-DEPLOYMENT.md) |
| Current DeepBook-inspired Spot layout, real data and execution boundaries | [Spot workspace](SPOT-DEEPBOOK.md) |
| Kuru reference, current Spot/Perps terminal layouts, chart/data boundaries and verification | [Trading workspace](TRADING-UI.md) |
| Current frontend, Walrus/TBook references, D-j-View captures and visual QA | [Frontend refresh](FRONTEND-REFRESH.md) |
| Setsuna intro video, cover, connected X replies, editable source and Word/PDF guides | [Video posting pack](../brand/video/setsuna-intro-2026-10-02/POSTING-GUIDE.md) |
| Ready-to-post X introduction thread, four images, captions, alt text and Word/PDF guides | [Social posting pack](../brand/social/setsuna-intro-thread-2026-10-02/POSTING-GUIDE.md) |
| Product direction, Earn/Spot/Perps boundaries, roadmap, Claude/Codex discussion | [ARCHITECTURE-V2.md](ARCHITECTURE-V2.md) |
| Native MON vault, gateway, Neverland/Euler adapters, local app demo and reproduction | [SETSMON.md](SETSMON.md) |
| Current five-protocol setsUSDC, Curvance adapter, SAM-style architecture, local app and proof | [USDC-FIVE.md](USDC-FIVE.md) |
| Earlier four-protocol setsUSDC deployment and native-market research | [USDC-V2.md](USDC-V2.md) |
| Curvance/TownSquare candidate screen, fork proof and integration requirements | [Native USDC candidates](USDC-V2.md#native-protocol-screening--codex-8-october-2026) · [Evidence](research/native-usdc-screen-2026-10-08.json) |
| Historical two-protocol USDC implementation | [EARN.md](EARN.md) |
| Current delivery status and dated verification | [BUILD-STATUS.md](BUILD-STATUS.md) |
| Tests, source hashes, fork configuration and compiled sizes | [Current Earn evidence](research/setsmon-2026-10-04.json) · [USDC historical snapshot](research/earn-core-2026-10-02.json) |
| Combined app, Kuru Spot, Perpl trading and fork limitations | [TRADING.md](TRADING.md) |
| Fresh-wallet Spot/Perps completion, receipt recovery and historical iOS handoff | [TRADING-COMPLETION.md](TRADING-COMPLETION.md) |
| Existing AUSD Perpl account and protection behavior | [CONTRACTS.md](CONTRACTS.md) |
| Website layout, deployment boundary and original wallet integration | [WEB-APP.md](WEB-APP.md) |
| Competitor overlap and supportable positioning | [Competition review](research/earn-competition-2026-10-02.md) |
| Initial Aave/Morpho venue discovery | [First fork proof](research/earn-markets-2026-10-02.md) |
| Claude's additional Euler/Neverland/aHYPER candidates | [Additional fork probes](research/earn-markets-2-2026-10-02.md) |
| SAM reference and reuse findings | [SAM verification](research/sam-verification-2026-09-30.md) |

For implementation details, use the relevant contract guide plus the current
source. A proposal or old review entry is not evidence that a feature exists.
For test claims, preserve the date and scope of the evidence rather than treating
historical passes as a new run.

## Current boundaries

- **Web submission — user confirmed, 9 October:** native iOS is out of scope for this hackathon. Real-wallet, mobile-browser and physical-device Mera verification remain priorities. Agora's mobile-web and private-fork eligibility is unconfirmed. [Current scope and next work](HACKATHON-COMPLETION.md#current-scope-and-next-work--codex-9-october).
- **Earn leads.** `setsUSDC` and `setsMON` are separate ERC-4626 receipt shares. Perpl collateral and reserve remain AUSD.
- **Unified demo — 9 October:** five-protocol USDC (Aave, Morpho, Euler, Neverland and Curvance), MON, Spot and Perps share the fork at http://127.0.0.1:3016/app/. The same fresh wallet passed all four product flows. The earlier dedicated USDC and trading deployments remain separate historical options. [Current guide](UNIFIED-DEMO.md).
- **MON:** fixed Neverland/Euler WMON adapters, both eligible at its proof block. Native deposit/withdrawal and the actual holdings/rate display work on the local fork, with synthetic funds.
- **Recorded 4 October verification:** 107 Solidity and 18 executor tests passed, along with the combined Earn/Spot/Perps browser flow, TypeScript and production build. The 5 October deployment/Spot guides record subsequent checks. This documentation update did not rerun those suites; no public-chain writes were part of their verification.
- **Spot and Perps work on the local fork at localhost:3008.** Kuru MON/USDC swaps and AUSD-funded BTC Perps have separate balances. Perps uses a visibly disclosed historical-price fixture in this combined demo.
- **Public demo — 9 October:** https://setsuna.finance/app/ now connects to the persistent Railway fork with synthetic funding, both Earn vaults and trading. [Current deployment and acceptance](PUBLIC-DEMO.md). The 6 October preview-only status is superseded. A consolidated portfolio, independent security review and realized-performance index remain open.

## Handoff to Claude

**9 October Codex input:** Review [the unified deployment and worker setup](UNIFIED-DEMO.md). Both Earn assets and trading now have one persistent Railway environment and a public Vercel app. Review [PUBLIC-DEMO.md](PUBLIC-DEMO.md) for the current acceptance evidence and recovery procedure. Tenderly is no longer a dependency. This is Codex's delivery, not Claude's approval.

Start with the [current scope and completion checklist](HACKATHON-COMPLETION.md). Emmanuel has removed native iOS from the hackathon scope. Prioritize real-wallet and phone-browser verification, a visible Earn allocation decision, independent user trials and a pitch that matches working features. Respond with attributed changes or evidence; no Claude approval is implied.

The [Codex frontend handoff](FRONTEND-REFRESH.md#handoff-to-claude), [Codex trading handoff](TRADING.md#handoff-to-claude), [Codex setsMON handoff](SETSMON.md#handoff-to-claude--next-work) and latest attributed entry in [ARCHITECTURE-V2.md](ARCHITECTURE-V2.md) record the visual, contract and app changes. Preserve native-MON/share decimals, fixed venue identities, uncertain-transaction handling and the distinction between mainnet research and fork balances. Earlier Claude/Codex entries are historical; append dated responses rather than attributing this implementation or approval to another author.

## Historical records

[ARCHITECTURE.md](ARCHITECTURE.md) preserves the original protection design and
reviews. [REVAMP.md](REVAMP.md) preserves Claude's 29 September protection-focused
redesign plan. Their original deadlines, proposals, market observations and test
counts are dated records. Use the current guides above for today's implementation.
