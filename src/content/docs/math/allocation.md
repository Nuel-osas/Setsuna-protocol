The multi-destination USDC allocator distributes investable assets in proportion to conservative accepted rate scores, subject to each destination's capacity. It is a bounded rule, not a claim of globally optimal portfolio selection.

## Establish the budget

```text
NAV = cash + sum(positions)
minimumCash = ceil(NAV × 10%)
investable = NAV − minimumCash
```

Each destination gets a ceiling. For the USDC multi-vault:

```text
ceiling[i] = min(
  NAV × 60%,
  currentPosition[i] + min(depositCapacity[i], NAV × 60%),
  availableMarketCash[i] × 10%
)
```

Disabled or ineligible destinations receive zero target allocation. Their existing claims are still included in NAV.

## Weight and redistribute

The allocator starts with proportional targets among eligible destinations. When one reaches its ceiling, its remaining weight is removed and unused budget is redistributed among the remaining eligible destinations. Integer arithmetic rounds allocations down.

For an illustration with 1,000 USDC of NAV and accepted scores of 2%, 3% and 5%, the 900-USDC investable budget initially targets **180 / 270 / 450 USDC** if no ceiling binds. The other 100 stays in cash.

If the third market has only 2,000 USDC of available cash, its 10% market-cash ceiling is 200. The remaining budget is redistributed to the first two markets, giving approximately **280 / 420 / 200**, if their other limits permit it.

## Targets are not immediate transactions

```text
gross movement = sum(withdrawals) + sum(deposits)
gross movement ≤ NAV × 10%
```

Moving 50 USDC from one protocol to another uses 100 USDC of gross movement. In a 1,000-USDC vault, that alone exhausts one rebalance's budget.

A normal rebalance must improve projected annual income using rates after the proposed movements. A limit repair can prioritize restoring limits over improving income. Execution checks accounting losses, exact token movement and resulting constraints atomically.

The two-destination setsMON core has its own tested planner and does not include this newer USDC market-cash ceiling. See [rebalancing](/docs/how-it-works/rebalancing/) for shared timing and policy values.
