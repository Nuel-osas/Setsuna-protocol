# Setsuna frontend refresh

## Bucket dark theme implemented — Codex, 10 October 2026 — local only

Emmanuel requested the changes with **Bucket's exact colour palette** and clarified
that he **does not want a light theme**. Review at **http://127.0.0.1:3018/earn/**.
This supersedes the research-only status below. No push or deployment.

`src/styles/bucket-theme.css` now defines the shared dark palette: background tones
`#05163A` / `#161A22` / `#080A0F`, white translucent surfaces, white primary actions,
lavender `#A3B2FF`, green `#72A990`, violet `#A5B1EB`, warning `#F1C145`, danger
`#FF5C5A` and the chart's measured `#0047FF`. The original public background images
are served locally to preserve their colour transitions, rather than approximating
them with a different gradient. Source assets:

- `https://www.bucketprotocol.io/bgs/main-bg.png`
- `https://www.bucketprotocol.io/bgs/stable-card-bg.png`
- `https://www.bucketprotocol.io/bgs/leverage-card-bg.png`

Local copies: `public/images/bucket-theme/`. These three reference backgrounds are
the only Bucket assets added to the app. Setsuna's Wave Lift mark, Google Inter,
asset identities and existing SAM-inspired vault flow remain. Matching the palette
does not mean every component's dimensions or typography are a pixel-identical
replica of Bucket.

Earn now uses fully tinted setsMON/setsUSDC cards, dark detail panels, inset action
tabs, white CTAs, dark token menus and wallet dialogs. The shared form adds
25/50/75/Max shortcuts based on the existing permitted maximum, retaining the MON
gas reserve and pending-transaction locks. App navigation occupies the desktop
header and becomes a fixed four-item bottom bar on mobile. Portfolio, marketing,
documentation and trading surfaces share the palette. Spot/Perps keep their market,
order-book and order-ticket layout and execution code. The mobile Spot action bar
and ticket sit above the new bottom navigation.

Dark mode is declared in viewport metadata and rendered from the server. Docs no
longer offers a light-mode toggle or restores a previous light preference.

Validation: production build and TypeScript passed; six Earn flow scenarios passed
with six signed synthetic-fund transactions (MON and USDC deposit/withdrawal,
approval-rejection recovery, quote failure, locking and mobile layout). Five app
routes passed at 1440, 768, 390 and 320px with no document overflow or overlap of
wallet and navigation controls. Read-only review verified percentage arithmetic,
asset switching, wallet retention, dark dialogs and exact computed palette tokens.
All 22 documentation pages, 24 internal links, search, copy, keyboard navigation,
mobile menu and dark mode with a saved/system light preference passed. No JavaScript
page errors were observed. Trading execution was not rerun for these styling changes.

Evidence: `.local/bucket-refresh/20261010/` (screenshots, build/check logs,
`final-review.json`), `.local/earn-flow/1791618797232/result.json`, and
`.local/docs-review/`. The pre-change source snapshot is
`.local/bucket-refresh/20261010/source-before.tar.gz`; it preserves the already
uncommitted SAM-flow work. `changes.json` lists this pass's modified/new paths for a
targeted rollback. Next's isolated build added its type paths to `tsconfig.json`.
This is Codex's implementation handoff for Claude and Emmanuel's local review.

## Current reference: Bucket Protocol — Codex, 10 October 2026

Emmanuel selected **[Bucket Protocol](https://www.bucketprotocol.io/)** for the
colour palette, typography treatment and UI components, then requested a detailed
study before the next styling pass. **Bucket is now the primary visual reference
for the Earn refresh.** SAM remains the reference for the Earn product flow and
share-vault organisation; Setsuna retains its own identity. The earlier Walrus /
TBook work below is historical. This does not replace the documented trading flow.

This is **Codex's design research and handoff**, not a new frontend implementation
or Claude's approval. Existing local changes are preserved. Emmanuel's **do not
push** instruction remains active.

### Scope actually inspected

Live Chrome review at **1440 × 1000** and **390 × 844** covered the Earn overview,
Stablecoin Savings, Leverage, Borrow, Market, Dashboard and BUT staking pages.
Opened Deposit/Withdraw and Stake/Unstake states, asset selectors, slippage
settings, chart periods, route disclosures, leverage explanations, market filters
and table/card views, account history, desktop More, mobile navigation, and the
floating Swap panel. Lower scroll regions were inspected separately.

The wallet button opens a terms dialog first. No terms were accepted and no wallet
was connected; authenticated positions, signing and transaction-result screens
were **not** inspected. Farm, Documents and Legacy are external destinations in
the More menu, not part of this main-app inventory. Some first-load captures show
rate placeholders before data arrives. All Bucket rates and balances in the
screenshots are reference-site observations, not Setsuna data.

### Measured visual system

| Element | Bucket observation | Application to Setsuna |
| --- | --- | --- |
| Background | Navy-to-charcoal image; sampled top-left `#05163A`, centre `#161A22`, bottom-right `#080A0F` | Original CSS ocean gradient using these tones |
| Surfaces | White at roughly 3–6% opacity; selected states 8–10%; optional white 12% hairline | Layered dark cards, input wells and restrained borders |
| Accents | Lavender `#A3B2FF`; green savings tint `#72A990` at 10%, 20% hover; violet leverage tint `#A5B1EB` at 10% | Distinguish setsUSDC / setsMON with quiet card tints |
| Status colours | CSS warning `#F1C145`, danger `#FF5C5A` | Consistent status treatment with a label/icon as well as colour |
| Font | Computed `TTInterphasesPro`; mostly 400/500 weights | Keep the requested Google Inter; match hierarchy and weight, not the proprietary font file |
| Type scale | Body 16px, labels 14px, captions 12px; overview titles 50px desktop / 32px mobile, weight 500 | Fewer bold labels; large tabular figures; readable supporting copy |
| Shape | Cards 16px; primary buttons 12px; tabs/small controls 8px; token controls full pills | One shared radius system across Earn and Portfolio |
| Spacing | Repeated 8/12/16/24/32px gaps; typical panel padding 24px desktop / 16px mobile | Consistent rhythm in forms, statistics and allocation panels |
| Primary action | White fill, black text; large buttons 64px desktop / 56px mobile | One visually dominant action per form |
| Layout | 64px header; broad container up to 1200px; savings layout approximately 600px + 364px with 24px gap | Adapt visual proportions to the established Setsuna detail flow |
| Mobile | Stacked panels, compact header, fixed bottom navigation, nearly full-width dialogs | Keep primary actions reachable and reserve space for bottom navigation |
| Motion | Common 400ms transitions; card tint on hover; some buttons scale 1.05 on hover / 0.95 on press | Subtle feedback with reduced-motion support |

The background hex values are **image pixel samples**, not named Bucket CSS
variables. A literal copy of Bucket's tight 0.8 heading line-height should not be
applied to wrapping Setsuna headings. Muted labels also need a contrast check
against the final background.

### Reusable component patterns

- **Vault discovery:** two large product cards, token marks, short benefit lines,
  a prominent rate and one CTA. Map to setsMON and setsUSDC with actual vault data.
- **Transaction form:** inset Deposit/Withdraw tabs, amount and asset pill on one
  row, balance above, 25/50/75/Max shortcuts, expandable estimates, white CTA.
  Preserve Setsuna's gas reserve, exact quotes and pending-transaction locks.
- **Asset selector:** centred custom dialog, token icon/name rows, selected tint,
  circular close control and blurred overlay. Setsuna lists its supported assets.
- **Charts and allocations:** quiet panel headings, compact period controls, thin
  line charts, expandable routes and key-value rows. Use only recorded Setsuna
  history; do not fabricate time ranges or borrow Bucket's rate values.
- **Portfolio:** compact balance/position panels, account history, and a deliberate
  disconnected empty state. Authenticated Bucket content remains unobserved.
- **Tables and cards:** category chips, table/grid toggle, subtle row surfaces,
  token-first headings and consistent metric labels.
- **Dialogs and drawers:** centred settings/history dialogs; a compact bottom-right
  Swap panel on desktop. Preserve Setsuna's established trading layout while
  drawing on the same component styling when appropriate.
- **Navigation:** simple desktop header, dropdown for secondary destinations,
  compact mobile header and bottom tabs mapped to Setsuna's existing destinations.

### Reference files and capture limitations

- [Measured tokens and implementation mapping](research/bucket-design-system-2026-10-10.json).
- Local visual board: `.local/design-review/bucket-2026-10-10/reference-board.html`.
- Screenshots, DOM/computed-style records and interaction logs:
  `.local/design-review/bucket-2026-10-10/`.

Used the recovered D-j-View checkout described below. Capture requested up to eight
pages but discovered only the root SPA document: **1 page, 42 resources,
6,847,808 bytes, zero download failures**. Playwright supplied the separate live
route and interaction review. D-j-View's offline verification **failed** because
of unresolved app routes and external Sui/API/telemetry dependencies. The capture
is reference material, not a working offline replica. No captured Bucket runtime,
tracking code, logos, audit marks or font files were added to the Setsuna app.

Next implementation should combine **SAM's Earn flow, Bucket's visual language,
and Setsuna's branding**, then be reviewed locally before any release.

---

## Historical implementation — 4 October 2026

**Later update, 4 October:** The user subsequently selected Kuru as the reference
for the trading screens. [TRADING-UI.md](TRADING-UI.md) supersedes this document's
Spot/Perps styling description. Walrus and TBook remain the marketing references.

**Author: Codex · 4 October 2026.** Implemented the user's request to reshape the
frontend using **only [Walrus](https://walrus.xyz/) and
[TBook](https://www.tbook.com/)** as visual references. This is Codex's contribution
for Claude to review, not Claude's approval.

Preview: **http://localhost:3008/**. The combined app remains at
**http://localhost:3008/app/** with Earn, Spot and Perps.

## D-j-View workflow recovered from history

The earlier Codex session identified the user's tool as
[Nuel-osas/D-j-View](https://github.com/Nuel-osas/D-j-View), originally developed in
`/Users/emmanuelosadebe/site-capture-tool`. The session was
`01a0931a-1af0-7151-bdfd-5e065a8c195a`, dated 12 September 2026.

For this refresh, a clean tool checkout lives at
`.local/frontend-refresh/d-j-view`, pinned to
`e4d3c78f107d3242329b1c370a972cf5c7221740`. Its README, AGENTS instructions and Astra
guide were read. It captures public HTML/assets and discovers browser dependencies;
it does not automatically convert a website into maintainable Next.js components.

Commands run from that checkout:

```sh
npm ci --ignore-scripts
npm run capture -- https://walrus.xyz/ --out ../walrus --max-pages 1 --browser
npm run capture -- https://www.tbook.com/ --out ../tbook --max-pages 1 --browser
npm run verify -- ../walrus --screenshots
npm run verify -- ../tbook --screenshots
```

| Capture | Pages | Resources | Downloaded bytes | Download failures |
| --- | ---: | ---: | ---: | ---: |
| Walrus | 1 | 157 | 17,727,302 | 0 |
| TBook | 1 | 50 | 22,531,626 | 0 |

**The captures are visual reference material, not verified offline replicas.**
Walrus's offline verifier reports unresolved blog, localization and analytics
dependencies. TBook's verifier reports that requests did not settle within its
time budget, although it found no missing files, external requests or broken
images. Neither capture received a passing offline verification result. These
limitations are preserved in their reports rather than hidden or represented as
successful cloning.

Both source sites were additionally inspected in Chrome at desktop and mobile
sizes, including scrolled sections. Capture reports, screenshots and extracted
design observations are under `.local/frontend-refresh/`. No captured runtime,
tracking code, mascot, video or proprietary font is served by Setsuna.

## What changed

| Reference | Interpretation in Setsuna |
| --- | --- |
| Walrus's dark hero, oversized centered type and atmospheric color | A midnight ocean hero, CSS aurora, orbit details and an original metallic rendering of the existing Wave Lift mark |
| TBook's floating navigation, serif accents and spacious sections | An inset glass navigation bar, EB Garamond editorial type, rounded product panels and generous spacing |
| TBook's hero-to-page transition | The hero gains side margins and rounded corners as it scrolls; reduced-motion preferences disable the effect |
| Both sites' clear visual progression | Earn introduction → interactive MON/USDC diagram → Earn/Spot/Perps cards → published vault limits → questions → closing CTA |

The Wave Lift sculpture is SVG; the atmosphere, product cards and tokens use CSS.
Instrument Sans remains the body/interface typeface. EB Garamond replaces the old
display face for editorial headings, with JetBrains Mono retained for technical
labels. Next.js serves the font assets locally.

The header, footer, secondary page headings, app palette, panels, buttons and wallet
dialog inherit the refresh. Earn copy now introduces both vaults. Trade copy now
links to the implemented Kuru Spot and Perpl sections instead of calling Spot a
future feature. USDC mainnet research remains explicitly separate from local fork
holdings, and public deposits/trading remain closed.

## Files to edit

- `src/app/page.tsx`: homepage composition and product copy.
- `src/components/setsuna/AuroraHero.tsx`: hero and scroll response.
- `src/components/setsuna/FlowSculpture.tsx`: original vector Wave Lift material treatment.
- `src/components/setsuna/VaultFlow.tsx`: interactive MON/USDC allocation illustration.
- `src/styles/refresh.css`: refresh tokens, page styles, responsive behavior and motion.
- `src/app/layout.tsx`: fonts, shared stylesheet and metadata.
- `src/components/SiteHeader.tsx` / `SiteFooter.tsx`: shared navigation and footer.
- `src/app/earn/page.tsx` / `src/app/trade/page.tsx`: updated secondary page introductions.

The new stylesheet loads after `setsuna.css`. It keeps the established application
classes available; future consolidation should preserve app and wallet behavior.
Original edited frontend files were copied to `.local/frontend-refresh/before/`.
Next's isolated production build added its generated type paths to `tsconfig.json`.

## Verification performed after the refresh

- `npm run typecheck` — passed.
- `SETSUNA_DIST_DIR=.next-refresh-build npm run build` — passed; the running demo's
  build output was kept separate.
- Chrome review of 11 route/tab combinations at **1440px and 390px** — all returned
  200, each had one H1, no broken images, no document-level horizontal overflow and
  no JavaScript page errors. The browser requested only localhost resources.
- Mobile menu open/close, Escape, menu navigation, homepage vault toggle, FAQ
  disclosure, Earn/Spot/Perps destination links, scroll morph and reduced motion —
  passed.
- `npm run check:trading` — passed against the existing synthetic-fund fork on RPC
  18608. Covered both Spot directions, a BTC long fill and close, protection
  arming/revocation, collateral withdrawal, native MON vault deposit/withdrawal,
  mobile layout, unavailable RPC handling, and unresolved-receipt recovery.

Contracts, execution hooks and keeper behavior were not changed by this refresh.
The Solidity and executor suites were not rerun for the visual changes; their
earlier results remain separately dated in the implementation guides. Perps browser
verification uses the existing, visibly disclosed historical-price fixture and is
not proof of live mainnet execution.

Evidence: [frontend-refresh-2026-10-04.json](research/frontend-refresh-2026-10-04.json).
Local screenshots and browser report: `.local/frontend-refresh/review/`.
Build log: `.local/frontend-refresh/next-build.log`.
Functional browser log: `.local/frontend-refresh/trading-check.log`.

## Handoff to Claude

Continue from these components and the two approved references. Preserve asset
separation, actual holdings and rate reads, transaction confirmation/recovery, and
the visible demo environment/Perps fixture labels. The homepage diagram illustrates
the architecture; it must not be substituted for actual deployed holdings. Append
attributed feedback to the architecture record. No public deployment or security
approval is implied by this visual refresh.
