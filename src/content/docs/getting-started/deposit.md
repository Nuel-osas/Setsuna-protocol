A deposit exchanges one underlying asset for a proportional claim on its vault. You do not need to select lending markets or place individual lending transactions.

## Before you start

Open the [Setsuna app](/earn/) and check that it shows **Monad mainnet · Capped beta**. Connect a wallet on Monad mainnet, chain **143**, holding the MON or USDC you want to deposit and a little MON for gas. Deposits use real funds.

Earn is a capped beta: setsUSDC accepts at most 2,000 USDC in total and setsMON 25,000 MON. Setsuna's contracts are unaudited; deposit only what you can afford to lose.

In the Earn card, select **Deposit**, then choose **USDC** or **MON** from the asset dropdown beside the amount. The same form handles both assets; the receipt token, balance, rate and allocation details update with your selection. MON and USDC remain independent vaults.

## Deposit USDC

1. Connect your wallet on Monad mainnet.
2. Choose USDC and enter the amount you want to supply, or select **Max**. Check the estimated setsUSDC shares in **You receive**.
3. Select **Deposit USDC** and approve that exact USDC amount for the vault.
4. Confirm the deposit transaction. An approval alone does not deposit your assets.
5. Wait for confirmation. Your position shows your setsUSDC shares and their current USDC value.

The app binds the deposit to a minimum share amount and a ten-minute deadline. The current UI allows a 0.1% difference from its share quote. If the limit is exceeded, the transaction reverts.

## Deposit MON

The MON gateway wraps your native MON into WMON, deposits it into the setsMON vault and sends the shares to you. The app's native-MON deposit does not require a separate WMON approval.

**Max** leaves 0.1 MON in your wallet for gas and respects the remaining deposit capacity. Changing assets clears the amount and quote. The asset selector and action switch are locked while a transaction is awaiting confirmation.

setsMON earns in MON terms. It does not protect the dollar price of MON.

## Deposit AUSD

Choose **AUSD** in the asset dropdown. Your AUSD is swapped to USDC on Curve's stable pool and saved in setsUSDC; you receive setsAUSD, and withdrawing returns AUSD. The swap costs about 0.005% each way, and a swap below 99.8% of one-for-one reverts. Approve the exact AUSD amount, then confirm the deposit. Details: [AUSD savings](/docs/how-it-works/ausd-savings/).

## What happens afterward

New deposits initially add cash to the vault. The public rebalancer moves that cash toward the target allocations over time, subject to observation spacing, cooldowns and movement limits. Depositing does not instantly distribute all your funds across every protocol.

You can follow the aggregate positions in **Where your USDC works**. Individual depositors own shares of the pooled vault, rather than separate positions in each lending market.

## If confirmation is taking time

Keep the submitted transaction hash and use **Check transaction**. Confirm whether it succeeded before submitting again. A wallet rejection, failed approval or reverted deposit does not mint a position.

Next: [withdrawing your shares](/docs/getting-started/withdraw/).
