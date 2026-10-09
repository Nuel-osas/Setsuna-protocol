A share token is a receipt for a fraction of the assets held by a vault. It lets you follow one position while the vault manages multiple lending positions underneath.

## Two assets, two vaults

| Vault     | Underlying        | Share token | Underlying / share decimals |
| --------- | ----------------- | ----------- | --------------------------- |
| USDC Earn | Native Monad USDC | setsUSDC    | 6 / 12                      |
| MON Earn  | WMON              | setsMON     | 18 / 24                     |

The six extra share decimals improve precision. They do not multiply the human-readable value of your deposit. Initially, one human-readable share represents approximately one unit of the underlying.

## What changes as you earn

Suppose you hold 100 shares. Interest can raise the underlying value of those same 100 shares; Setsuna does not need to mint you extra shares to represent the gain.

Losses can reduce share value. Transfers move the claim to the recipient, and redemption burns shares to release the corresponding available underlying.

## The MON gateway

The setsMON vault accounts in WMON. The gateway wraps MON on deposit and unwraps WMON on redemption. It is a convenience path around the same share accounting, not a separate yield strategy.

## A fresh vault for a new configuration

Adapter destinations are fixed at initialization. The five-protocol USDC vault is a new deployment, separate from the earlier four-protocol vault. Old positions are not automatically migrated when a new deployment is created.

Always check the vault address and environment. Identical symbols or even identical addresses on different forks do not establish the same pool of assets.

For the exact conversion and rounding rules, see [shares and exchange rate](/docs/math/exchange-rate/).
