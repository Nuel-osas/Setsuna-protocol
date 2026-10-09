Setsuna brings **automated Earn, Spot and Perps to Monad**. Earn is the starting point: deposit MON or USDC, receive vault shares, and let transparent onchain rules handle lending allocation and rebalancing.

You can see where the assets are supplied, how the vault makes decisions, and how much is available to withdraw. Your Earn assets stay separate from your trading balances.

## Setsuna in a minute

1. **Choose an asset.** MON and USDC have separate vaults.
2. **Deposit once.** Receive `setsMON` or `setsUSDC`, representing your share of the selected vault.
3. **Hold your shares.** Lending interest can increase their value; losses can decrease it.
4. **Redeem when liquidity is available.** Receive the underlying asset back into your wallet.

The current setsUSDC vault connects to **Aave, Morpho, Euler, Neverland and Curvance**. setsMON lends WMON through **Neverland and Euler**.

## Built around visible rules

- **One position to follow.** The share token represents your claim across the vault's lending positions and cash.
- **Allocation you can inspect.** Rates, market eligibility, exposure limits and cash targets determine the allocation.
- **Public execution.** A keeper or any other account can trigger the same contract rules. Callers cannot choose their own recipients or weights.
- **A clear exit path.** Withdrawals draw from cash first, then the lending markets' available liquidity.

## Earn, Spot and Perps

| Product | What it does                                         | Assets                         |
| ------- | ---------------------------------------------------- | ------------------------------ |
| Earn    | Allocates across lending markets                     | MON → setsMON; USDC → setsUSDC |
| Spot    | Executes MON/USDC swaps through Kuru                 | MON and USDC                   |
| Perps   | Trades through Perpl with optional margin protection | AUSD                           |

A single interface does not mean a shared balance. A trade cannot spend assets held in your Earn vault.

## Current release

> **Public test-fund demo.** [Open the app](/app/), connect a browser wallet and select **Get test funds**. Earn, Spot and Perps use one persistent Monad mainnet fork, chain 31337. The tokens have no monetary value. Perps uses a disclosed historical price. See [networks and contracts](/docs/developers/contracts/) for the environment and explorer.

These docs describe the implementation available on October 9, 2026. Start with the user guides, follow the mechanism in **How it works**, or explore the calculations in **The math**.
