export const faqs = [
  [
    "What is setsUSDC?",
    "A share of the Setsuna USDC pool. You deposit USDC and receive setsUSDC. Interest increases the share’s value; recognized losses can reduce it. setsMON follows the same pattern in a separate MON pool. Your number of shares stays the same unless you deposit, withdraw or transfer.",
  ],
  [
    "Where does my USDC go?",
    "Each vault has two fixed destinations: Aave and Morpho for setsUSDC, Neverland and Euler for setsMON. The cash target is 10%, each venue is capped at 60%, and the market-size floor is 250,000 units of that vault’s underlying asset. The chosen USDC Morpho market is below the floor in the recorded proof, so its target is zero. The setsMON app demo uses synthetic funds on a mainnet fork; public deposits are closed.",
  ],
  [
    "Can I withdraw at any time?",
    "Redemption requires healthy valuation of both destinations and enough available cash: first from the buffer, then from lending markets. If there isn't enough available for your full amount, the withdrawal is refused rather than paying you less, and you can choose a smaller amount. Shares are never burned without paying you.",
  ],
  [
    "What does it cost?",
    "No Setsuna fee in this version. Each lending market takes its own cut, already reflected in the supply rates shown.",
  ],
  [
    "Is the rate guaranteed?",
    "No. Rates come from the lending markets and change constantly, and the rate shown leaves out reward incentives. Holding cash and capping each market also costs some yield compared with putting everything in the single best market; that is the price of spreading risk. A lending market can also lose money, and that loss would reduce what each share is worth. The vault is in development and has not been audited.",
  ],
  [
    "Who moves the money?",
    "Anyone can trigger a rebalance, but the vault only accepts moves toward its published targets, between approved destinations, in bounded steps. Nobody, including Setsuna, can send pool funds to an arbitrary address.",
  ],
  [
    "How does trading protection work?",
    "For BTC perpetuals on Perpl, you can set a budget. If your position's margin falls below the level you choose, Setsuna adds margin from a separate reserve. It never trades, never exceeds your budget, and cannot guarantee a position survives a fast move.",
  ],
  [
    "Is Earn connected to my trading balance?",
    "No. Earn, your trading collateral and your protection reserve are separate. Earn never touches the reserve, and protection never redeems your Earn shares.",
  ],
] as const;
