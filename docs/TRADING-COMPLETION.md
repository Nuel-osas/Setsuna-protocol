# Spot and Perps completion / iOS handoff

## Market and Limit update — Codex, 11 October 2026

This is Codex's implementation and verification record for Emmanuel and Claude. It supersedes the older restrictions on resting orders below. No push or public/mainnet deployment was performed.

- **Spot:** Market continues to use the existing MON/USDC swap gateway. Limit creates a separate `SetsunaSpotOrderAccount` per wallet through `SetsunaSpotOrders`. The account funds Kuru's margin balance, places a good-till-cancelled order, tracks remaining onchain size, cancels orders and withdraws free MON/USDC. Free funds are reused first. Each order caps wallet funding at the reviewed amount, even when a previous token approval is larger. Open orders are bounded to 64; ID discovery is bounded to 256 allocations per placement and filters by account ownership.
- **Perps:** Market derives a price bound from the connected Perpl book and the user's slippage, then sends a fill-or-kill order. Limit permits resting orders and exposes cancellation. Open orders block protection; placement revokes an existing policy. Closing still lives in the position panel. The UI distinguishes total trading collateral, order locks and the free amount available for withdrawal.
- **Balances:** Spot limit funds and proceeds remain in the user's Kuru trading account until reused or withdrawn. Both Spot and Portfolio display them separately from wallet assets. No Earn assets or protection reserve fund ordinary trades.
- **Recovery:** Pending Spot-limit receipts persist across reloads, block both Spot modes and reconcile without a duplicate transaction. Context changes clear stale busy states and prevent an old Spot transaction callback from overwriting another wallet's pending state.

### Verification and local preview

103 non-fork Solidity tests, 10 real-protocol fork tests, TypeScript, the Next production build and the signed browser journey passed. Fork tests include partial fills on both venues, cancellation of the remaining size, withdrawals, ownership checks, the reviewed wallet-spend bound and protection blocking. The Perpl partial-fill test cancels historical best-bid orders on its isolated fork to create a controlled maker/taker match; it does not change venue storage or oracle settings.

The browser proof uses newly deployed contracts and synthetic funds on an isolated fork of Monad block **110418863**. Its Perpl mark is a disclosed historical fixture. Evidence: `.local/order-types/1791717042520/result.json`; screenshots and deployment manifest are beside it. The final result includes Spot Market/Limit buys and sells, Perps Market/Limit, partial/full closes, order cancellation, withdrawals, pending-receipt recovery, mobile sizing and RPC failure handling.

Preview: **http://127.0.0.1:3020/trade/**. The local RPC is on 18620, with pruning enabled; process IDs and the current run directory are in `.local/order-types/latest.json`. Only one new demo fork is kept. This preview does not update setsuna.finance.

Reproduce with Node 24 and Foundry:

```sh
npm run contracts:build
npm run test:order-types
RUN_FORK=true forge test --root contracts --match-path test/OrderTypesFork.t.sol -vv
npm run check:order-types
# Keep a fresh, verified preview (requires ports 3020 and 18620 to be free):
node scripts/check-order-types.mjs --keep-demo
```

### Deployment requirement

Existing Perps accounts are immutable: enabling resting limits requires a new `SetsunaFactory` and new accounts. Existing positions, free collateral and reserves must be managed through the old deployment before migrating. Do not replace its manifest while users still need access to those accounts. Spot's new `spotOrdersFactory` manifest field is optional so old deployments continue to load and clearly report that limits are unavailable. The existing market gateway can remain usable alongside the new Spot order factory.

Local, hosted-demo and prepared mainnet deployment scripts now include the new Spot factory. The mainnet script was edited only; it was not broadcast. Protocol references: [Kuru source at 2060bb2](https://github.com/Kuru-Labs/Kuru-contracts-dex-public/blob/2060bb2736080c175d80d568bfdb6226bb5abd04/contracts/OrderBook.sol), [Perpl exchange ABI at 78ce8a0](https://github.com/PerplFoundation/dex-sdk/blob/78ce8a06e39e2f9288792eba41aca5f3c08c1195/crates/sdk/abi/dex/Exchange.json). Perpl's onchain cancellation enum is 4, distinct from its REST enum.

**Scope update — Codex, 9 October 2026:** Emmanuel has confirmed that native iOS is out of scope for this hackathon. The iOS handoff below is retained as a future reference, not an active milestone. The public web demo is now executable; use [PUBLIC-DEMO.md](PUBLIC-DEMO.md) for current deployments and [the current completion plan](HACKATHON-COMPLETION.md#current-scope-and-next-work--codex-9-october) for web verification and submission priorities. The 7 October preview-only status below is historical.

**Codex · 7 October 2026.** Implementation notes for Emmanuel and Claude. This records Codex's changes; it does not imply Claude's approval. Scope: the synthetic-fund Monad fork demo. The public website remains a market preview until the hosted fork and workers are configured.

## Completed behavior

- Funding is available from Earn, Spot and Perps for a connected wallet in a configured demo. A fresh wallet can request 101 MON, 1,000 USDC and 1,000 AUSD through the bounded faucet without already holding gas.
- Spot executes MON ↔ USDC through Kuru, with exact USDC approval, minimum output, a quote deadline, settled swap history and gas left in the wallet. Orders are fill-or-kill; resting limit orders are unavailable.
- Perps creates a user-owned Setsuna account, initializes Perpl with AUSD, accepts subsequent collateral deposits, and opens/adds/closes BTC long or short positions. Partial closes and full exits are supported. Buttons select the full free trading balance or unused protection reserve for withdrawal.
- Perps reports the exchange's actual taker fills, execution price and fee in confirmation and Activity. A submission event alone does not establish a fill. The decoder matches the exchange, account ID, market and account submission. Ambiguous receipts remain unverified.
- A limit that cannot fill in full is rejected during simulation, before the wallet signs, with a readable liquidity error. Invalid/oversized closes and withdrawals above the free balance are rejected before review. Opening the opposite side requires closing the existing position first.
- The suggested limit price cannot overwrite a user's edit. Post-transaction refresh waits for an older polling read and then reads fresh state before reopening actions; a completed close no longer leaves a stale position blocking the next order.
- Every submitted trade revokes protection; reverted/preflight-rejected trades do not. Reserves remain separate from trading collateral and Earn shares. Top-up confirmation now checks `ToppedUp`/`Refused`, so a successful refusal transaction is not described as a rescue.
- Both trading sections persist uncertain transaction hashes and block further writes until receipt reconciliation. RPC failure clears execution state and disables actions.

## Demo operation

The fresh-deployment script now configures Perpl's fixed historical mark (85,190.5 USD) and records it in the manifest. The setup and price worker validate chain **31337**, the reviewed fork identity and matching private/public upstream endpoints before making administrative calls. No production chain is accepted. The worker refreshes the same historical mark every 15 seconds; it does not fetch live BTC prices or advance time. The app discloses the fork-only oracle bypass.

The public browser RPC still rejects administrative and unsigned transaction methods. Test wallets sign their own transactions and send raw signed transactions through that restricted proxy. Only setup/funding/fixture infrastructure accesses the private admin RPC.

With the existing combined source fork running on 18608 and Foundry artifacts built:

```sh
npm run test:trading-receipts
npm run check:journey
# Or verify and leave the fresh demo running:
npm run demo:verified
```

`demo:verified` uses a separate fork on 18610 and app at **http://127.0.0.1:3011/app/**, keeping the price and Earn workers alive only after acceptance passes. It records PIDs in the evidence directory's `services.json`. It refuses occupied ports and leaves the existing 3008/18608 demo alone. Use one hostname consistently: `localhost` and `127.0.0.1` have separate browser storage.

Full hosted setup and recovery: [HOSTED-DEMO-RUNBOOK.md](HOSTED-DEMO-RUNBOOK.md).

## Acceptance evidence

The acceptance runner deploys a new contract set on an isolated clone and injects a newly generated wallet that starts with zero assets. It signs through the restricted proxy, never through an unlocked test-user account. It exercises:

1. Spot entry → test funding → MON sale → USDC purchase → wallet balance, allowance and gateway checks; cancelled signatures and invalid inputs.
2. Perps creation → opening AUSD deposit → additional collateral → reserve → long → partial/full close → short → full close → rejected non-crossing order → full collateral and reserve withdrawal.
3. Actual fill history, protection revocation, unchanged reserve during trades, pending-hash restoration after reload, reconciliation without duplicate broadcast, mobile layouts and RPC outages.
4. The same wallet's 100 MON Earn deposit, an independently signed rebalance, executor restart reconciliation and full share redemption.

**Passed, 7 October:** `.local/hosted-readiness/1791353799817/result.json` records 21 signed wallet transactions, 15 trading checks and the Earn/recovery checks. Screenshots, deployment journals and worker state are beside it. The fresh wallet started empty and ended with zero Perpl position, free collateral, reserve and account token balance; both account allowances were zero. [Portable proof and source hashes](research/trading-completion-2026-10-07.json).

Six receipt/error tests, six protection-executor tests and eleven market/configuration tests passed. TypeScript and the production Next build passed. A separate mobile check passed with loaded controls transitioning enabled → disabled during an RPC outage → enabled after recovery (`mobile-ready.json`). These tests do not establish audited production security, live-oracle behavior, hosted uptime or physical-iPhone compatibility.

The app changes were also deployed to [the public site](https://setsuna-metropolis.vercel.app) on 7 October. Its deployment API still returns `preview`, and unconfigured demo funding returns 503. Publishing the interface does not activate public trading.

## iOS handoff

The next implementation stage can reuse the contract ABIs, amount parsing, deployment types, quote/fill rules and receipt decoder. Extract RPC clients and transaction preparation from React DOM components before sharing them with a native client; `contracts.ts` currently imports the web wallet provider. Do not copy browser `localStorage` or injected `window.ethereum` assumptions into native code.

| Native screen | Existing contract path | Acceptance requirement |
|---|---|---|
| Spot | `SetsunaSpot.sellMON` / `buyMON` | Connect, fund, quote, review, sign, verify received assets and history |
| Perps | Factory → user account → Perpl | Create, fund, trade, verify fills, close and withdraw all free AUSD |
| Earn | MON gateway → setsMON | Deposit, display actual shares/holdings, approve selected shares and withdraw |
| Activity / recovery | Receipts and contract events | Preserve pending transactions through app suspension and avoid duplicate sends |

Choose and validate the native wallet/passkey approach on an iPhone before expanding the interface. A web-injected wallet test does not prove native signing or returning from an external wallet. A reachable hosted demo RPC/faucet is still needed for physical-device and judge testing; localhost addresses are only usable on the development machine/simulator.

Keep the asset separation: **AUSD for Perps; MON/USDC for Spot; setsMON/setsUSDC only for Earn receipts.** No native app or App Store release is claimed by this completion note.
