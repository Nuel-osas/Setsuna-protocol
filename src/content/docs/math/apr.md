Adapter rate outputs use **WAD annual APR**: `1e18` represents 100% per year. A rate of `0.05e18` represents 5% APR.

## Protocol-derived estimates

Aave and Neverland read/project their reserve lending rates. Morpho and Euler derive lending rates from the selected market's borrowing, cash and fee configuration. These values are current estimates, not historical measured returns.

Curvance uses a conservative estimate:

```text
borrowRate = min(active vesting rate, predicted post-allocation rate)
utilization = debt / (cash after proposed movement + debt)
supplyAPR = borrowRate × secondsPerYear × utilization × (1 − interestFee)
```

Curvance's rate inputs are per-second WAD values. Its interest fee uses basis points. The adapter does not use the protocol's frontend-only supply-rate helper for onchain allocation.

## Spaced observations

The allocator compares three values: the previous observation, latest observation and current quote. A destination's score is the lowest accepted rate.

```text
low  = min(previous, latest, current)
high = max(previous, latest, current)

eligible rate: low > 0
               high ≤ 100% APR
               high − low ≤ 10% × low
```

Observations must be at least five minutes apart. The latest may be at most 30 minutes old; the previous may be at most 60 minutes old. The latest must be from an earlier block.

These checks bound timing and rate dispersion. They do not measure the probability of a protocol failure.

## Blended vault rate

```text
estimated annual income = sum(position[i] × APR[i])
blended APR = estimated annual income / total vault assets
```

Positions and total assets are in the same underlying units. Idle cash contributes zero lending interest. If total vault assets are zero, the displayed blended rate is zero.

The UI annualizes these rates without adding incentive tokens or promising compounding. A mainnet quote must not be presented as the execution rate for a different fork.
