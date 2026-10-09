export const docs = [
  {
    slug: "",
    title: "Introduction",
    group: "Getting started",
    description:
      "One deposit. Transparent rules. Your assets, put to work on Monad.",
  },
  {
    slug: "getting-started/deposit",
    title: "Depositing",
    group: "Getting started",
    description: "From MON or USDC to your first vault shares.",
  },
  {
    slug: "getting-started/withdraw",
    title: "Withdrawing",
    group: "Getting started",
    description: "Turn your shares back into the asset you deposited.",
  },
  {
    slug: "getting-started/yield",
    title: "Fees and yield",
    group: "Getting started",
    description:
      "Understand the rate you see and the interest you actually earn.",
  },
  {
    slug: "getting-started/risks",
    title: "Risks and safety",
    group: "Getting started",
    description:
      "What the vault limits, what it cannot prevent, and who has control.",
  },
  {
    slug: "getting-started/faq",
    title: "FAQ",
    group: "Getting started",
    description: "A few things worth knowing before you start.",
  },
  {
    slug: "how-it-works/overview",
    title: "Overview",
    group: "How it works",
    description: "Follow a deposit through the Setsuna lending vault.",
  },
  {
    slug: "how-it-works/vaults",
    title: "Vaults and share tokens",
    group: "How it works",
    description:
      "Meet setsMON and setsUSDC: receipts for your share of a vault.",
  },
  {
    slug: "how-it-works/where-funds-go",
    title: "Where your funds go",
    group: "How it works",
    description:
      "Five USDC lending destinations. Two MON destinations. Separate balances.",
  },
  {
    slug: "how-it-works/earning",
    title: "Earning yield",
    group: "How it works",
    description: "How lending interest becomes part of your share value.",
  },
  {
    slug: "how-it-works/rebalancing",
    title: "Rebalancing",
    group: "How it works",
    description: "How the vault chooses allocations and moves toward them.",
  },
  {
    slug: "how-it-works/liquidity",
    title: "Staying liquid",
    group: "How it works",
    description:
      "The cash buffer, market liquidity and what available to withdraw means.",
  },
  {
    slug: "math/exchange-rate",
    title: "Shares and exchange rate",
    group: "The math",
    description: "The accounting behind a deposit, a share and a redemption.",
  },
  {
    slug: "math/apr",
    title: "How rates are measured",
    group: "The math",
    description:
      "Protocol quotes, conservative observations and the blended vault rate.",
  },
  {
    slug: "math/allocation",
    title: "Allocation and limits",
    group: "The math",
    description: "Rate weights, cash caps and the rebalance movement budget.",
  },
  {
    slug: "math/withdrawals",
    title: "Withdrawal calculations",
    group: "The math",
    description:
      "A claim on assets is different from cash available right now.",
  },
  {
    slug: "trading/spot",
    title: "Spot trading",
    group: "Trading",
    description:
      "Swap MON and USDC through Kuru, with your Earn balance kept separate.",
  },
  {
    slug: "trading/perps",
    title: "Perpetuals and protection",
    group: "Trading",
    description:
      "Trade through Perpl with AUSD and an optional capped protection reserve.",
  },
  {
    slug: "developers/architecture",
    title: "Contract architecture",
    group: "Developers",
    description: "The vault, adapters, gateway and public executor.",
  },
  {
    slug: "developers/contracts",
    title: "Networks and contracts",
    group: "Developers",
    description:
      "Verified venue addresses and the boundaries of the current demos.",
  },
  {
    slug: "developers/keepers",
    title: "Running a keeper",
    group: "Developers",
    description:
      "Observe rates and execute fixed rules with bounded permissions.",
  },
  {
    slug: "developers/local-demo",
    title: "Run the local demo",
    group: "Developers",
    description:
      "Reproduce the five-protocol Earn journey on a Monad mainnet fork.",
  },
] as const;

export type Doc = (typeof docs)[number];
export type DocHeading = { id: string; text: string; depth: number };
export type SearchEntry = {
  slug: string;
  title: string;
  group: string;
  description: string;
  text: string;
};
export const docHref = (slug: string) => `/docs/${slug ? `${slug}/` : ""}`;
