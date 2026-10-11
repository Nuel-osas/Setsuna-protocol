Setsuna's Spot workspace executes MON/USDC swaps through the selected **Kuru** market on Monad. Funds come from your wallet, not your Earn vault or Perps protection reserve.

## The current flow

1. Open **Spot**, connect your wallet and check the environment.
2. Choose the direction: MON to USDC or USDC to MON.
3. Enter an amount and review the executable quote, minimum output and price impact.
4. Approve the required USDC amount when selling USDC; a native MON input uses transaction value.
5. Confirm the swap and inspect the actual fill and balance changes after settlement.

The gateway checks the fixed market and token pair and enforces the transaction's output bound. A displayed order book does not imply that every exchange order type is implemented in Setsuna's gateway.

## Limit orders

On deployments with limit orders enabled, switch **Market → Limit**, choose Buy or Sell, and enter a MON size and USDC limit price. Create your Spot limit account once, then review the amount required from your wallet and confirm.

Buy orders execute at the limit price or lower; sell orders execute at the limit or higher. An order can fill immediately, partially, or rest until it fills or you cancel it. Kuru enforces the market's minimum size and price increment, shown in the form.

Each wallet has its own Spot order account. Existing free funds are used before new wallet funds. **Open orders** shows the remaining size and lets you cancel it. Cancellation releases the unfilled funds to **Balances**, where you can withdraw free MON or USDC. Filled proceeds also stay in this trading balance until reused or withdrawn. Wallet balances exclude these funds; Portfolio lists them separately.

The limit-order account does not charge a Setsuna fee; venue fees still apply. A successful placement transaction is not a promise that the entire order filled.

Limit orders require new contracts. Existing deployments without them continue to support market swaps and display the limitation when you select Limit.

## Market data and execution

Quotes and execution must use the same connected environment. The workspace reports actual receipts and fills after confirmation. If a quote cannot be obtained or the execution simulation fails, review the error before submitting again.

Spot changes your asset exposure. Swapping MON for USDC does not automatically deposit that USDC into Earn; supplying it is a separate action.

## Network

Spot runs on **Monad mainnet**. [Trade](/trade/?mode=spot) swaps MON and USDC on Kuru's live MON/USDC book with your own funds. Setsuna takes 0.10% of each swap's output. Its contracts are unaudited; trade small.

For the selected market address and mainnet setup, see [networks and contracts](/docs/developers/contracts/).
