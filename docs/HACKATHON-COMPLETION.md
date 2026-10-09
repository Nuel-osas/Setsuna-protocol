# Setsuna hackathon assessment and completion plan

**9 October 2026 — Codex public delivery:** the executable demo is live at https://setsuna.finance/app/. A persistent Railway Anvil fork hosts five-protocol setsUSDC, setsMON, Kuru Spot, Perpl, a bounded faucet and three workers. Public fresh-wallet acceptance passed 25 signed transactions and 23 checks. Tenderly is no longer required. [Deployment, proof and recovery](PUBLIC-DEMO.md). The 6 October assessment below is retained as history.

## Current completion — Codex, 9 October

- [x] Hosted fork, actual deployed contract manifest, persistent volume and explorer.
- [x] Public Vercel app, restricted RPC and synthetic MON/USDC/AUSD funding.
- [x] Public MON and USDC deposits, shares and withdrawals; five fixed USDC integrations.
- [x] Public Spot both directions; Perps long/short, partial/full closes and full collateral/reserve exit.
- [x] Funded hosted Earn workers; observed permissionless allocations under the original timing rules.
- [x] Pending-receipt recovery, rejected signatures, mobile layouts and RPC failure/recovery in the signed browser harness.
- [x] Cloud restart preserves user/seed balances, shares, nonces and all 25 receipts; workers resume.
- [x] Updated public docs and a Codex-attributed deployment/operations handoff.
- [x] Public MON/USDC decision panels show contract previews, recorded rate inputs and accurate reasons for waiting; events link to the fork explorer.
- [x] Judge walkthrough and transaction/rule records retained in the submission notes and `docs/research/`. **9 October, Codex:** Emmanuel requested deletion of the Security and Evidence pages; their removal is local pending a separately authorized deployment.
- [x] Draft submission copy, recording script and real-wallet/user-trial worksheets below.
- [x] Captioned public web-demo recording with a new signed 100-USDC deposit/full withdrawal and zero remaining vault shares.
- [ ] Real wallet-extension and physical-device checks; independent user trials.
- [ ] Final short walkthrough and submission package using public receipts.
- [ ] Organizer confirmation of fork-only eligibility, deadline and claimed sponsor bounty requirements.
- [ ] Continued hosting availability through judging; dependency patch maintenance and independent security review remain open.

These checks establish a synthetic-fund demonstration, not a mainnet launch, product-market fit, exclusive novelty or guaranteed winnings.

## Current scope and next work — Codex, 9 October

**User-confirmed decision:** skip the native iOS application for this hackathon. The submission will focus on the existing web product, with Earn leading and Spot/Perps supporting it. This supersedes earlier instructions to build iOS after completing trading; native packaging and App Store distribution are not completion requirements. Mobile-browser usability and Mera passkey creation/recovery remain in scope.

Priority order:

1. **Verify the public user journey with real wallets.** Complete funding, each Earn deposit/withdrawal and Spot/Perps entry/exit with a supported wallet extension. Test Mera creation, signing and recovery on a physical phone in the existing website. Record device, browser, transaction links and any failure; the injected-wallet and virtual-authenticator evidence does not complete these checks.
2. **Make the Earn decision understandable.** Show actual venue holdings, observed base APRs, eligibility, caps and cash balance. Explain one permitted allocation and one rule-blocked attempt with receipts or simulation evidence. Preserve the observation interval and cooldown; clearly identify any separately controlled demonstration.
3. **Run independent user trials.** Observe a few people using the public app and record completion, friction and reasons they would return. Report this separately from automated tests or social feedback.
4. **Finish the submission package.** Record a concise Earn-led walkthrough, include supporting Spot/Perps transactions, and assemble the project description, code link, deployment manifest, receipts and judge instructions. Keep synthetic funds, fork execution, historical Perps pricing and withdrawal limits explicit.

**Eligibility runs alongside this work:** obtain organizer confirmation of fork-only submissions and the exact deadline. Agora's recorded mobile-trading requirements include Mera, an AUSD balance and Perpl trading. Whether mobile web and this private fork satisfy them remains unconfirmed; Agora is a conditional bounty target, not a reason to restart native development or a confirmed disqualification. No organizer message has been sent by Codex. No public-chain deployment or mainnet spending is authorized by this scope change.

Maintain the hosted demo through judging and track the existing dependency-maintenance findings. This scope decision does not mark any verification or eligibility item complete.

**Claude handoff:** keep the web product and Earn explanation as the current priority. Preserve the historical native design as reference, but do not treat it as required work. Attribute review or follow-up changes separately.

## Submission copy — Codex draft, 9 October

This is prepared copy, not a submitted entry or organizer approval. Confirm portal field lengths and required video length before uploading. Add the reviewed repository/code-access link and final video URL; neither is established by this document.

**Ready to review:** [Setsuna web demo MP4](../brand/video/setsuna-web-demo-2026-10-09/Setsuna-Web-Demo.mp4), [caption transcript](../brand/video/setsuna-web-demo-2026-10-09/TRANSCRIPT.txt), and [three-transaction recording proof](../brand/video/setsuna-web-demo-2026-10-09/recording-proof.json). The approximately two-minute video is silent and captioned, records the Vercel-hosted public app, and ends with `setsuna.finance`. It shows an actual USDC round trip and supporting trading interfaces; it does not claim that fresh Spot/Perps trades were executed in this recording. Check the portal's demo and pitch-video requirements before uploading.

**Project:** Setsuna Protocol

**Proposed track:** Onchain Finance & Trading, subject to organizer acceptance of the disclosed fork deployment.

**One sentence:** Setsuna automates MON and USDC lending allocation using contract-enforced rules, with transparent allocation decisions and Spot and Perps in the same web app.

**Problem:** Managing a lending position across protocols means comparing changing rates, deciding how much cash to keep available, moving funds and checking the result. A quoted APR alone does not tell a depositor where their money is or why it moved.

**What we built:** Users deposit MON or USDC and receive setsMON or setsUSDC shares in separate lending vaults. Five fixed USDC destinations integrate Aave, Morpho, Euler, Neverland and Curvance; MON integrates Neverland and Euler. The contracts determine allocations from current and recorded base supply rates, enforce venue and liquidity limits, keep a target cash buffer, and move gradually. Anyone can trigger an eligible rebalance; an executor cannot choose different weights, recipients or protocols. The interface exposes actual holdings and the contract's decision, including reasons a move is unavailable. Kuru-powered MON/USDC Spot and AUSD-funded Perpl BTC trading are supporting flows with separate balances.

**Technical contribution:** Setsuna implements the vault/share accounting, lending adapters, fixed allocation constraints, permissionless execution, native-MON gateway, bounded Perpl account/protection logic and transaction recovery. It integrates the existing Kuru and Perpl venues; it does not claim to have built their exchange engines. The architecture follows SAM's single-asset receipt-share pattern, with a rules-based implementation for Monad integrations.

**Why Monad:** The product integrates lending and trading venues deployed in the Monad ecosystem. Our demo executes against their forked contracts. Its timing is not a benchmark of Monad consensus, and the current allocation policy deliberately uses five-minute observation spacing and a ten-minute rebalance cooldown.

**What judges can verify:** Complete a deposit and withdrawal, inspect holdings and observed rate inputs, compare a contract plan with actual rebalance events, and exercise Spot and Perps using the public faucet. The public acceptance record contains 25 signed transactions across these flows and a verified cloud restart preserving balances and receipts. This is functional evidence, not user-adoption data.

**Current environment:** The public app uses a persistent private Anvil fork of Monad mainnet block 111560409, chain ID 31337, with synthetic MON, USDC and AUSD. Perps uses a disclosed fixed historical BTC mark of $82,964.20 and a fork-only oracle configuration change. Transactions do not affect mainnet assets. Current base APR and projected income are not realized earnings or promised returns. Withdrawals depend on available liquidity. This prototype has not had an independent security review.

**Links:** [Public app](https://setsuna.finance/app/) · [Product docs](https://setsuna.finance/docs/) · [Fork explorer](https://setsuna-workers-production.up.railway.app/) · [Public deployment manifest](https://setsuna.finance/api/deployment/) · [Recorded acceptance evidence](research/public-demo-2026-10-09.json).

## Judge walkthrough and recording script — Codex draft

Suggested recording length: approximately three minutes; confirm the portal limit. Keep the environment disclosure visible at the start. Use synthetic funds and genuine recorded receipts. Do not represent an edited wait as an immediate rebalance or a preview as a completed move.

| Segment | Screen and action | Suggested narration |
|---|---|---|
| 0:00–0:20 | Open the public app; show the demo network and funding control. | "Setsuna makes lending allocation easier to inspect and manage. This demonstration uses a Monad mainnet fork and synthetic funds." |
| 0:20–0:50 | Earn → USDC; connect, claim test funds, deposit 100 USDC and show setsUSDC shares. | "One deposit creates vault shares. The vault keeps separate records of your claim and its actual protocol holdings." |
| 0:50–1:35 | Show actual destination balances, then Why this allocation. Expand the recorded rates. | "The rule uses conservative rate observations and fixed limits. A target is different from the next permitted move. Here the contract explains why it can move—or why it must wait." |
| 1:35–2:00 | Open a recorded Rebalanced receipt and show the actual withdrawals/deposits. If a cooldown is active, show it. | "This receipt records what the executor actually moved. Anyone can trigger the same rule; they cannot supply their own allocation. The cooldown and movement limit are enforced by the contract." |
| 2:00–2:25 | Redeem the available setsUSDC shares and show returned USDC. | "Withdrawal uses cash and available venue liquidity. The shared cash buffer is a target, not a guarantee that every depositor can exit immediately." |
| 2:25–2:50 | Show a successful Spot fill and Perps open/close receipt, recorded in the same demo. | "The same interface also supports Kuru Spot and Perpl trading. Perps collateral is AUSD, separate from Earn shares. Its demo price is historical." |
| 2:50–3:00 | Show the app, docs and explorer links. | "Try the deposit and withdrawal yourself, and inspect the rules and receipts behind each move." |

The ten-minute cooldown makes a genuinely new rebalance unsuitable for a forced live three-minute schedule. Use the recorded events below, or prepare an eligible call and wait under ordinary chain time. Explain any cut between recordings. If a plan offers no movement or insufficient improvement, show that real reason rather than manufacturing eligibility.

### Recorded public rebalance receipts

These are hosted-fork events from the 9 October acceptance record, not mainnet transactions. They establish actual allocation; they do not establish profit or organic user deposits.

| Asset | Recorded movement | Receipt |
|---|---|---|
| MON | 1 MON supplied to Neverland | [Rebalance at block 111560507](https://setsuna-workers-production.up.railway.app/tx/0x977b0bf7c860bb7af5447ec804bcc04fca585e76b424dfeda57d484ac551930f) |
| USDC | 14.264141 USDC supplied to Aave and 1.760859 USDC to Morpho | [Rebalance at block 111560591](https://setsuna-workers-production.up.railway.app/tx/0xe36bdcca06768e33362c3f4f1537e8b6091eef49083ac3aa6e5e276365d901d3) |

**Rule refusal verified on 9 October:** new `rebalance()` calls simulated at fork blocks 111561195 (MON) and 111561196 (USDC) reverted with `CooldownActive`. No transaction was broadcast and no state or clock override was used. [Machine-readable proof](research/earn-rule-proof-2026-10-09.json). This proves rejection at those recorded states, not that a cooldown will always be active when a judge visits.

## Real-wallet and phone-browser acceptance — pending

Open https://setsuna.finance/app/. For an extension wallet, select the Setsuna demo network and verify chain 31337 uses `https://setsuna.finance/api/rpc/`; another local network can share that chain ID. On a phone, use the same HTTPS hostname for passkey creation and recovery. Use the faucet for test funds, not a mainnet transfer.

| Check | Completion evidence to record | Status |
|---|---|---|
| Extension connection | Wallet name/version, browser, correct network and address | Not run |
| Faucet | Funding receipt; demo MON/USDC/AUSD balances visible | Not run with a real extension/device |
| MON Earn | Deposit 1 MON, shares visible, redeem available shares, returned native MON | Not run with a real extension/device |
| USDC Earn | Deposit 10 USDC, partial withdrawal, then withdraw available shares | Not run with a real extension/device |
| Spot | MON → USDC and USDC → MON; actual received amounts and receipts | Not run with a real extension/device |
| Perps | Fund with 20 test AUSD; submit a small valid BTC trade, close, withdraw venue-available AUSD; record any venue minimum | Not run with a real extension/device |
| Mera phone creation/signing | Device, OS, browser and passkey provider; create account, fund, sign an Earn deposit and withdrawal | Not run on a physical phone |
| Mera phone recovery | Disconnect, select Use an existing passkey on the same domain; recover the same address and balances | Not run on a physical phone |
| Cancellation/recovery | Cancel one signing prompt; reload after a submitted hash; no duplicate transaction | Not run with a real extension/device |

Record exact error text when a step fails. An unsupported passkey provider is a compatibility result, not permission to relabel a browser simulation as a phone test. Do not collect recovery secrets, private keys or passkey material.

## Independent user trial worksheet — pending

Ask a few volunteers to try the public demo, without first coaching them through each button. No recruitment messages have been sent by Codex. Keep only consented observations and public transaction evidence; aliases are sufficient.

Tasks: obtain test funds, deposit into one Earn vault, explain where the money went and why, find a transaction receipt, and withdraw. Then ask what was confusing, how they manage this today, and what would make them use it again. Do not count an enthusiastic response as retention or willingness to pay.

| Participant alias | Device / wallet | Deposit and exit completed? | Understood allocation? | Main friction / exact error | Reason to return | Receipt links |
|---|---|---|---|---|---|---|
| Pending | — | Not tested | Not tested | — | — | — |

Record a participant count only after actual sessions. Final submission still needs the recording uploaded in the required format, a confirmed code-access link, eligibility answer and the real-device/user outcomes above. The local source review archive is prepared separately; it does not create a GitHub repository or submit an entry.

## Historical assessment and implementation order


**8 October 2026 — Codex delivery update:** Five-protocol setsUSDC, including Curvance, now works on a fresh local fork, including signed browser deposit/rebalance/redemption and actual-position display. [Guide and evidence](USDC-FIVE.md). Public hosting remains open. Earlier status rows below are a dated assessment.

**Author: Codex · 6 October 2026.** Written at Emmanuel's request after the readiness assessment. This is Codex's input for implementation and Claude's review; it does not record Claude's approval. Checkboxes represent evidence-backed completion, not intentions.

## Verdict

Setsuna has enough technical substance to compete for a prize in Onchain Finance & Trading. Its strongest case is the Earn allocation engine, demonstrated through a complete user journey. Spot and Perps support that case. The current public release is still a market preview, so judges cannot yet experience the executable product through the public URL.

Winning is uncertain. Automated vaults are an established category, the competitor review does not establish exclusive novelty, and early Discord feedback does not establish product-market fit. More features or another visual redesign are lower priorities than making the existing core independently verifiable.

| Area | Assessment |
|---|---|
| Track fit | Strong fit with onchain lending allocation and trading integrations; this is our assessment, not an organizer eligibility ruling |
| Technical substance | Implemented contracts and recorded local-fork transaction flows |
| Differentiation | Must be demonstrated through understandable, contract-enforced allocation rules; novelty is unproven |
| Public demo | Main gap: public execution, test funding and hosted automation are unfinished |
| Product-market fit | Hypothesis; needs observed use and specific user feedback |

The [official portal](https://hackathon.monad.xyz/) lists the build window as September 1–October 13. Use the remaining window to complete and document the flows below. Confirm submission requirements and the exact cutoff in the organizer portal when preparing the entry.

## Verified baseline and boundaries

On 6 October, Codex read the public `/api/deployment/` endpoint: it returned `mode: "preview"`, chain ID `143`, with no Earn/Spot deployment advertised. This assessment did not rerun the historical contract or browser tests.

| Component | Current evidence | Remaining boundary |
|---|---|---|
| setsMON | Native MON entry/exit, ERC-4626 shares, Neverland/Euler allocation and executor tested on a local Monad fork | No publicly executable hosted demo |
| setsUSDC | Aave/Morpho backend and fork evidence exist | Public UI is a research preview; deposits are not connected. Default market-size gate excludes the selected Morpho market at its proof block |
| Spot | Kuru MON/USDC swaps tested locally; public market data and terminal available | Public trading disabled; resting limit orders are not implemented |
| Perps | AUSD-funded BTC trading and bounded protection tested locally | Combined demo uses a disclosed historical-price fixture; hosted execution is unfinished |
| Wallets | Injected-wallet and Mera flows implemented | Hosted fresh-wallet flow and physical-device compatibility still need validation |
| Operations | Hosted configuration validation and restricted RPC proxy implemented | Hosted fork, deployments, test funding and continuously running executor remain open |

Current implementation guides: [setsMON](SETSMON.md), [Earn rules](EARN.md), [combined trading](TRADING.md), [public deployment](LIVE-DEPLOYMENT.md), [Spot](SPOT-DEEPBOOK.md). [Competition findings](research/earn-competition-2026-10-02.md) are dated research, not a claim that every competitor has been reviewed.

## Completion order

**Implementation progress — Codex, 7 October:** at Emmanuel's request, Spot and Perps were completed and verified through the fresh-wallet demo configuration before starting iOS work. The successful run includes both swaps, long/short and partial/full exits, complete AUSD withdrawal, actual fill reporting, pending-receipt recovery and loaded mobile RPC-failure/recovery checks. The same wallet completed Earn with a signed rebalance. [Evidence and iOS handoff](TRADING-COMPLETION.md). These are local-fork results; hosted-release checkboxes remain open. The fresh executable demo is at 3011 with its own price/Earn workers.

**Implementation progress — Codex, 6 October:** the deployment command, bounded faucet/API/UI and explicit fork executor are implemented. A fresh contract set passed the complete empty-wallet MON journey through the restricted RPC on an isolated local fork, including a signed rebalance and restart reconciliation. [Runbook and evidence](HOSTED-DEMO-RUNBOOK.md). Hosted-release checkboxes below remain open: Tenderly configuration and a continuously running worker host are not available. Local proof does not establish public availability.

### 1. Make setsMON independently usable — highest priority

- [ ] Provision a hosted Monad fork and deploy the actual reviewed contracts there. Record chain ID, source block, deployed addresses and explorer links. Existing scripts require chain ID 31337; follow the deployment guide rather than reusing a local address manifest as a deployment.
- [ ] Configure the public app's verified demo manifest and RPC. Keep administrator credentials private and preserve the restricted public RPC methods.
- [ ] Provide repeatable synthetic MON funding for a fresh wallet, with a clear in-app route to obtain it. Prepare USDC/AUSD test funding for the supporting trading flows.
- [ ] Deploy a funded Earn executor that supports the chosen demo chain explicitly. The existing production CLI's chain-143 guard is not a hosted-fork setup. Preserve environment checks, simulation and pending-receipt recovery.
- [ ] From a fresh browser and wallet, complete **fund → deposit MON → receive setsMON → inspect real holdings → approve selected shares → withdraw MON**, with explorer receipts from that same environment.
- [ ] Verify executor restart/recovery and failed-RPC behavior. Keep the demo available through judging, with deployment details and a recovery runbook.

**Done when:** a judge can complete the MON journey using only the public URL and its instructions, without localhost or a developer manually sending each transaction. All balances, rates and execution data in the demo come from its configured fork. Synthetic funds and any price fixtures are visible.

**Current dependency:** no Tenderly project credentials or hosted-fork endpoint were configured at the last deployment review. That does not block preparing the executor, funding flow or verification scripts locally. Record any new environment access privately when available.

### 2. Make the allocation decision visible

- [ ] Show the actual venues, idle balance, current and recorded base supply APRs, eligibility, allocation limits, target weights and current weights. Explain why execution is permitted or blocked using actual contract inputs/results.
- [ ] Demonstrate a permitted rebalance and a rejection for a concrete rule, such as cooldown or invalid rate observations. Attach the successful receipt and the rejected simulation/transaction result; show that the rejected action did not move funds.
- [ ] Prepare a reproducible scenario in a separately identified demo environment showing how a controlled market change affects the plan. Label simulated conditions and time advancement. Preserve the contract's timing and limits rather than changing them for a video.
- [ ] Explain execution permissions: an external caller triggers work, while the contract determines destinations and amounts. The keeper cannot choose an arbitrary recipient or override the allocation rule.

**Done when:** a short walkthrough shows a user deposit, explains a real allocation decision, proves that a rule is enforced, and ends with a successful withdrawal under available liquidity.

The implemented engine uses conservative observations of **base APR**, eligibility checks and fixed bounds. It is not an implemented AI risk score, personalized risk profile, or a proven return-maximizing optimizer. Observations are at least five minutes apart and rebalances have a ten-minute cooldown. A demo may use disclosed time advancement or recorded segments; do not claim every-block rebalancing.

### 3. Align the public story with the completed flow

- [ ] Lead the executable walkthrough with **MON / setsMON** unless setsUSDC first reaches the same end-to-end acceptance standard. The published USDC introduction describes the broader direction, not an available deposit product.
- [ ] Review landing, app, FAQ, video and submission copy against the deployed manifest. Distinguish research allocations, actual vault holdings, current APR and realized earnings.
- [ ] Preserve AUSD for Perpl collateral/protection and separate Earn shares from trading balances. Avoid implying that Earn collateral automatically funds trades.

Suggested submission lead once the hosted flow passes:

> Setsuna automates MON lending allocation on Monad. Deposit once, receive setsMON shares, and let anyone trigger rebalances that the vault's transparent onchain rules permit.

Pair that line with the test-fund fork disclosure. Withdrawals depend on healthy valuation and available liquidity; the cash buffer is shared and does not guarantee an exit. Keep claims about novelty, audit status, principal protection and returns within the available evidence.

### 4. Verify supporting trading and prepare the entry

- [ ] On the hosted fork, verify both MON/USDC Spot directions and receipt recovery using the actual deployed Kuru gateway.
- [ ] Verify Perpl account creation, AUSD funding, BTC open/close and AUSD withdrawal. Demonstrate capped protection if included in the pitch. Disclose and operate any historical-price fixture explicitly.
- [ ] Check desktop/mobile and an actual supported wallet; validate physical-device Mera behavior before making device-specific claims.
- [ ] Record a concise product walkthrough centered on Earn. Link code, deployment addresses, receipts, reproducible setup and current limitations in a judge guide.
- [ ] Check the organizer's current track/submission requirements and the exact criteria for each sponsor bounty claimed. Integrations alone do not prove eligibility. Envio is not integrated; only add it if it serves a necessary feature after the core works.
- [ ] Observe a few independent users attempting the demo and record completion, failures and specific reasons they would return. Report that evidence separately from fork test results or social reactions.

**Done when:** the entry's claims match its accessible demo and evidence, and the environment remains available for judging. Tests establish implementation behavior; they do not establish production readiness or guaranteed winnings.

## Scope discipline and validation

Finish the existing MON flow before adding protocols, an AI layer, risk-profile variants, cross-chain routing or another redesign. Keep the current USDC market-size gate intact; any future USDC configuration change needs explicit documentation and appropriate integration evidence.

Use checks appropriate to the implementation changes: contract/fork and executor tests for contract or automation changes; market/configuration tests for RPC changes; TypeScript, production build and browser round trips for app changes. Adapt local browser checks to a dedicated hosted demo environment before running them there; local snapshot/impersonation assumptions must not be exposed through the public RPC. Record new results with dates and transaction links rather than relabeling historical passes as fresh runs.

Recommended work split: Codex handles deployment plumbing, executor/funding integration and transaction verification; Claude contributes decision explanations, UX and copy, then reviews the evidence. This is a proposed coordination split, not a claim that another agent has started or approved work. Append attributed progress and mark a checkbox only after its acceptance evidence exists.

**Next concrete task:** implement the hosted demo execution and funding path, beginning with the executor's explicit fork configuration and fresh-wallet MON journey. See [LIVE-DEPLOYMENT.md](LIVE-DEPLOYMENT.md) for the existing configuration contract and unresolved hosting dependency.
