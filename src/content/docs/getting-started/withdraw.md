Redeeming burns your vault shares and returns the corresponding underlying asset. There is no scheduled lockup, but your full position may not be withdrawable when lending-market cash is limited.

## Withdraw USDC

1. In the Earn card, select **Withdraw** and choose **setsUSDC** from the asset dropdown. Use the same environment where you deposited.
2. Enter the number of **setsUSDC shares** to redeem, or select **Max** for your currently withdrawable shares.
3. Check **You receive** for the estimated USDC output. The input is shares, which may have a different value in USDC. Expand **Transaction details** for available liquidity and the slippage limit.
4. Select **Withdraw USDC** and confirm.
5. After confirmation, check your wallet balance and remaining shares.

For example, 40 shares at a price of 1.02 USDC represent approximately 40.80 USDC before rounding. Entering 40 shares does not request exactly 40 USDC.

## Withdraw MON

Select the setsMON shares to redeem and approve the selected shares for the MON gateway. The gateway redeems them into WMON, unwraps it, and sends native MON to you in the same transaction.

If the recipient cannot accept MON, the transaction reverts rather than leaving a completed share burn without its payment.

## Where the payment comes from

The vault uses its cash first. If more is needed, it withdraws from the lending positions within their available cash limits. An adapter's accounting value is not a promise that every unit can be withdrawn immediately.

When liquidity is insufficient, you may be able to redeem part of your position and return later for the rest. Setsuna currently has no withdrawal queue. See [staying liquid](/docs/how-it-works/liquidity/).

## Quotes and confirmation

The app submits a minimum-output amount and a deadline. Interest accrual, rounding or changing venue conditions can change the amount between preview and settlement. An execution outside the submitted limits reverts.

A partial withdrawal leaves the remaining shares in your wallet. A full redemption removes your position, subject to base-unit rounding. Check pending transactions before retrying.
