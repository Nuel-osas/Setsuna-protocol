setsAUSD lets you save **AUSD** and earn the setsUSDC rate. You deposit AUSD and you withdraw AUSD; in between, your money works in setsUSDC exactly like a USDC deposit.

## How it works

| Step | What happens |
| --- | --- |
| Deposit | Your AUSD is swapped to USDC on Curve's AUSD/USDC/USDT0 stable pool and supplied to setsUSDC. You receive setsAUSD. |
| While saved | Each setsAUSD share is exactly one setsUSDC share held by the wrapper, so it earns the same lending rate, under the same rules, cap and 2% fee on yield. |
| Withdraw | The wrapper redeems the setsUSDC, swaps the USDC back to AUSD on the same pool, and sends the AUSD to you. |

The wrapper has no owner, no admin, no fee of its own and cannot be upgraded. setsAUSD has 12 decimals, like setsUSDC.

## What it costs

The Curve pool charges about **0.005%** each way. A full round trip measured on mainnet came to about 0.01%: half a cent on every $100 for both directions together. Your balance in the app counts setsUSDC's USDC one-for-one as AUSD; the AUSD you actually receive is that minus the swap.

## Protection against a depeg

Every swap must return at least **99.8%** of one-for-one, or the transaction reverts. If AUSD and USDC drift more than 0.2% apart in the pool, deposits and withdrawals stop instead of filling at a bad rate. Your savings stay in setsUSDC meanwhile, and you can always convert setsAUSD into plain setsUSDC (see below).

## Saving without MON for gas

AUSD supports signed transfers (EIP-3009) and setsAUSD supports signed approvals (EIP-2612). So a wallet can save and withdraw by **signing only**, while someone else submits the transaction and pays the gas.

Setsuna runs a relayer that does this for apps built on the [Setsuna SDK](/docs/developers/ausd-savings/). The saver contract it calls can only deposit AUSD in the signer's own name, or redeem the signer's own setsAUSD back to the signer. Whoever submits the transaction, the money only ever reaches the signer.

On setsuna.finance itself you pay your own gas in MON, as with any other deposit.

## Deposit and withdraw in the app

1. Open [Earn](/earn/?pay=ausd) and choose **AUSD** in the asset picker.
2. Enter an amount and select **Deposit AUSD**. Approve that exact AUSD amount the first time, then confirm the deposit.
3. To leave, switch to **Withdraw**, enter the setsAUSD amount or select **Max**, and confirm. The AUSD arrives in your wallet.

Your setsAUSD position also appears in [Portfolio](/portfolio/).

## Converting to setsUSDC

`unwrap(shares, receiver, owner)` hands back plain setsUSDC shares one-for-one with no swap, and `wrap(shares, receiver)` does the reverse. Use it to leave as USDC instead of AUSD, or to exit while the pool is off peg.

## Limits

- **Cap.** setsAUSD deposits count toward setsUSDC's 2,000 USDC cap, shared with every USDC depositor. When the vault is full, AUSD deposits are refused too.
- **Withdrawable now.** setsUSDC keeps part of its assets in cash. A very large withdrawal can exceed what the lending markets can pay out at that moment.
- **Exact-output calls.** ERC-4626 `mint` and `withdraw` are not offered, because the swap makes exact output amounts unknowable in advance. Use `deposit` and `redeem`.

## Risks

setsAUSD carries every risk of setsUSDC (see [risks and safety](/docs/getting-started/risks/)), plus AUSD's own peg and the Curve pool's liquidity. The contracts are unaudited and the vaults are a capped beta. Deposit only what you can afford to lose.
