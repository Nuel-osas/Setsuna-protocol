# Setsuna Earn implementation

**8 October 2026 — Codex update:** The new four-protocol setsUSDC v2 is implemented, fork-tested and connected to the local app. Read [USDC-V2.md](USDC-V2.md) for current behavior. The two-adapter implementation documented below is preserved as historical v1; setsMON still uses that version of the shared core.

**Author: Codex · 2 October 2026; updated 4 October.** This guide describes the implemented USDC vault and shared allocation logic. The separate native MON vault, gateway, Neverland/Euler adapters and app flow are now implemented: [setsMON guide](SETSMON.md). No public Earn deployment or customer deposits are established. Kuru Spot and the expanded AUSD-based Perpl experience remain follow-up work.

The contract chooses each allocation. Any account can record fresh protocol rates and execute a permitted rebalance; callers cannot supply weights, APR values, recipients, or arbitrary external calls. The initial adapters lend directly to Aave V3 and one Morpho Blue market on Monad. SAM informed the product pattern; no SAM contract source was copied.

## Implemented boundary

| File | Responsibility |
|---|---|
| [`SetsunaEarnCore.sol`](../contracts/src/earn/SetsunaEarnCore.sol) | Shared ERC-4626 accounting, bounded entry/exit, observations, allocation and validation |
| [`SetsunaEarnVault.sol`](../contracts/src/earn/SetsunaEarnVault.sol) | USDC-specific name, decimals, constructor and policy units |
| [`AaveUSDCAdapter.sol`](../contracts/src/earn/AaveUSDCAdapter.sol) | Actual aUSDC claims, reserve cash/cap/status, Aave rate-model projection, exact supply/withdrawal |
| [`MorphoUSDCAdapter.sol`](../contracts/src/earn/MorphoUSDCAdapter.sol) | Direct market claims, fee-share dilution, third-order interest accrual, cash and rate projection |
| [`SetsunaUSDCFactory.sol`](../contracts/src/earn/SetsunaUSDCFactory.sol) | Atomic creation and initialization, fixed Monad addresses, caller becomes guardian |
| [`earn-keeper.mjs`](../scripts/earn-keeper.mjs) | Read-only inspection or one bounded public execution; durable transaction tracking |

Vaults and adapters have no upgrade or replacement functions. The factory uses three separate creation-code holders to stay within contract runtime and creation-size limits. These helpers accept calls only from their factory. They add no post-initialization strategy control.

Only the vault can call its adapters' state-changing methods. Withdrawn USDC always returns to the vault. Every approval is limited to the immediate amount and cleared afterwards. The guardian can permanently stop deposits or permanently disable a destination for new allocation. It cannot withdraw users' assets, re-enable a destination, change weights, or replace contracts. Disabled claims remain in accounting and can still be redeemed.

## Exact prototype policy

| Setting | Enforced value |
|---|---|
| Asset / share decimals | Native Monad USDC: 6 / `setsUSDC`: 12 |
| Factory deposit cap | 25,000 USDC of total vault assets |
| Minimum destination market supply | 250,000 USDC |
| Idle cash target | At least 10% of NAV when allocating; withdrawals may consume it |
| Maximum destination exposure | 60% of NAV; existing drift must not increase |
| Maximum movement | 10% of NAV per rebalance, counting **withdrawals plus deposits** |
| Rebalance cooldown | 10 minutes |
| Rate observations | At least two, at least 5 minutes apart; latest from an earlier block |
| Observation expiry | Latest at most 30 minutes old; previous at most 60 minutes old |
| Rate consistency | Spread among previous/latest/current at most 10% of the lowest; APR no greater than 100% |
| Minimum projected improvement | 0.001 USDC/year, except moves repairing exposure, eligibility, or buffer limits |
| Permitted accounting rounding loss | 4 micro-USDC per operation, absolute rather than percentage |
| Setsuna fees / executor reward | Zero / zero |

Each eligible destination's score is the lowest of its two recorded and current **base supply APRs**. Two-pass proportional allocation applies the exposure cap; unplaceable funds stay idle. This is an understandable allocation rule, **not an optimizer proven to maximize return**. Destination incentives are excluded. APR is annualized and scaled by `1e18`; do not label it APY.

The plan withdraws first and deposits second. Ordinary reallocations reserve half the movement budget for redeployment; repair moves can use the entire budget to withdraw. Deposit capacity and withdrawable cash are checked separately. Expected income after movement uses the actual destination rate model with the proposed cash flow. The vault recomputes the entire plan during execution, checks exact balance changes, and rejects excess accounting loss or worsening exposure limits. Projection is an estimate, not a guaranteed return.

**The default factory currently has one eligible destination at the proof block.** Its fixed Morpho WBTC/USDC market has approximately 105,538 USDC supplied, below the 250,000 floor. Its target is therefore zero; with Aave's 60% cap, the remaining 40% stays idle. The rule has not been weakened to make a better headline rate. The two-protocol integration test explicitly deploys a separate **100,000 USDC minimum** profile to exercise both real protocols. That test profile is not the factory configuration or an approval of this market for customer funds.

Claude's [additional market probes](research/earn-markets-2-2026-10-02.md) introduce Euler, Neverland, and aHYPER-backed Morpho candidates. Their successful direct calls are useful discovery evidence. They are not implemented USDC destinations in this two-adapter vault. Neverland and Euler are now implemented separately for WMON in setsMON. aHYPER adds the underlying managed strategy's risks; a larger supplied balance alone is insufficient for acceptance.

## Shares, earnings, and withdrawals

OpenZeppelin 5.4.0 provides ERC-4626 conversions with six additional share decimals and virtual assets/shares. Actual adapter claims plus idle USDC determine NAV. Deposits remain idle until a permitted rebalance. Accrued lending interest and recognized losses change the share claim, not the user's share count. Donations change NAV but never supply the allocation APR; a future performance index must distinguish them from organic yield.

Every share-changing call refreshes both adapters first. If a destination valuation fails, `accounting()` exposes cached display values with `healthy = false`, and operation limits become zero. The vault does not mint or redeem at a knowingly stale valuation. This also means healthy accounting is required to withdraw from the idle buffer.

Withdrawals consume idle USDC, then available adapter cash in fixed order. Exact payment and accounting checks are atomic with burning shares. Lack of liquidity reverts the whole request. No asynchronous redemption queue is implemented. `maxWithdraw` and `maxRedeem` are estimates for current chain state; other users share the same liquidity.

Use `depositWithMinShares(assets, receiver, minShares, deadline)` and `redeemWithMinAssets(shares, receiver, owner, minAssets, deadline)` in the UI. Standard ERC-4626 entries remain available. The full-redemption tests include a recognized loss and the virtual-asset rounding edge that otherwise prevented the last depositor from exiting.

## Public executor

The CLI inspects all decision inputs at one block. It gives an executable rebalance priority over recording another observation, preventing a periodic observation job from starving execution. A fresh simulation, gas-price ceiling, gas-limit bound, and optional higher annual-gain floor precede signing. The executor pays its own MON gas and receives no vault reward. The annual USDC gain floor does **not** convert MON gas to USDC or establish profitability; funding and operating economics remain the operator's responsibility.

```sh
# Build artifacts and export the ABIs used by the CLI and frontend.
forge build --root contracts --skip test --skip script
node scripts/export-abis.mjs

# Read-only; set MONAD_RPC_URL and EARN_VAULT to your reviewed fork deployment.
node scripts/earn-keeper.mjs --vault "$EARN_VAULT"

# Explicitly authorize one transaction, using a separately funded dedicated signer.
# Set EARN_KEEPER_PRIVATE_KEY privately in the environment; do not commit it.
node scripts/earn-keeper.mjs --vault "$EARN_VAULT" --execute \
  --max-gas-price-gwei 100 --max-gas 1000000 --min-annual-gain-usdc 0.001
```

These are configuration examples, not a claim that a deployment exists or that 100 gwei is an economical ceiling. The RPC must report chain ID 143, including a local Monad fork. Vault identity, the endpoint, and the deployment's configuration must be reviewed before operating it. The CLI checks initialized status and the underlying asset; it is not a bytecode attestation service.

Execution signs locally and saves the transaction hash, signer, nonce, chain, vault, and operation **before broadcasting**. State files are atomically replaced and flushed to disk. A lock covers the signer across vaults. A restart first reconciles pending work, verifies the expected event, and records success or a mined revert. Missing receipts, lost RPC responses, or a success receipt without the expected event stop further submissions. It never silently chooses another nonce or replaces a transaction.

State defaults to `.local/earn-executor/`. Use one state directory and a dedicated signer across all invocations. The lock does not coordinate different directories, machines, or other signing software. After an abnormal process exit, check that no process still owns the lock before removing a stale `.lock` file. Preserve the `.json` transaction state. An unknown transaction requires checking its hash and signer nonce on the intended chain before any manual resolution; elapsed time is not evidence that it was never sent. Receipt confirmation is one block; this prototype does not implement reorg-aware finality monitoring or an unattended alerting service.

## Reproduce the evidence

```sh
# Unit/fuzz + actual pinned-protocol integration + original contract regression.
RUN_FORK=true forge test --root contracts -vv

# Earn only; RUN_FORK must be true or its fork tests are skipped.
RUN_FORK=true forge test --root contracts --match-contract 'SetsunaEarn(Test|ForkTest)' -vv

# Executor behavior and existing protection keeper regression.
node --test scripts/earn-keeper-core.test.mjs scripts/keeper-core.test.mjs
```

The new contract suites cover public execution, immutable authority, exact assets and recipients, rate spikes/staleness, cooldown, projected-rate rejection, movement/exposure bounds, deposit caps, donation inflation, losses, low liquidity, faulty adapters, reentrancy, deadlines, and full redemption. Unit fault injection is synthetic. Fork tests use the real lending contracts, synthetic depositor USDC, and simulated time; no venue administrator is impersonated in these new tests.

The six new integration tests pin Monad block `109894238`, hash `0x3eecc9010c1283f06368591874bcfeac276ceb12e2920388292053498ce09923`, timestamp `2026-10-02T12:28:58Z`. A 1,000 USDC deposit reaches approximately 600.001572 Aave, 300.000786 Morpho, and 100.000263 idle after the controlled allocation sequence, then redeems 1,000.002620 USDC with one micro-USDC residual NAV. After seven additional simulated days, another test redeems 1,000.529798 USDC. These are deterministic fork outcomes, not historical customer returns or forecasts.

The tests also prove that the normal factory preserves the 250,000 size gate and that projected rates match rates after an actual supply. Full test results, exact source hashes, dependency pins, and bytecode sizes are in [the implementation evidence](research/earn-core-2026-10-02.json). Original direct-venue discovery remains in [the earlier proof](research/earn-markets-2026-10-02.md).

## Remaining delivery work

This implementation establishes contract behavior, not production readiness or unique PMF. Spaced observations and rate bounds reject tested abrupt changes; they do not establish resistance to sustained manipulation or observation griefing. A below-size destination's rate can still block planning if it becomes unstable. Pauses and upgrades in an external protocol can change integration behavior even though Setsuna's own addresses are fixed.

Market supply, exposure caps, and executable cash are not a complete risk model. In particular, no independently reviewed cap relative to market cash or aggregate collateral exposure is implemented. Direct Morpho inherits collateral, oracle, liquidation, and IRM risks; Aave has reserve and governance risks. Both share Monad and USDC dependencies. The default deployment's second eligible destination, external-authority review, operational monitoring, and independent security review remain open.

The separate [setsMON implementation](SETSMON.md) now includes a locally deployed native-MON app flow. USDC app deposits, a public hosted fork/Tenderly endpoint, a realized-performance index and production deployment remain open. The five-market USDC research estimate is separate from this vault’s two fixed adapters and from actual MON holdings. The 2 October hashes below are a historical snapshot; the 4 October evidence records the extracted shared core and preserves the USDC regression.

For positioning, see the [updated competitor review](research/earn-competition-2026-10-02.md). Several core ideas already exist, including a close published Monad proposal. The defensible demo is the implemented rule, visible permissions, and independently reproducible movement of funds.
