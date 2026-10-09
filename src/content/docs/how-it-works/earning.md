Borrowers pay interest to lending markets. Setsuna's adapters track the vault's claim on those markets, so lending interest becomes part of the assets backing the shares.

## Interest stays in the position

Different protocols express the claim differently: an interest-bearing receipt balance, an exchange rate or supply-share accounting. The adapter converts that claim into the vault's underlying asset units.

This lets Setsuna compare and account for USDC positions in USDC and MON positions in MON, without adding their balances together as if they were the same asset.

## Refresh before settlement

The vault synchronizes its adapters before deposits, withdrawals and rebalances. Curvance explicitly accrues pending interest, including fee-share dilution, before the refreshed claim is used for settlement.

A read-only quote may differ from later refreshed accounting. User transactions therefore include minimum-output limits and deadlines.

## Expected rate and actual value

The rate is a current estimate. Share value reflects accounted assets, including gains and losses. Changes in utilization or protocol fees can affect future earnings without immediately changing the number of shares you hold.

The app's blended rate includes idle cash at zero. It is based on current holdings, not a hypothetical portfolio that has already reached its target allocation.

## What is outside this version

Setsuna does not currently harvest or sell incentive tokens, reinvest external reward emissions, run leveraged loops or learn allocations from a historical realized-yield model.

The implemented mechanism is direct lending with rate-based allocation and explicit limits. See [fees and yield](/docs/getting-started/yield/) for how to read the displayed numbers.
