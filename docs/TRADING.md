# Spot and Perps — Codex implementation, 4 October 2026

**Codex update, 7 October:** the [completion guide](TRADING-COMPLETION.md) supersedes this original demo's status: fresh-wallet funding, both Spot directions, long/short and partial/full exits, actual fill reporting, complete AUSD withdrawal, reload recovery and mobile/RPC handling passed against a fresh deployment. The verified demo runs at **http://127.0.0.1:3011/app/**; 3008 remains the original demo. Both use synthetic funds. Public execution is still pending hosted infrastructure.

Earn, Spot and Perps now run in one app against one local Monad fork. The same
connected wallet controls them, with separate balances and explicit transactions.
This is a synthetic-funds demo, not a public deployment or live trading service.

## Run and try it

```sh
# Terminal 1: Foundry must be on PATH. Refuses to replace an occupied RPC port.
npm run trading:demo

# Terminal 2
npm run dev:trading
```

Open **http://localhost:3008/app/**. RPC **127.0.0.1:18608**, chain **31337**.
Choose **Connect → Try the local demo account**. The original setsMON-only demo
at 3007/18607 and original Perpl fixture at 3000/18549 remain separate options.

1. **Earn:** deposit MON for setsMON and withdraw available shares to native MON.
2. **Spot:** select MON → USDC, enter 100, get a quote and swap. Reverse direction
   and swap 1 USDC back to MON. USDC approval, if needed, is the exact input amount.
3. **Perps:** create the Setsuna account, expand Trading balance, then open the
   Perpl account with 100 synthetic AUSD. The current pinned venue minimum is 10
   AUSD. Review a 0.001 BTC long or short. Add an optional reserve, arm a capped
   protection policy, and close the position. Free trading collateral and unused
   reserve can each be withdrawn to the wallet.

The local demo wallet starts with synthetic native MON and 10,000 synthetic AUSD.
USDC is acquired through an actual Kuru swap; there is no fabricated USDC credit.
Newly connected personal/passkey wallets have their own balances. No personal
wallet has been funded, signed for or spent from by this implementation.

## Fixed Spot route

`SetsunaSpot` connects directly to the Kuru **native MON/USDC** market:

| Contract | Address |
|---|---|
| Kuru market | `0x065C9d28E428A0db40191a54d33d5b7c71a9C394` |
| USDC | `0x754704Bc059F8C67012fEd69BC8A327a5aafb603` |
| Perpl exchange | `0x34B6552d57a35a1D042CcAe1951BD1C370112a6F` |
| AUSD | `0x00000000eFE302BEAA2b3e6e1b18d08D69a9012a` |

Monad block **110418863**, hash
`0xed4f56748e560219f9926e46d78591ec746b5bca4497e65d0734062fbb46a97b`,
is shared with the setsMON proof. At that block, Kuru's MON/AUSD book produced
zero output in either direction. It is therefore not offered in this demo.

The new wrapper has no admin, arbitrary destination, retained market approval,
or connection to Earn shares/reserves. It checks the pair and precision, requires
exactly representable input, enforces the caller's deadline and minimum output,
requests full fills, verifies balance deltas and pays output to the caller.
Failed execution or native delivery rolls back the entire swap. Existing forced
donations are not swept to later callers. Kuru's upgrade authority remains an
external dependency; these checks are not a full venue security assessment.

Quotes use Kuru's zero-address `eth_call` simulation on the **same fork**. That
path can return partial available depth; it is an estimate, not proof of a full
fill. Before signing, the funded wrapper call is simulated with fill-or-kill
semantics. Execution enforces the displayed minimum (0.5% below the quote) and a
two-minute chain-time deadline. Gas is separate. Slippage tolerance limits changes
after the quote; it does not remove the spread already present in the book.

The actual fork round trip returned **3.427600 USDC for 100 MON**, then
**96.2727860011 MON** for that USDC. These are historical-book execution results,
not a current price or a claim of profitable trading.

## Perps and the combined demo's price fixture

The existing SetsunaAccount/Factory and Perpl risk engine are reused. AUSD is the
only trading collateral and protection reserve. setsMON/setsUSDC remain Earn
receipt shares. Trading invalidates the old protection policy; it must be re-armed
for the new position. Orders remain owner-signed and fill-or-kill in the app;
transaction confirmation alone does not prove that Perpl filled an order.

A snapshot has no ongoing signed oracle feed. Earn warm-up advances the fork clock
about 90 minutes, making the original Perpl mark stale. The **combined local demo**
therefore explicitly impersonates Perpl's owner on Anvil, enables `setIgnOracle`
for BTC and refreshes the pinned **85,190.5** mark every 15 seconds. Its manifest
and the Perps screen disclose this. It models fixed historical prices; it is not
live oracle operation, liquidation stress evidence, or an acceptable production
oracle configuration. No public contract settings are changed.

The helper refuses any RPC except `http://127.0.0.1:18608` with chain 31337 and
stops impersonation after each call. It never needs a private key. The local
executor also checks the demo owner's protection policy and executes eligible
top-ups subject to the existing contract limits. On an uncertain/failed executor
action it stops execution and keeps the fork available for inspection.

Separately, three new Perpl fork tests use the **unmodified original oracle and
mark state** at block 110418863. They prove filled long/short round trips,
withdrawals, protection invalidation, reserve isolation and a non-crossing FOK
order producing no position. They do not depend on the demo's oracle bypass.

## Verification and evidence

- **107 Solidity tests pass**, including 13 new tests: five Spot unit tests, five
  real Kuru fork tests and three real Perpl fork tests. Original Earn/protection
  tests are included in that total.
- **18 executor tests pass**. Next.js production build and TypeScript pass.
- Browser proof: actual MON→USDC→MON swaps, approvals cleared, BTC account funding,
  filled long, protection, full close, AUSD withdrawal, and setsMON native entry/exit
  without spending the protection reserve. Earn, Spot and Perps fit a 390px viewport;
  RPC failure disables Spot transactions. No browser runtime errors were observed.
- Receipt-recovery checks restore real local hashes as unresolved browser state,
  reload the app, verify further writes are blocked, and reconcile actual receipts.

```sh
npm run contracts:test:trading
RUN_FORK=true npm run contracts:test
npm run test:keeper
npm run test:earn-keeper
SETSUNA_DIST_DIR=.next-trading-build npm run build
# With the combined app and fork running:
npm run check:trading
```

[Machine-readable evidence](research/trading-2026-10-04.json). Local transaction
receipts/screenshots/logs are under `.local/trading/`; manifests are regenerated on
start. Browser checks mutate only the local synthetic demo and leave positions
closed. They may add synthetic account/reserve balances on repeat runs.

## Handoff to Claude

**This implementation and review are Codex's input.** Keep the Earn-first product
direction and SAM-inspired independent receipt vaults. The trading tabs are now
functional for the specific pairs above. Preserve the fixed-route checks, exact
approval/withdrawal behavior, persistent unresolved-receipt handling, actual-fill
distinction and visible historical-price fixture disclosure when changing the UI.

Public hosting/deployment, independent review, production oracle/keeper operations,
broader trading pairs and a consolidated portfolio/history service remain open.
The current direct onchain Perpl integration does not establish API/builder bounty
eligibility or builder revenue. AUSD conversion is not enabled through an empty
book. This work makes no new PMF, exclusivity, profit or prize claim.

Primary references: [Kuru market addresses](https://docs.kuru.io/contracts/Contract-addresses),
[Kuru OrderBook source](https://github.com/Kuru-Labs/Kuru-contracts-dex-public/blob/main/contracts/OrderBook.sol),
[pinned Perpl ABI](https://github.com/PerplFoundation/dex-sdk/blob/01b9910761755b0a0d9c710c1ede62ab937daa7d/crates/sdk/abi/dex/Exchange.json),
[Perpl oracle guard](https://perplfoundation.github.io/explainers/mark-price/overview.html).
