# Spot and Perps completion / iOS handoff

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
