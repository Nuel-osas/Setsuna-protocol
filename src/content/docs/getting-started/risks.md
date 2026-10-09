Setsuna uses contracts to make allocation rules inspectable. Those rules reduce specific exposures; they cannot remove the risks of lending or guarantee a positive return.

## Contract and protocol risk

A bug in Setsuna, an adapter, a token or an underlying lending protocol can cause loss or prevent withdrawals. Fork tests exercise specific states and scenarios. They are not an independent security audit.

The current Setsuna deployment is a prototype. No independent audit or production approval is claimed.

## Collateral and liquidity risk

Setsuna supplies USDC or WMON, but its lending markets depend on borrowers' collateral, oracles and liquidations. Morpho's selected USDC market uses aHYPER collateral; Curvance's uses wsrUSD. Those assets introduce additional strategy and issuer dependencies.

Borrowers can consume a market's free cash. Protocols can pause operations. A vault's cash buffer and market-cash exposure limits help manage this, but do not guarantee immediate redemption.

Multiple protocol names also do not mean fully independent risks. Aave and Neverland share code lineage, and different venues can depend on related collateral or infrastructure.

## Who can do what

| Actor          | Permission                                                                   |
| -------------- | ---------------------------------------------------------------------------- |
| Share holder   | Redeem their shares, subject to accounting and liquidity checks              |
| Any account    | Record protocol rates and trigger the fixed rebalance rules                  |
| Vault guardian | Permanently pause new deposits or disable a destination for new allocation   |
| Executor       | Submit allowed actions; cannot select arbitrary weights, recipients or calls |

The current vaults do not have an adapter-replacement or upgrade function. Disabling a destination preserves its existing claim and withdrawal path. Underlying protocols retain their own governance and pause powers.

## Asset and trading risk

USDC may lose its peg. MON's market price can fall even while a MON position earns interest. Perpetuals add liquidation, funding and market risks. Margin protection limits additional reserve spending; it does not cap trading losses or guarantee rescue before liquidation.

## Read the environment label

Demo balances are synthetic. Local forks use copied protocol state and a separately advancing clock; they do not receive later mainnet transactions. The Perpl trading demo uses an explicitly disclosed historical-price fixture. See [networks and contracts](/docs/developers/contracts/).
