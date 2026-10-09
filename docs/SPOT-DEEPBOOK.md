# Spot interface update

**Codex · 5 October 2026** — implementation notes for Emmanuel and Claude.

Reference: https://app.deepbook.xyz/spot. This replaces the earlier Kuru visual direction for **Spot only**. Setsuna's logo remains; execution still uses the existing Kuru gateway, wallet and quote safeguards.

## What changed

- Black canvas, blue controls, centered product navigation and compact market summary.
- Large chart with an adjacent order book and a narrow right-hand order form; account activity beneath the chart and book.
- Order-book price grouping, MON/USDC quantity display, bid/ask filters, spread and an actual recent-trades feed.
- Buy/sell controls, input, percentage shortcuts, balance slider, quote review, expandable execution details and separate Balances/Open orders/History views.
- Mobile Chart/Order Book/Trades tabs and an expandable order form. Responsive chart coordinates avoid stretching chart labels on narrow screens.

The existing quote deadline, full-fill requirement, exact USDC approval, minimum received amount, pending-transaction recovery and wallet-change checks remain. Max MON preserves 0.1 MON for gas and rounds down to the gateway's ten-decimal order precision. USDC shortcuts use integer token units.

## Real scope

Limit orders are not implemented; the dimmed Limit label explains that the current gateway does not support them. Open orders therefore contains no resting orders. There is no copied DeepBook wallet, token-fee logic, oracle feed or TradingView runtime. Public trading remains closed pending the hosted fork.

Spot's public history is a line of actual Kuru closing prices. It is not represented as candlesticks because the upstream OHLC response can contain inconsistent bounds, as documented in LIVE-DEPLOYMENT.md. Local fork charts use observed fork data. Public recent trades are never mixed into the fork's execution view.

The recent-trade parser validates the pair and decimals, derives price from the actual MON and USDC quantities, excludes duplicate maker-side records and drops unpriced dust entries whose rounded USDC amount is zero. It preserves the recorded timestamp and transaction identity. The endpoint is fixed to Kuru's official application API; malformed upstream records fail visibly.

## Reference capture

Used the existing D-j-View checkout with `capture --max-pages 1 --browser`, then its offline verifier. Capture: one page, nine resources, 2,250,456 bytes, no failed downloads. Browser discovery and offline verification both reported `Failed to construct 'URL': Invalid URL`; verification did not pass. The live site rendered correctly in Chrome at 1440×1000 and 390×844 and was separately inspected, including order-book/trades and market/limit controls. We used those live observations as the reference, not the broken offline runtime.

No captured vendor JavaScript, fonts or logos were imported into Setsuna. Editable implementation: `SpotApp.tsx`, `SpotMarketPanels.tsx`, `spot.css`; shared chart has a Spot-specific responsive mode. Original source backups and reference/review images are in `.local/deepbook-spot/`. Raw capture is in `.local/frontend-refresh/deepbook-spot-2026-10-05/`.

## Verification

- Ten market/config tests, including trade scaling, duplicate/dust exclusion and malformed-pair rejection.
- `check-deepbook-spot.mjs`: chart/book/ticket geometry, grouping, currency switch, real trades, responsive widths, mobile panels and Perps style isolation.
- `check:trading`: actual local synthetic-fund Spot round trip, Perpl account/fund/open/close/withdraw and setsMON deposit/redeem; receipt recovery passes.
- `check-trading-terminal.mjs`: existing controls, wallet flow, feed failure clearing and non-Spot page styles pass.
- Browser checks for Max/25% confirm exact balances, native gas reserve and precision. These checks submitted no transactions.
- TypeScript and production build pass.

The tests now open the mobile order panel before checking quote controls, matching the new interaction rather than treating the hidden panel as a failure.

Published to https://setsuna-metropolis.vercel.app/app/?tab=spot. The same desktop/mobile interaction checks also pass on the deployed site, including the actual recent-trades feed.
