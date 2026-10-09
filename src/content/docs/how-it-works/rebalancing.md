A rebalance moves the vault toward targets computed from protocol rates, market conditions and fixed limits. Anyone can submit the transaction; the contract decides whether there is an eligible move.

## Observe before acting

Two observations must be recorded at least **five minutes apart**. The latest observation must come from an earlier block. Stale observations cannot authorize a rebalance.

For each destination, current and observed rates must be positive, at most 100% APR, and within the configured spread bound. The lower accepted rate is used as the destination's weight.

## Apply the limits

| Rule                             | Current value                                  |
| -------------------------------- | ---------------------------------------------- |
| Target idle cash                 | At least 10% of vault assets while allocating  |
| Maximum destination exposure     | 60% of vault assets                            |
| USDC destination market-cash cap | 10% of the destination's available market cash |
| Minimum market size              | 250,000 units of the vault's underlying        |
| Factory deposit cap              | 25,000 units of the underlying                 |
| Gross movement per rebalance     | At most 10% of vault assets                    |
| Rebalance cooldown               | Ten minutes                                    |

For setsMON, the size floor and deposit cap are **MON amounts, not dollar values**. The additional market-cash exposure cap belongs to the newer multi-destination USDC core.

## Move gradually

The contract computes rate-weighted targets and redistributes capacity that would exceed a destination's limits. Actual movement is bounded. A transfer between protocols counts both the withdrawal and deposit toward the gross-movement budget.

A normal rebalance must improve projected annual income by at least 0.001 underlying tokens per year. That threshold is not a gas-profit calculation. A limit repair, such as restoring the cash buffer, can execute even if estimated income falls.

## What a keeper can change

A keeper can choose when to submit an eligible call. It cannot pass custom weights, a recipient address or an arbitrary protocol to the rebalancer. The same rules apply to a keeper and any other account.

## Read the decision in the app

Under each Earn allocation table, **Why this allocation** explains the contract preview at the displayed block. It distinguishes a cooldown, missing or stale observations, rate changes, insufficient projected gain and a limit-repair plan. An unavailable preview is reported as unavailable, without inventing a reason or proposed move.

Expand **Rate inputs used by the rule** to compare the two recorded rates with the current rate. When the contract returns a plan, its target amounts, proposed withdrawals and supplies, and positions after that move are shown separately. The full target can take several permitted rebalances to reach.

Projected annual base income describes the whole vault and is not realized earnings. A preview is not a completed transaction or a promise of execution. **Vault activity and public controls** links recorded events to the demo explorer so you can inspect what actually happened.

See [allocation and limits](/docs/math/allocation/) for a worked example.
