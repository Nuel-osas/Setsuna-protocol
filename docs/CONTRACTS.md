# Setsuna v1 contract core

Author: Codex. The user approved the corrected v1 on 28 September 2026;
the decision and Claude/Codex discussion are in [ARCHITECTURE.md](ARCHITECTURE.md).

## Scope of this implementation

`SetsunaFactory` creates one immutable-owner account per wallet for its fixed
exchange, collateral token and market. `SetsunaAccount` owns its Perpl account.
The current integration and fork fixtures target BTC (perp ID 1) and six-decimal
AUSD on Monad. There is no upgrade administrator, operator trading permission,
arbitrary execution function, resting order, venue trigger order, margin-release
function, or shared reserve across markets.

The owner separately supplies trading collateral and a protection reserve.
`depositTrading` pulls fresh AUSD from the owner, temporarily approves exactly
that amount, deposits it through Perpl, and clears the allowance. It never uses
the reserve. `withdrawTrading` forwards a successful free-collateral withdrawal
to the owner; venue withdrawal limits still apply. `withdrawReserve` reduces
the tracked reserve without resetting the cap or historical spending.

`armPolicy` records a unique policy ID, a fee-inclusive cap, minimum top-up,
trigger/target buffers, fee rate/ceiling and a separate mark-age limit. Revocation
preserves the old policy's usage. Replacing an active policy requires revocation;
owner trading automatically revokes it. Re-funding an active reserve restores
spending availability within that policy's remaining cap.

The binding includes market, account, owner-action nonce, side, size, entry
price, **V2 price residue**, and entry block. Any allowed owner trade increments
the nonce before execution. IOC/FOK orders must leave no order locks; arming and
rescuing also require an empty lock array. A failed owner transaction rolls back
both its attempted trade and policy invalidation.

## Exact units and risk calculation

- AUSD, reserve, cap, fees, collateral and equity use CNS: `1 AUSD = 1_000_000`.
- Price and lot units use the market's `priceDecimals` and `lotDecimals`.
- Perpl's `perpMaintMarginFracHdths` is a **leverage-like divisor**, scaled by
  100. A returned value of `2500` means a factor of 25, or 4% maintenance.
- `maintenanceCNS = ceil(effectiveEntryPrice × size / factor)` in CNS.
  The effective entry includes the V2 Q16 residue: long stored prices round up,
  short stored prices round down.
- `equityCNS = depositCNS + deltaPnlCNS + premiumPnlCNS`. Aggregate `pnlCNS`
  is not added a second time. Premium PnL includes funding.
- Buffers use basis points **above maintenance**, not leverage or the price
  distance to liquidation: `threshold = ceil(maintenance × (10_000 + bufferBps) / 10_000)`.
- Rescue is eligible strictly below the trigger. The contract computes the
  amount needed to reach the target; callers cannot choose it. A required
  amount below the configured minimum is refused, not rounded up to a larger
  discretionary top-up.
- Fee is `min(floor(amount × feeBps / 10_000), feeMaxCNS)`. Amount plus fee must
  fit `min(reserveCNS, capCNS - usedCNS)`. There are no partial rescues.

Sources: the pinned [SDK position implementation](https://github.com/PerplFoundation/dex-sdk/blob/01b9910761755b0a0d9c710c1ede62ab937daa7d/crates/sdk/src/state/position.rs)
and [Perpl liquidation equations](https://docs.perpl.xyz/exchange/liquidation).
This corrects the provisional mark-notional multiplication in the architecture
conversation. That historical entry is retained rather than silently rewritten.

Perpl's `markPriceValid` must be true. Setsuna additionally rejects zero,
future-dated or over-age `markTimestamp` values against the owner's
`maxMarkAgeSec` (1–300 seconds). This is a separate, potentially stricter policy;
it does **not** assume that `refPriceMaxAgeSec` is Perpl's mark-age threshold.

## Atomicity and refusal semantics

`previewTopUp()` returns the current status, policy ID, quote, remaining spending
availability, maintenance/equity values and mark timestamp. Keepers must read
it again after restart and before submission.

Policy refusals return a status and emit `Refused` without moving funds.
An eligible rescue deposits into Perpl and increases position collateral, then
checks the exact collateral delta, unchanged binding, unchanged free Perpl
balance, actual AUSD debit, venue mark validity and target equity. Only then does
it increment spending and pay the caller. Any failed external call, unexpected
delta or failed fee transfer reverts the entire operation. Every reserve-moving
function is guarded against reentrancy and checks token balance ≥ reserve.

The cap limits additional spending through that policy. It does not cap overall
trading losses or guarantee that a rescuer reaches the chain before liquidation.

## Build and test

Requires Node 24+, Git and Foundry (`forge`, `anvil`, `cast`). Solidity is pinned
to 0.8.30, Cancun EVM, optimizer 200 runs. Dependencies are pinned by commit in
`contracts/dependencies.json`; the installer preserves existing directories.

```sh
npm ci
npm run setup:contracts
npm run contracts:build
npm run contracts:test
npm run contracts:test:fork
npm run test:keeper
```

Fork tests explicitly require `RUN_FORK=true`, set by the fork npm script.
Without that flag, they are skipped rather than accidentally contacting a node.
`MONAD_RPC_URL` can supply another mainnet archive-capable endpoint.

The fork is pinned at finalized block **108749101**, hash
`0x7ce374183bf2649f316a1bb1312074e9c37965995ecb60cdc947ab236bc67150`.
Exchange: `0x34B6552d57a35a1D042CcAe1951BD1C370112a6F`.
AUSD: `0x00000000eFE302BEAA2b3e6e1b18d08D69a9012a`.
The ABI subset is from SDK revision `01b9910761755b0a0d9c710c1ede62ab937daa7d`.

`PerplAccountProof.t.sol` is an unrestricted **test harness**, not a deployable
product account. `SetsunaFork.t.sol` exercises the actual production-source
account and factory. `Mocks.sol` supplies labelled fault injections, not claims
about native venue failure behavior.

The liquidation boundary tests locally grant the venue owner the position-admin
role and widen price tolerance, then move the mark above/below the predicted
threshold. Both long and short native liquidation paths are checked within two
PNS ticks. These are controlled fork experiments, not historical outcomes or
observations of an independently running production liquidator.

## Keeper and local demo

```sh
# Isolated local fork, synthetic funding, deploy, trade, arm and execute one rescue:
npm run demo:local

# Leave the prepared local fork running for further development:
npm run demo:local -- --keep --prepare-only

# One read-only keeper check (get the account from .local/demo.json):
npm run keeper -- --rpc http://127.0.0.1:18549 --chain-id 31337 --account 0xACCOUNT
```

The demo owns its Anvil child process, refuses an occupied port, binds loopback,
requires chain ID 31337, checks the upstream block hash and cleans up its child
on exit. The script uses Anvil's public development accounts; it never loads a
personal wallet key. Its clock advances one second per local block, and its
trigger is deliberately high so the pinned market immediately exercises a
rescue. Those fixture parameters are not recommended trading settings.

The keeper is read-only by default. Execution requires `--execute`, an explicit
gas-price ceiling and `KEEPER_PRIVATE_KEY` in the environment. Each transaction
has a 1,000,000 gas limit. Do not put keys in command arguments or source files.
`--watch` polls repeatedly; accounts are currently supplied explicitly with
repeated `--account` flags. There is no indexer-based account discovery yet.

The keeper simulates each eligible call, serializes submissions, waits for a
receipt and checks `ToppedUp` versus `Refused`. If confirmation becomes unknown,
it stops for reconciliation instead of repeatedly sending. Run one execution
process per signer. Profitability, persistent transaction recovery across process
restarts and production monitoring remain follow-up work.

## Remaining integration work

The contract/keeper core now has a connected Setsuna web application, including
Mera/browser wallet connection and local demo actions; see [WEB-APP.md](WEB-APP.md).
Native mobile flows, Envio account discovery, CRE execution,
device checks, public testnet deployment, G6/G7 usage/coverage research and trader
validation are separate remaining work. No mainnet deployment or public-chain
transaction is part of this milestone.

The fork cases establish tested paths, not an exhaustive proof of every future
venue upgrade, emergency unwind, ADL or trigger-order combination. Both published
forwarding methods were tested for the disabled-forwarding refusal. Independent
contract review and broader lifecycle coverage remain necessary before handling
real user funds. Venue proxy upgrades and token freezes remain external risks.
