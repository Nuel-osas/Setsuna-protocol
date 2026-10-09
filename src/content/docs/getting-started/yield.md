The base rate is an estimate of lending interest at the connected markets' current conditions. Your actual outcome is reflected in the underlying assets represented by your shares.

## APR is not a promise

**APR** annualizes a rate without assuming a particular compounding schedule. Setsuna displays base APR, not a guaranteed APY. Rates change as borrowing, available cash, fees and market configuration change.

The blended vault rate accounts for where the vault's assets are currently supplied. Idle cash contributes a zero lending rate. A newly funded vault can therefore show a lower blended rate before allocation catches up.

## Current Earn fees

| Cost                              | Current behavior                                     |
| --------------------------------- | ---------------------------------------------------- |
| Setsuna deposit fee               | None                                                 |
| Setsuna withdrawal fee            | None                                                 |
| Setsuna performance fee           | None                                                 |
| Earn keeper reward                | None paid by the vault                               |
| Network gas                       | Paid by the account sending the transaction          |
| Underlying protocol interest fees | Reflected in the adapter's net base-rate calculation |

This table applies to **Earn**. Spot execution, Perpl trading, funding and optional protection have their own costs.

## Where the interest goes

Interest stays in the lending position and increases the value backing the vault's shares. You do not need a separate claim transaction for that lending interest.

The current implementation does **not** harvest external reward tokens, swap incentive tokens or include bonus emissions in the displayed APR.

## Share value versus performance

A share-price increase can come from interest or a donation. A decrease can reflect losses or accounting changes. A current APR is not a historical return, and a simple change in share price is not necessarily organic yield.

The current app shows position value, rates and activity. A reconciled realized-performance ledger is still future work. Read [how rates are measured](/docs/math/apr/) for the calculation.
