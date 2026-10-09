A deposit exchanges one underlying asset for a proportional claim on its vault. You do not need to select lending markets or place individual lending transactions.

## Before you start

Open the [Setsuna app](/app/) and check that it shows **Setsuna demo · test funds**, chain **31337**. Connect a browser wallet and select **Get test funds** for 101 MON, 1,000 USDC and 1,000 AUSD. These are demonstration assets with no monetary value; use them for deposits and gas.

If your wallet already has another network with chain ID 31337, check that its RPC is `https://setsuna-metropolis.vercel.app/api/rpc/`. A local Anvil network with the same chain ID is a different environment. A funding claim is limited to once per wallet per demo day, subject to the faucet’s remaining budget.

In the Earn card, select **Deposit**, then choose **USDC** or **MON** from the asset dropdown beside the amount. The same form handles both assets; the receipt token, balance, rate and allocation details update with your selection. MON and USDC remain independent vaults.

## Deposit USDC

1. Connect your wallet, or choose **Try the local demo account** in a local demo.
2. Choose USDC and enter the amount you want to supply, or select **Max**. Check the estimated setsUSDC shares in **You receive**.
3. Select **Deposit USDC** and approve that exact USDC amount for the vault.
4. Confirm the deposit transaction. An approval alone does not deposit your assets.
5. Wait for confirmation. Your position shows your setsUSDC shares and their current USDC value.

The app binds the deposit to a minimum share amount and a ten-minute deadline. The current UI allows a 0.1% difference from its share quote. If the limit is exceeded, the transaction reverts.

## Deposit MON

The MON gateway wraps your native MON into WMON, deposits it into the setsMON vault and sends the shares to you. The app's native-MON deposit does not require a separate WMON approval.

**Max** leaves 0.1 MON in your wallet for gas and respects the remaining deposit capacity. Changing assets clears the amount and quote. The asset selector and action switch are locked while a transaction is awaiting confirmation.

setsMON earns in MON terms. It does not protect the dollar price of MON.

## What happens afterward

New deposits initially add cash to the vault. The public rebalancer moves that cash toward the target allocations over time, subject to observation spacing, cooldowns and movement limits. Depositing does not instantly distribute all your funds across every protocol.

You can follow the aggregate positions in **Where your USDC works**. Individual depositors own shares of the pooled vault, rather than separate positions in each lending market.

## If confirmation is taking time

Keep the submitted transaction hash and use **Check transaction**. Confirm whether it succeeded before submitting again. A wallet rejection, failed approval or reverted deposit does not mint a position.

Next: [withdrawing your shares](/docs/getting-started/withdraw/).
