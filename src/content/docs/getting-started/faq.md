## Is Setsuna live on Monad mainnet?

The public app is an executable demo on a Railway-hosted fork of Monad mainnet, with synthetic funds and continuously running workers. It is not a Monad mainnet launch. Use **Get test funds** after connecting your wallet. The source snapshot is block 111560409; Perps uses a fixed historical BTC price of $82,964.20.

## What are setsMON and setsUSDC?

They are transferable vault shares. setsMON represents a claim on the MON vault; setsUSDC represents a claim on the USDC vault. Neither is a fixed-price promise. Read [vaults and share tokens](/docs/how-it-works/vaults/).

## Does the vault always choose the highest APR?

No. It weights eligible destinations using conservative observed rates, then applies exposure, liquidity and movement limits. Some funds remain in cash. A paused market or inconsistent rate can exclude a destination even when its advertised yield is high.

## Can I withdraw immediately?

There is no scheduled lockup. The amount available now depends on the cash buffer and withdrawable lending positions. Full redemption can be limited by protocol liquidity or failed accounting reads.

## Is this an AI asset manager?

The current allocator is deterministic Solidity code. It reads protocol rates and applies fixed rules. It does not use an AI model or a historical yield learner.

## Who pays the keeper?

The account submitting an Earn transaction pays its gas. The current Earn vault does not pay an executor reward. An operator can run the keeper as infrastructure, and other accounts may trigger the same public functions.

## Are all five protocols Monad-native?

All five selected USDC destinations operate on Monad. Aave, Morpho and Euler are multichain protocols. Neverland and Curvance are included as Monad-focused lending integrations. Deployment on Monad and origin on Monad are different facts.

## Can my Perps trade spend my Earn deposit?

No. Earn vault balances, Spot order funds, Perpl trading collateral and the optional protection reserve are separate. Perps uses AUSD; it does not use setsMON or setsUSDC as trading collateral.

## Why are there only two protocols for setsMON?

MON and USDC need different eligible lending markets. The implemented MON vault uses Neverland and Euler WMON markets. Adding more names without a suitable market would not create more usable destinations.

## Does Setsuna claim extra reward tokens?

No. The current Earn implementation recognizes lending interest. External reward harvesting and incentive-token swaps are not implemented.
