# Setsuna revamp — audit and direction

> **Codex context — 2 October 2026:** Historical protection-focused design review.
> The current product leads with Earn; see [ARCHITECTURE-V2.md](ARCHITECTURE-V2.md),
> [WEB-APP.md](WEB-APP.md), and [the documentation index](README.md). Claude's
> original findings, proposed schedule, and questions below are preserved and
> do not represent today's completion status or a new request for approval.

**Author: Claude. 29 Sep 2026.** Approved by the user ("make it award winning"). Web pass items 1 to 7 built the same day; item 8, mobile, is next.

## 1. Audit of the current platform

Checked on the running preview at 1440 px and 390 px, plus the test suites.

**Keep — the engineering core is solid.**
- Contracts: 30 tests pass, 2 skipped (fork tests need `RUN_FORK=true`).
  Keeper: 6 pass. Build and TypeScript pass. No console errors on any page.
- Mera passkey login, browser wallets, simulate-before-sign and receipt checks
  are all real work worth keeping.

**Revamp — the product surface misses the point.**

| Problem | Where | Why it matters |
|---|---|---|
| The core moment is invisible. There is no chart, no liquidation line, no top-up shown moving it. | `/app/` | This is the one thing judges must see in 60 seconds. |
| The main screen is a form of seven protocol parameters: cap, trigger %, target %, minimum top-up, keeper fee %, fee ceiling, mark age in seconds. | `/app/` Protection policy | Traders see our internals. Bybit asks for one switch. |
| Protection lives on a separate settings card, not on the position. | `/app/` | Every reference product attaches protection to the position itself. |
| Borrowed DeepBook artwork, including images labelled "SPOT" and "PREDICT", which are DeepBook product names. | Landing, app empty state | Off-brand, and the scaffold README says the artwork belongs to DeepBook. |
| Empty states dominate a logged-out view; "Connect account" appears four times on one screen. | `/app/` | Reads as unfinished. |
| No evidence. The G6 chain data exists and is unused. | Everywhere | DeFi Saver sells with numbers. We have real Perpl numbers. |
| Web only. | — | Agora's $10k bounty asks for a mobile app. |

## 2. What the winners do

| Product | What it is | What to take |
|---|---|---|
| **DeFi Saver** | Market leader in DeFi automation. $1.5B+ all-time assets under automation, $248M+ live. | Three-step setup: "Input triggers. Confirm setup. Pay only if executed." One diagram showing liquidation ratio, trigger ratio and target ratio together. Fees charged only when an action runs. |
| **DeFi Saver case study** | Market crash, 25 Jan to 9 Feb | 382 automated rescues, 365 positions defended, zero liquidated. One example: $178,990 liquidation penalty avoided for a $5,896 fee, 97% saved. **Evidence sells.** |
| **Bybit Auto-Margin Replenishment** | The same mechanic as Setsuna, on a centralised perps exchange | One toggle on the position panel. Each trigger adds back the initial margin amount from available balance. Plain warning: "does not guarantee that liquidation will not occur." |
| **Hyperliquid** | Largest DEX perps venue | No third-party auto-margin product found. Traders are told to use stop-losses instead. **The gap on DEX perps is real.** |

**Where Setsuna differs:** DeFi Saver protects lending positions, not perps.
Bybit is custodial and draws from your whole balance. Setsuna is non-custodial,
draws only from a separate capped reserve, and every rescue is enforced and
receipted on chain.

## 3. Revamp direction

### Product

1. **Protection is a switch on the position.** Open a trade, then flip "Protect
   this position". It is not a separate settings page.
2. **Two choices, not seven.**
   - *Budget*: how much Setsuna may ever add. A slider, defaulting near the
     G6 median position size of about 40 AUSD.
   - *Step in at*: Early, Normal or Late, mapped to trigger and target buffers.
   - Minimum top-up, keeper fee, fee ceiling and mark age become defaults under
     an "Advanced" disclosure.
3. **The chart is the product.** A price chart with three lines, current price,
   the Setsuna trigger and the liquidation price. Each top-up is a marker, and
   the liquidation line visibly moves away. Budget remaining is a bar beside it.
4. **Pay only if it runs.** Say it the way DeFi Saver does. It is already true,
   because the fee is inside the cap and charged only on a successful rescue.
5. **A receipts feed.** Every rescue and every refusal, each linked to its
   transaction.

### Evidence

6. **A public "Perpl last week" page from G6:** 81 liquidations, 56 traders, 12
   liquidated more than once, and at least 14,814 AUSD of collateral at stake.
   Then, once the backtest exists, "Setsuna would have stepped in N times."
   Every figure links to the reproducible research file.

### Brand

7. **Replace all DeepBook artwork, copy structure and fonts.** Build one visual
   idea that matches the name: *setsuna*, the instant. A single moment on a
   chart, where the line bends away from liquidation.

### Platform

8. **Mobile first.** Expo app with the same Mera and contract integration, for
   Agora's bounty. The web app stays as the landing page, evidence page and
   judge quick-start.

## 4. Order of work, 15 days left

| Days | Work |
|---|---|
| 1–2 | New protect flow and chart on web, reusing Codex's contract and wallet code |
| 3–4 | Evidence page from G6; brand pass replacing DeepBook assets |
| 5–9 | Expo mobile app: login, trade, protect, chart, receipts |
| 10–11 | Keeper live on testnet; Chainlink CRE path; Envio history |
| 12–13 | Demo film and submission copy |
| 14–15 | Buffer |

## 5. Decisions needed from the user

1. Approve this direction, or name what specifically disappointed you in
   Codex's version, so the revamp targets it.
2. Who builds it: Claude, Codex, or split by area, to avoid two agents editing
   `src/` at once.
3. Brand: keep the blue, or start fresh.
