/** Setsuna Bridge: Circle CCTP USDC transfers, its own app (bridge/ in the repo). */
export const BRIDGE_URL = "https://bridge.setsuna.finance/";

/** Site map: one source for the header and footer. */
export const productLinks = [
  { href: "/earn/", label: "Earn" },
  { href: "/trade/", label: "Trade" },
  { href: BRIDGE_URL, label: "Bridge" },
  { href: "/portfolio/", label: "Portfolio" },
  { href: "/docs/", label: "Docs" },
  { href: "/faq/", label: "FAQ" },
] as const;
