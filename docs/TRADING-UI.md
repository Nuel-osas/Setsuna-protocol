# Trading workspace

**Author: Codex · 4 October 2026.** Implements the user's correction to the frontend
refresh: use [this Kuru MON/USDC trading page](https://www.kuru.io/markets/0x065c9d28e428a0db40191a54d33d5b7c71a9c394/trade)
as the reference for Spot and Perps. Walrus and TBook remain the marketing-page
references. This is Codex's contribution for Claude to review.

- **Spot:** http://localhost:3008/app/?tab=spot
- **Perps:** http://localhost:3008/app/?tab=perps

## Applied reference

Kuru's compact market strip, large chart, adjacent book, right-hand order ticket
and lower trade/balance sections informed the new layout. Setsuna keeps its Wave
Lift mark and uses a dark ocean palette with blue, mint and rose controls.

Both order tickets are visible before connecting. Account creation and funding
are part of the Perps ticket. Position details sit below the chart; optional
protection and its reserve sit below the trading workspace. The layout becomes
two columns on tablets and a single column on phones.

The shared marketing header becomes compact app navigation while Spot or Perps is
active. Earn and marketing pages retain the previous refresh. An inherited
`.s-chips` collision had positioned leverage controls over the chart and disabled
pointer events; the terminal now explicitly restores normal positioning and
interaction.

## Market data and execution boundaries

**Spot depth is real fork state.** `getL2Book()` and `getMarketParams()` are read at
one explicit block on the connected local RPC, independently of wallet connection.
The decoder follows the documented wire format in
[Kuru's SDK](https://github.com/Kuru-Labs/kuru-sdk/blob/main/src/market/orderBook.ts):
block number, bid price/size pairs, a zero separator, then ask pairs. Prices and
sizes use market precision, not token decimals. The returned block must match the
requested block. Read failure removes the displayed book and midpoint.

The book and depth plot contain **resting CLOB liquidity only**. They exclude AMM
liquidity and are labeled accordingly. The header shows a book midpoint, not a
last trade or executable quote. Existing simulated quotes and transaction bounds
remain authoritative for swaps. Buy/Sell selection still executes the original
exact-input MON/USDC flow, with its 0.5% slippage limit and deadline.

**Price charts show observations collected in the current browser session**, at
eight-second intervals. They do not contain invented candles or historical volume.
The user can switch Spot between Depth and Price, select the book side and change
the displayed price sample window. This is not historical OHLC coverage.

**Perps reads its actual configured Perpl mark** through `getPerpetualInfo()`, even
before wallet connection. The combined demo's historical-price fixture stays
explicitly disclosed. Its flat mark chart is expected. Perpl book depth is not
connected; that panel displays market details and says so instead of fabricating
orders. BTC positions, collateral, protection and account history still use the
existing verified account reads and actions.

This change does not add resting limit orders, cancel/replace, public trading,
24-hour market statistics or a historical chart indexer. It does not import Kuru's
wallet integration, frontend runtime or TradingView distribution. The chart is an
original SVG component. Contracts and keepers are unchanged.

## D-j-View inspection

Used the existing tool checkout at `.local/frontend-refresh/d-j-view`, commit
`e4d3c78f107d3242329b1c370a972cf5c7221740`:

```sh
npm run capture -- https://www.kuru.io/markets/0x065c9d28e428a0db40191a54d33d5b7c71a9c394/trade --out ../kuru-terminal --max-pages 1 --browser
npm run verify -- ../kuru-terminal --screenshots
```

Capture: one page, 95 resources, 17,012,850 downloaded bytes, no download failures.
Browser discovery recorded 17 unresolved dependencies and one page error. Offline
verification **did not pass**: 201 missing requests, 43 external requests and a
browser-API/do-not-track error. A capture of a backend-dependent exchange is not a
working exchange clone. Those reports remain in
`.local/frontend-refresh/kuru-terminal/`.

The live source was separately inspected in Chrome at 1440px and 390px. Source
screenshots and observations are under `.local/trading-terminal/`. No wallet was
connected and no transaction was submitted on Kuru's public site.

## Files and verification

| File | Responsibility |
| --- | --- |
| `src/styles/terminal.css` | App navigation, dark tokens, terminal grid and responsive presentation |
| `src/components/setsuna/TradingMarket.tsx` | Market strip, SVG charts, book controls and Perps market details |
| `src/components/setsuna/useTradingMarket.ts` | Independent, read-only market polling and observation lifecycle |
| `src/lib/setsuna/market-view.ts` | Packed book decoder and display formatting |
| `src/components/setsuna/SpotApp.tsx` | Spot ticket, balances and actual swap receipts |
| `src/components/setsuna/App.tsx` | Perps ticket, positions, reserve and protection |
| `src/components/setsuna/AppShell.tsx` | Scoping the terminal presentation to Spot/Perps |

Checks and their results are preserved in
[trading-ui-2026-10-04.json](research/trading-ui-2026-10-04.json). Commands:

```sh
node --test scripts/market-view.test.mjs
node scripts/check-trading-terminal.mjs
npm run check:trading
npm run typecheck
SETSUNA_DIST_DIR=.next-terminal-build npm run build
```

Three decoder tests cover precision/scaling, cumulative depth, one-sided books and
malformed data. Browser review covers both terminal layouts at 1440, 1024, 768 and
390px; book/chart controls; leverage hit targets; wallet connection; read failure;
and returning to Earn and the homepage. Functional fork tests cover actual swaps,
Perps fills/protection/withdrawal, MON Earn entry/exit and receipt reconciliation.
Two test selectors were updated for the visible Buy MON and Connect to trade labels.

Screenshots: `.local/trading-terminal/review/`. Pre-change component backups:
`.local/trading-terminal/before/`. Local preview and RPC remain on ports 3008 and
18608. This task has no public-chain writes or public deployment.

## Handoff to Claude

Continue the app from this terminal layout, rather than reintroducing large
marketing headings into trading. Preserve the original transaction checks,
receipt reconciliation and distinction between Earn, wallet Spot tokens and AUSD
trading/reserve balances. If adding candle history or Perps depth, source it from
the displayed execution environment and label its time range and provenance.
Do not substitute live mainnet prices for the local demo's execution state.
