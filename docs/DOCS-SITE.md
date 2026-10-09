# Setsuna documentation website

**Author: Codex · 8 October 2026.** Implements Emmanuel's request for documentation like SAM's, adapted to Setsuna. This is Codex's contribution for Claude to review.

Open **http://127.0.0.1:3015/docs/** on the running five-protocol demo. The documentation is part of the existing Next.js application at `/docs/`; it is also available from the main navigation and footer. No public deployment was made.

## Reference and adaptation

Reviewed [SAM's live docs](https://docs.usesam.xyz/), the local reference repository's `docs/astro.config.mjs`, styles and article structure. SAM uses Astro Starlight, a light default theme, grouped navigation, search, a right-hand contents list and progressively deeper explanations: Getting started → How it works → The math.

Used the recovered D-j-View tool to capture three public reference pages: introduction, deposit and withdrawal. The capture downloaded 82 resources with no reported failures; its offline verifier passed for those three pages. Desktop and mobile screenshots were separately inspected. The reference is stored under `.local/sam-docs-reference/`, with review screenshots under `.local/docs-review/`.

Setsuna uses independently written Next.js components and original Markdown content. The adaptation keeps the reading structure while using Wave Lift, ocean colors and a dark theme. Per Emmanuel’s typography follow-up, documentation uses Geist/Geist Mono with SAM’s body, emphasis and heading weights (400 / 620 / 680 for body / strong / H1), 16px body text and 14px sidebar links. Setsuna’s wordmark keeps its existing typeface. It adds Trading and Developers sections, a vault-flow illustration and an interactive share-value example. SAM's source, prose, logo and runtime are not shipped as Setsuna's documentation.

## Content structure

| Group | Pages |
| --- | --- |
| Getting started | Introduction, Depositing, Withdrawing, Fees and yield, Risks and safety, FAQ |
| How it works | Overview, Vaults and share tokens, Where your funds go, Earning yield, Rebalancing, Staying liquid |
| The math | Shares and exchange rate, How rates are measured, Allocation and limits, Withdrawal calculations |
| Trading | Spot trading, Perpetuals and protection |
| Developers | Contract architecture, Networks and contracts, Running a keeper, Run the local demo |

The 22 pages describe current implementation boundaries: five USDC protocols, two MON protocols, protocol-derived APR, fixed allocation limits, liquidity-dependent redemption, zero current Earn fees, separate AUSD Perps balances, and local synthetic-fund execution. They do not import SAM's historical-yield learner, reward harvesting, fees or mainnet status.

## Editing

- `src/content/docs/`: original article Markdown. Use H2/H3 for section headings; the title and description come from the catalog.
- `src/lib/docs/catalog.ts`: titles, descriptions, section ordering and route slugs. Add a catalog entry and matching Markdown file for a new article.
- `src/lib/docs/content.ts`: allowlisted local-file loading, Markdown rendering, heading anchors and search text. Only authored repository content is read; raw HTML is escaped. `marked` is pinned to 18.1.0.
- `src/app/docs/layout.tsx` and `[[...slug]]/page.tsx`: documentation shell, metadata, static generation, contents, previous/next links and unknown-page handling.
- `src/components/docs/DocsShell.tsx`: sidebar, persisted theme, native search/menu dialogs and keyboard search.
- `src/components/docs/DocEnhancements.tsx`: Markdown/code copy, scroll-aware contents, original flow illustration and share-value calculator.
- `src/styles/docs.css`: scoped documentation styling and responsive layouts.

Search indexes the full article text locally; it does not need a hosted search service or transmit queries. Ctrl/⌘+K opens search, arrow keys select a result, Enter opens it and Escape closes the dialog. A zero-match query has an explicit empty state. Mobile navigation uses a native modal dialog and closes after selecting a route. Themes are stored as an optional browser preference, separately from the app.

The article renderer is a trusted-repository content pipeline, not a public Markdown upload API. If untrusted content is introduced later, review URL handling and rendering policy before using this pipeline for it.

## Verification and preview

```sh
npm run typecheck
SETSUNA_DIST_DIR=.next-docs-build npm run build
# With the app on port 3015:
npm run check:docs
```

The production build statically generates all 22 documentation pages. `check:docs` checks article routes, active navigation, internal links and heading anchors, unknown-page 404, body-text search and its empty state, keyboard navigation, clipboard actions, theme persistence, positive/negative calculator values, mobile navigation and document width, plus the existing homepage and Earn header. `DOCS_CHECK_URL` can select another local app URL. The browser check uses Chrome and does not submit financial transactions.

Recorded results and source hashes are in [docs-site-2026-10-08.json](research/docs-site-2026-10-08.json). Review screenshots and raw logs remain in `.local/docs-review/`.

**Codex follow-up — copy button, 8 October 2026:** Replaced the square text placeholder with an SVG copy icon, a success checkmark and temporary clipboard feedback. Mobile keeps the status accessible while showing the icon. Typecheck and focused Chrome checks passed for full-page Markdown copying, keyboard activation on mobile, feedback reset, copying a different article after navigation, and clipboard-denied feedback. Button screenshots are under `.local/docs-review/copy-button*.png`.

## Claude handoff

Use the public docs for an explanation of the product, and the engineering `docs/` directory for dated implementation evidence and collaboration. Update both when a contract rule or deployment boundary changes. Keep the distinction between estimated APR and settled performance; the calculator is an illustration, not a return forecast. Do not present local fork addresses as public deposit addresses.

The documentation work does not change vault contracts, trading execution or keeper authority. Public hosting remains a separate deployment step. This entry records Codex's implementation, not Claude's approval.
