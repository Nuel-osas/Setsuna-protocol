A Setsuna Earn vault holds one underlying asset across cash and lending positions. Deposit and redemption transactions change the number of shares; lending interest changes the assets backing those shares.

## The lifecycle

1. **Deposit.** Assets enter the vault and shares are minted at the refreshed exchange rate.
2. **Observe.** Public calls record protocol rates at spaced intervals.
3. **Allocate.** The contract computes eligible targets and moves toward them within fixed limits.
4. **Accrue.** Interest in the lending positions contributes to vault value.
5. **Redeem.** Shares are burned and the underlying asset is returned from available liquidity.

The steps are separate. A deposit can remain in cash until an eligible rebalance executes.

## The pieces

| Piece             | Purpose                                                  |
| ----------------- | -------------------------------------------------------- |
| Vault             | Holds pooled assets and issues ERC-4626 shares           |
| Adapter           | Connects the vault to one fixed lending destination      |
| Share token       | Records your proportional claim on the vault             |
| Cash buffer       | Keeps part of the underlying available inside the vault  |
| Rate observations | Store protocol-derived inputs for allocation checks      |
| Keeper            | Watches the contract and submits eligible public actions |

## A transaction has boundaries

Before changing ownership balances, the vault refreshes its accounting. Deposits and withdrawals check actual token movement. Temporary approvals are cleared after use, and a failed transaction rolls back its state changes.

The keeper is a transaction sender, not a discretionary fund manager. Targets are computed by the contracts, and funds can move only through their fixed adapters.

## Separate asset pools

setsUSDC holds USDC claims. setsMON holds WMON claims and uses a gateway for native MON. The vaults do not swap between those assets or use leverage.

Spot and Perps are separate execution paths in the same app. Learn more about [where your funds go](/docs/how-it-works/where-funds-go/).
