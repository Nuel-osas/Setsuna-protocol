Setsuna's Spot workspace swaps MON and USDC at the best price across Monad, routed by **KyberSwap**, and places limit orders on **Kuru's** MON/USDC book. Funds come from your wallet, not your Earn vault or Perps protection reserve.

## Market swaps

1. Open **Spot** and connect your wallet.
2. Choose what to swap: MON, USDC or AUSD, in either direction.
3. Enter an amount and review the route, the minimum you'll receive and Setsuna's fee.
4. Approve the exact amount when selling USDC or AUSD; a native MON input uses transaction value.
5. Confirm the swap and check the balance changes after settlement.

KyberSwap splits a swap across Monad's pools (Uniswap v4, Curve, Balancer and others) for the best price. You sign the router call from your own wallet; Setsuna never holds the funds. The app only accepts a route built for KyberSwap's router at `0x6131B5fae19EA4f9D964eAc0408E4408b66337b5` and refuses any other. The minimum output allows 0.5% slippage; a swap that would fill below it reverts.

## Limit orders

Switch **Market → Limit**, choose Buy or Sell, and enter a MON size and USDC limit price. Create your Spot limit account once, then review the amount required from your wallet and confirm.

Buy orders execute at the limit price or lower; sell orders execute at the limit or higher. An order can fill immediately, partially, or rest until it fills or you cancel it. Kuru enforces the market's minimum size and price increment, shown in the form.

Each wallet has its own Spot order account. Existing free funds are used before new wallet funds. **Open orders** shows the remaining size and lets you cancel it. Cancellation releases the unfilled funds to **Balances**, where you can withdraw free MON or USDC. Filled proceeds also stay in this trading balance until reused or withdrawn. Wallet balances exclude these funds; Portfolio lists them separately.

The limit-order account does not charge a Setsuna fee; venue fees still apply. A successful placement transaction is not a promise that the entire order filled.

### When limit orders pause

A limit order is only as good as the book it rests on. The workspace compares Kuru's MON/USDC book with MON's live price, read from the Chainlink feed behind Perpl's MON market (refused when older than 5 minutes). Limit orders pause when Kuru's book has not traded for 24 hours, or when its last price is more than 10% away from the live price. The header then shows the live MON price and when Kuru last traded.

While paused, market swaps still fill at the live price through KyberSwap, and existing orders can still be cancelled under **Open orders**. Kuru's MON/USDC book has not traded since 21 October 2026, so limit orders are paused for now.

## Market data and execution

The chart, order book and trades show Kuru's MON/USDC market. Market swaps don't use Kuru's book, so their price comes from the KyberSwap route, not from the order book. The workspace reports actual receipts and fills after confirmation. If a quote cannot be obtained or the transaction simulation fails, review the error before submitting again.

Spot changes your asset exposure. Swapping MON for USDC does not automatically deposit that USDC into Earn; supplying it is a separate action.

## Fees and network

Spot runs on **Monad mainnet** with your own funds. [Trade](/trade/?mode=spot) takes 0.10% of each market swap's input, paid by KyberSwap's router to Setsuna's treasury `0x6915aEf0947F4daD61aeF39Fe0f546A03190c92C`. Limit orders carry no Setsuna fee. Setsuna's contracts are unaudited; trade small.

For the market and contract addresses, see [networks and contracts](/docs/developers/contracts/).
