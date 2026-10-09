/** Site map: one source for the header and footer. */
export const productLinks = [
  { href: "/earn/", label: "Earn" },
  { href: "/trade/", label: "Trade" },
  { href: "/docs/", label: "Docs" },
  { href: "/security/", label: "Security" },
  { href: "/evidence/", label: "Evidence" },
  { href: "/faq/", label: "FAQ" },
] as const;

/** Fork round trips: deposit 1,000 USDC, advance 7 days, withdraw everything. */
export const forkProofs = [
  {
    name: "Aave V3 · USDC reserve",
    by: "Codex",
    block: "109,894,238",
    result: "Round trip passed",
    apr: "4.08%",
  },
  {
    name: "Morpho Blue · WBTC/USDC",
    by: "Codex",
    block: "109,894,238",
    result: "Round trip passed",
    apr: "1.22%",
  },
  {
    name: "Euler · eUSDC-12",
    by: "Claude",
    block: "109,905,890",
    result: "1,000 → 1,001.204 USDC",
    apr: "6.28%",
  },
  {
    name: "Neverland · USDC reserve",
    by: "Claude",
    block: "109,905,890",
    result: "1,000 → 1,000.346 USDC",
    apr: "1.80%",
  },
  {
    name: "Morpho Blue · aHYPER/USDC",
    by: "Claude",
    block: "109,905,890",
    result: "1,000 → 1,001.486 USDC",
    apr: "7.75%",
  },
] as const;
