Setsuna integrates **Perpl** for perpetual trading and uses **AUSD** as collateral. The current contract integration targets the BTC market, with an optional reserve for bounded margin top-ups.

## Three separate balances

| Balance                  | Purpose                                                           |
| ------------------------ | ----------------------------------------------------------------- |
| Perpl trading collateral | Supports the trading position                                     |
| Protection reserve       | Pays eligible, capped margin top-ups and configured executor fees |
| Earn vault assets        | Back setsMON or setsUSDC; cannot fund trading or protection       |

The account owner funds trading and the reserve separately. An ordinary trade cannot consume the protection reserve.

## Trading lifecycle

Create your Setsuna account, deposit AUSD as trading collateral, review a long or short order and confirm it. The app reports actual fills and fees, supports reducing or closing a position, and lets you withdraw venue-available collateral.

Unfilled or rejected orders must be distinguished from completed trades. Pending transaction receipts are retained so a reload does not require blindly resubmitting the same action.

## Market and limit orders

**Market** takes a current order-book price and applies your maximum slippage (0.01%–5%). The order must fill in full within that price bound or it does not fill. Review quotes expire after 30 seconds. This is a price-bounded fill-or-kill order on Perpl.

**Limit** uses your chosen price and leaves unfilled size open until filled or cancelled. The **Open orders** list reads remaining size from Perpl and provides cancellation. Cancelled orders release their locked collateral back to the trading account, subject to the venue's accounting.

Resting limits require the updated Setsuna account contract. Existing accounts are immutable and do not gain this capability automatically; existing positions and funds must be closed or withdrawn before moving to a new account deployment.

## Optional protection

A protection policy binds to a specific position and sets a fee-inclusive spending cap, trigger and target buffers, minimum top-up, and mark-price freshness limit.

When conditions are met, the contract computes the needed top-up. A caller cannot choose an arbitrary amount. Amount plus fee must fit the remaining policy cap and liquid reserve. There are no partial rescues.

Owner trading revokes the current policy; it must be reviewed and armed again for the new position. Revocation preserves the record of earlier spending.

Protection cannot be armed while an order remains open: a later fill could change the position. Fill or cancel the outstanding orders before reviewing a new protection policy. Closing a position remains available from the position panel.

> A protection cap limits additional reserve spending. It does not cap total trading losses, remove liquidation risk or guarantee that a rescue transaction lands in time.

## Network

Perps runs on **Monad mainnet**. [Trade](/trade/?mode=perps) opens BTC positions on Perpl at live prices with your own AUSD. Each protection top-up pays Setsuna 1% of the amount added, inside your cap. Setsuna's contracts are unaudited; trade small. Read [the current environments](/docs/developers/contracts/) for the deployed contracts.
