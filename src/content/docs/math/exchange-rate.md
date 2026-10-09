The intuitive share price is total underlying assets divided by outstanding shares. The implementation adds small virtual amounts and explicit rounding to make empty-vault and small-balance accounting more robust.

## Vault assets

```text
A = idle underlying + sum(adapter position values)
S = total share supply
```

All values must use the same underlying asset. USDC and WMON are never mixed in one vault's accounting.

## Exact share conversion

Setsuna uses OpenZeppelin ERC-4626 with a **six-decimal share offset**. In raw base units, the conversion is:

```text
shares for assets = floor(assets × (S + 1,000,000) / (A + 1))
assets for shares = floor(shares × (A + 1) / (S + 1,000,000))
```

The `+1` is one underlying base unit, and `+1,000,000` is the virtual share amount. Those constants do not mean one whole USDC or one million human-readable shares.

Deposits round share output down; redemptions round asset output down. Minting a requested number of shares rounds required assets up, and withdrawing a requested asset amount rounds required shares up.

## A human-readable example

Ignoring base-unit rounding, a vault with 10,000 USDC backing 10,000 setsUSDC has a price of 1 USDC per share. A 1,000-USDC deposit receives approximately 1,000 shares.

If the vault's backing later grows by 5% with unchanged share supply, those shares represent approximately 1,050 USDC. If backing falls by 5%, they represent approximately 950 USDC.

## Precision and settlement

setsUSDC has 12 decimals over USDC's 6; setsMON has 24 over WMON's 18. Use asset and share units explicitly in integrations.

All user operations refresh adapter accounting before settlement. Preview values can change before the transaction executes, so the app binds minimum outputs and a deadline. Available liquidity still limits what can be redeemed.
