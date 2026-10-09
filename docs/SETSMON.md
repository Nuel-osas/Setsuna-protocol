# setsMON implementation and demo

**Codex · 4 October 2026.** Completed the user's requested MON Earn implementation before expanding Spot and Perps. The contracts and native-MON app flow are implemented and tested against real protocol contracts on a pinned Monad mainnet fork. This is a prototype using synthetic funds, with no public Earn deployment or customer deposits.

## Try it

From `setsuna/`, with Foundry on `PATH`:

```sh
# Terminal 1: deploy the contracts on an owned local fork, seed 1,000 synthetic MON,
# prepare the observations/allocation, and run the local executor.
npm run earn:demo

# Terminal 2: start the app with the local Earn manifest.
npm run dev:earn
```

Open **http://localhost:3007/app/**. Select **MON** in the Earn card’s asset dropdown, then **Connect account → Try the local demo account**. Enter a MON amount and deposit. The position shows actual receipt shares and their redeemable MON value. Select **Withdraw → Max → Withdraw MON**; the flow approves the selected shares and then redeems them for native MON. Each action is simulated before submission. The local account signs synthetic-fund transactions without a wallet extension; connected wallets still request their normal confirmations.

The app reads balances, rates, liquidity and events from the same local RPC, **http://127.0.0.1:18607**, chain **31337**. `.local/setsmon/demo.json` contains the deployment manifest; `.local/setsmon/transactions.json` records seeding and executor receipts. The fork retains mainnet venues but has its own state and clock. Nine initial allocation steps advance the clock explicitly; the running demo then advances 15 chain seconds per executor check. Prices, utilization and borrowing do not receive new mainnet transactions. Interest does accrue under the forked contracts as simulated time advances.

The script refuses an occupied port and stops only the Anvil process it started. No public-chain writes, private keys, or user wallet funding are required. The separate original Perpl demo remains on RPC port 18549 and app port 3000. The two demos are not yet one shared portfolio/environment.

## Asset and venues

```text
native MON → fixed gateway → WMON → setsMON vault
                                      ├── Neverland WMON reserve
                                      ├── Euler WMON lending market
                                      └── idle WMON buffer
native MON ← fixed gateway ← redeemed WMON
```

| Contract | Monad mainnet address |
|---|---|
| Canonical WMON, 18 decimals | `0x3bd359C1119dA7Da1D913D1C4D2B7c461115433A` |
| Neverland pool | `0x80F00661b13CC5F6ccd3885bE7b4C9c67545D585` |
| Neverland data provider | `0xfd0b6b6F736376F7B99ee989c749007c7757fDba` |
| Neverland nWMON receipt | `0xD0fd2Cf7F6CEff4F96B1161F5E995D5843326154` |
| Euler WMON, K3 Isolated shMON-WMON-USDC | `0x7B4BcAEAC5Eb67ae947903F24BBa660eE06A5231` |

These are direct lending destinations. Setsuna does not stake MON into an LST, take leverage, or swap between assets. Borrower collateral and the venues' governance still introduce risks. Euler's selected market is governed/curated; Setsuna's allocation rules do not make the underlying protocols immutable.

WMON and Neverland's receipt/pool are listed in [Neverland's official address book](https://github.com/Neverland-Money/neverland-wrapped-tokens/blob/main/src/NeverlandAddressBook.sol). Euler's selected market appears in its [official Monad labels](https://github.com/euler-xyz/euler-labels/blob/development/143/products.json). All selected addresses were checked on chain at the proof block. Aave's Monad pool had no WMON reserve there; the Morpho API returned only a tiny, unborrowed WMON market. Neither was used to manufacture a second active destination.

Neverland uses the older [Aave-derived rate-model interface](https://github.com/neverland-money/neverland-lending/blob/main/contracts/protocol/pool/DefaultReserveInterestRateStrategy.sol), not Aave's newer virtual-balance ABI. Its adapter projects the actual reserve rate with proposed additions/withdrawals. Euler's adapter calls the [EVK interest-rate model](https://github.com/euler-xyz/euler-vault-kit/blob/master/src/InterestRateModels/IIRM.sol) with projected cash and accrued borrows, deducting the venue's interest fee. At the proof block that fee was 10%. It checks share claims, cash, operation limits and the fixed model, and rejects new exposure when its model or hook configuration changes. Existing claims can still be redeemed when the venue permits it.

## Exact policy and permissions

Both Earn vaults inherit [`SetsunaEarnCore.sol`](../contracts/src/earn/SetsunaEarnCore.sol). The USDC constructor, units and limits are preserved. [`EARN.md`](EARN.md) documents the shared algorithm and the separate USDC configuration.

| Setting | setsMON |
|---|---|
| Underlying / shares | WMON, 18 decimals / setsMON, 24 decimals |
| Initial human-readable share exchange rate | 1 setsMON represents approximately 1 MON, before accrual/donations/losses |
| Factory deposit cap | 25,000 MON of total vault assets |
| Minimum supplied market size | 250,000 MON, **not $250,000** |
| Allocation limits | Target ≥10% idle; ≤60% per venue; ≤10% gross movement per rebalance |
| Observation and execution timing | Observations ≥5 minutes apart; latest in an earlier block; 10-minute rebalance cooldown |
| Minimum projected annual gain | 0.001 MON/year, except limit repairs; not a gas-profitability calculation |
| Accounting rounding allowance | Four wei of WMON per operation |
| Setsuna fee / keeper reward | Zero / zero |

Both destinations exceed the supply floor at block 110418863. The seeded fork reaches approximately **30% Neverland / 60% Euler / 10% cash** under its then-current rates. This is a measured fork allocation, not a permanent promised split. Rates, caps, eligibility, withdrawals and interest can change actual weights. The contract uses APR, excluding external incentive tokens, rather than a historical yield model or an AI risk score.

The factory initializes both fixed adapters atomically. Its helpers accept calls only from the factory. No contract supports upgrades, arbitrary routing, changing weights, adding a venue, or an administrative withdrawal. The guardian may permanently pause deposits or disable a venue for new allocation; it cannot re-enable them or seize funds. External protocol governance remains outside those guarantees.

The gateway wraps exactly the supplied MON and sets the vault's share receiver explicitly. A native exit always redeems the caller's approved shares; there is no caller-supplied owner parameter. Share burning, lending withdrawals, unwrapping and native payment are atomic. A rejecting recipient, slippage violation or expired deadline rolls the operation back. It clears token approvals, preserves unrelated dust, rejects direct native transfers except from WMON and blocks reentrancy. Users may also interact with the ERC-4626 vault directly in WMON.

Healthy valuation and available liquidity are both required for withdrawals. A failed venue valuation blocks share pricing even if idle cash exists. There is no asynchronous withdrawal queue. The cash buffer is shared liquidity, not an individual guaranteed withdrawal allotment.

## Executor and app

`earn-keeper.mjs` now accepts `--asset MON` and a MON-denominated gain floor. USDC remains the default; the legacy USDC-only floor flag cannot be used with MON. The CLI rejects an underlying-asset mismatch and retains durable pending-transaction reconciliation, simulation and gas limits.

```sh
# Read-only inspection of a reviewed deployment whose RPC reports chain 143.
node scripts/earn-keeper.mjs --asset MON --vault "$EARN_VAULT" --rpc "$MONAD_RPC_URL"
```

For signing, the existing explicit `--execute`, private environment signer and gas-price ceiling are required. This CLI example is not pointed at the 31337 demo; that demo runs its own explicitly local unlocked executor. The production keeper is a funded external caller, not an onchain timer. No public keeper deployment is claimed.

The UI uses 18 decimals for MON and 24 for shares, current operation limits, a 0.1% quote bound and a ten-minute chain-time deadline. It reserves 0.1 MON in input validation for gas; actual transaction fees are estimated separately. Failed reads clear the snapshot and disable transactions. Submitted hashes are retained for receipt checking, with local browser persistence when available, and another action is disabled while confirmation is pending. Token approvals cover only selected shares. The MON demo does not display mainnet research rates beside fork execution.

## Evidence

Pinned source network: **Monad 143**, block **110418863**, hash **`0xed4f56748e560219f9926e46d78591ec746b5bca4497e65d0734062fbb46a97b`**, timestamp **1791102539**. Fork tests assert the timestamp and parent hash. Mainnet data is read-only; funds are synthetic.

- 12 MON unit/fuzz tests: native entry/exit, 24-decimal shares, tiny/full-size entries, failed native payments, reentrancy, wrong decimals, unauthorized redemption, deadline/slippage, forced dust, cash-only partial liquidity, recognized loss and pause behavior.
- Eight MON fork tests: atomic deployment/contract sizes, both destinations, partial/full native exits, accrued valuation, actual projected rates, approvals/authority, disabling a venue, and changed rate-model configuration without trapping otherwise redeemable claims.
- Full regression: **94 Solidity tests, zero failures/skips**, including all existing USDC and Perpl suites; **18 executor tests** (12 Earn + six protection).
- Seven simulated days after allocation: **1,000 MON → 1,001.090799094980475682 MON** returned across partial and final exits. This is a reproducible accounting test under snapshot conditions, not a forecast or observed mainnet customer yield.
- Browser: **42.125 synthetic MON deposited and withdrawn**, shares and cleared allowances verified onchain; local wallet connection, invalid amounts, activity, mobile 390px and RPC-failure behavior checked without runtime errors.
- TypeScript and production Next.js build pass. Physical passkey devices, production wallets and a public hosted fork are not established by the browser test.

```sh
npm run contracts:test:mon
RUN_FORK=true forge test --root contracts -vv
node --test scripts/earn-keeper-core.test.mjs scripts/keeper-core.test.mjs
node scripts/check-setsmon.mjs  # running local demo + empty demo account required
npm run typecheck
SETSUNA_DIST_DIR=.next-setsmon-build npm run build
```

[Machine-readable evidence and source hashes](research/setsmon-2026-10-04.json). Raw receipts, full test output and browser screenshots are under `.local/setsmon/`.

## Handoff to Claude / next work

**Codex input:** setsMON now has implementation, fork evidence and an app transaction flow. Preserve the exact assets/decimals and the fork label when refining the design. The old five-market USDC research widget is not the MON vault's holdings or a substitute for contract reads.

Spot and the expanded Perps experience can now proceed. The existing Perpl account/protection contracts still use **AUSD** for collateral and reserve. `setsMON` and `setsUSDC` are Earn receipt tokens only. A shared deployment environment, completed Kuru route, unified portfolio, public hosted demo, independent security review, realized-performance index and production operations remain separate work. No claim of audit, principal protection, unique invention, product-market fit or guaranteed hackathon result follows from these tests.
