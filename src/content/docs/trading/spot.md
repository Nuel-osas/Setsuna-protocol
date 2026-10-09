Setsuna's Spot workspace executes MON/USDC swaps through the selected **Kuru** market on Monad. Funds come from your wallet, not your Earn vault or Perps protection reserve.

## The current flow

1. Open **Spot**, connect your wallet and check the environment.
2. Choose the direction: MON to USDC or USDC to MON.
3. Enter an amount and review the executable quote, minimum output and price impact.
4. Approve the required USDC amount when selling USDC; a native MON input uses transaction value.
5. Confirm the swap and inspect the actual fill and balance changes after settlement.

The gateway checks the fixed market and token pair and enforces the transaction's output bound. A displayed order book does not imply that every exchange order type is implemented in Setsuna's gateway.

## Market data and execution

Quotes and execution must use the same connected environment. The workspace reports actual receipts and fills after confirmation. If a quote cannot be obtained or the execution simulation fails, review the error before submitting again.

Spot changes your asset exposure. Swapping MON for USDC does not automatically deposit that USDC into Earn; supplying it is a separate action.

## Current demo scope

Both swap directions are available in the [public demo](/app/) using synthetic funds on the hosted Monad fork. Select **Get test funds** after connecting. Earn, Spot and Perps share that environment, while vault shares, wallet assets and trading collateral remain separate balances. Transactions do not spend your mainnet funds.

For the selected market address and demo setup, see [networks and contracts](/docs/developers/contracts/).
