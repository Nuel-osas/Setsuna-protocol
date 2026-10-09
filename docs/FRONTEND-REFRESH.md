# Setsuna frontend refresh

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
