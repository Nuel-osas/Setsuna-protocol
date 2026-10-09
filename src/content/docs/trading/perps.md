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

## Optional protection

A protection policy binds to a specific position and sets a fee-inclusive spending cap, trigger and target buffers, minimum top-up, and mark-price freshness limit.

When conditions are met, the contract computes the needed top-up. A caller cannot choose an arbitrary amount. Amount plus fee must fit the remaining policy cap and liquid reserve. There are no partial rescues.

Owner trading revokes the current policy; it must be reviewed and armed again for the new position. Revocation preserves the record of earlier spending.

> A protection cap limits additional reserve spending. It does not cap total trading losses, remove liquidation risk or guarantee that a rescue transaction lands in time.

## Demo price fixture

The tested trading environment uses synthetic funds and a disclosed **historical Perpl price fixture** with a fork-only oracle configuration change. It demonstrates the transaction workflow; it is not evidence of autonomous protection in live mainnet price conditions.

The [public demo](/app/) supports AUSD funding, BTC long/short trades, closing positions and withdrawing available collateral on the hosted fork. **Get test funds** provides synthetic AUSD; the demo uses a fixed historical BTC mark of **$82,964.20**. These transactions do not affect mainnet balances. Read [the current environments](/docs/developers/contracts/) for the network and deployed contracts.
