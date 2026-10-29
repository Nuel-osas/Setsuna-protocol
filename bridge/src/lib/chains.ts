import * as BK from "@circle-fin/bridge-kit/chains";

// Every CCTP V2 chain. Bridgeable ones come straight from Circle's Bridge Kit definitions;
// the rest are CCTP V2 domains Bridge Kit has no browser adapter for yet.

export type Network = "mainnet" | "testnet";
export type Ecosystem = "evm" | "solana" | "sui" | "aptos" | "starknet" | "stellar";

export type Chain = {
  id: string; // Bridge Kit chain identifier, e.g. "Base_Sepolia"
  family: string; // network-independent key, e.g. "base"
  name: string;
  short: string;
  network: Network;
  ecosystem: Ecosystem;
  domain: number;
  icon?: string;
  fast: boolean; // Circle offers Fast Transfer from this chain (others are already quick)
  bridgeable: boolean;
  chainId?: number;
  usdc?: string;
  explorer?: string;
  rpc?: string;
  hue: number;
};

// Circle lists Fast as "N/A" for these sources: standard attestation is already fast.
const NO_FAST = new Set(["arc", "avalanche", "cronos", "hyperevm", "injective", "monad", "pharos", "plasma", "polygon", "sei", "sonic", "xdc", "sui", "aptos", "stellar"]);

const ICON: Record<string, string> = {
  arbitrum: "arbitrum", arc: "arc", avalanche: "avalanche", base: "base", codex: "codex", cronos: "cronos",
  ethereum: "ethereum", hyperevm: "hyperevm", injective: "injective", ink: "ink", linea: "linea", monad: "monad",
  optimism: "optimism", plasma: "plasma", plume: "plume", polygon: "polygon", sei: "sei", solana: "solana",
  sonic: "sonic", unichain: "unichain", world_chain: "world_chain", xdc: "xdc", x_layer: "x_layer",
  sui: "sui", aptos: "aptos", starknet: "starknet", stellar: "stellar",
};

const SHORT: Record<string, string> = {
  ethereum: "ETH", optimism: "OP", arbitrum: "ARB", polygon: "POL", avalanche: "AVAX", world_chain: "WLD",
  x_layer: "XLYR", hyperevm: "HYPE", injective: "INJ", solana: "SOL", unichain: "UNI",
};

const NAME_FIX: Record<string, string> = { optimism: "OP Mainnet", polygon: "Polygon PoS", world_chain: "World Chain", x_layer: "X Layer" };

const familyOf = (id: string) =>
  id.replace(/_(Sepolia|Testnet|Fuji|Amoy_Testnet|Devnet|Apothem)$/, "").toLowerCase();

const hueOf = (s: string) => [...s].reduce((h, ch) => (h * 31 + ch.charCodeAt(0)) % 360, 7);

export type BKChain = {
  type: string; chain: string; name: string; isTestnet: boolean; chainId?: number;
  usdcAddress?: string | null; explorerUrl?: string; rpcEndpoints?: string[]; nativeCurrency?: { name: string; symbol: string; decimals: number };
  cctp?: { domain: number; contracts?: { v2?: { tokenMessenger?: string; messageTransmitter?: string } } };
};

export const BK_ALL = Object.values(BK as Record<string, unknown>).filter((v): v is BKChain => !!v && typeof v === "object" && "chain" in v);
export const bkDef = (id: string) => BK_ALL.find((c) => c.chain === id);

const bkChains = Object.values(BK as Record<string, unknown>)
  .filter((v): v is BKChain => !!v && typeof v === "object" && "chain" in v && "cctp" in v)
  .filter((c) => c.cctp?.contracts?.v2 && c.usdcAddress);

// Testnets take their mainnet's display name ("Apothem Network" → "XDC").
const mainnetName = new Map(bkChains.filter((c) => !c.isTestnet).map((c) => [familyOf(c.chain), c.name]));

const bridgeable: Chain[] = bkChains
  .map((c) => {
    const family = familyOf(c.chain);
    return {
      id: c.chain,
      family,
      name: NAME_FIX[family] ?? (mainnetName.get(family) ?? c.name).replace(/ (Mainnet|Sepolia|Testnet|Devnet|Fuji|Amoy|Apothem|Atlantic)$/i, ""),
      short: SHORT[family] ?? c.name.slice(0, 4).toUpperCase(),
      network: c.isTestnet ? "testnet" : "mainnet",
      ecosystem: c.type === "solana" ? "solana" : "evm",
      domain: c.cctp!.domain,
      icon: ICON[family] ? `/icons/${ICON[family]}.svg` : undefined,
      fast: !NO_FAST.has(family),
      bridgeable: true,
      chainId: c.chainId,
      usdc: c.usdcAddress ?? undefined,
      explorer: c.explorerUrl,
      rpc: c.rpcEndpoints?.[0],
      hue: hueOf(family),
    } satisfies Chain;
  });

// CCTP V2 domains without a Bridge Kit browser adapter. CUSTOM ones are bridged by our own
// Move transaction builders; the rest are listed as coming soon.
const CUSTOM = new Set(["sui", "aptos"]);
const pending = (["mainnet", "testnet"] as const).flatMap((network) =>
  ([
    ["sui", "Sui", "SUI", "sui", 8],
    ["aptos", "Aptos", "APT", "aptos", 9],
    ["starknet", "Starknet", "STRK", "starknet", 25],
    ["stellar", "Stellar", "XLM", "stellar", 27],
  ] as const).map(([family, name, short, ecosystem, domain]) => ({
    id: `${name}${network === "testnet" ? "_Testnet" : ""}`, family, name, short, network, ecosystem, domain,
    icon: `/icons/${family}.svg`, fast: !NO_FAST.has(family), bridgeable: CUSTOM.has(family), hue: hueOf(family),
    explorer: family === "sui" ? `https://suiscan.xyz/${network}/tx/{hash}` : family === "aptos" ? `https://explorer.aptoslabs.com/txn/{hash}?network=${network}` : undefined,
  }) satisfies Chain),
);

export const ALL_CHAINS: Chain[] = [...bridgeable, ...pending];

const ORDER = ["ethereum", "base", "arbitrum", "solana", "optimism", "sui", "monad", "polygon", "avalanche", "unichain", "linea", "hyperevm", "world_chain", "sonic", "aptos"];
const rank = (c: Chain) => { const i = ORDER.indexOf(c.family); return i === -1 ? 100 : i; };

export const chainsFor = (network: Network) =>
  ALL_CHAINS.filter((c) => c.network === network).sort((a, b) => rank(a) - rank(b) || a.name.localeCompare(b.name));

export const findChain = (network: Network, family: string) =>
  ALL_CHAINS.find((c) => c.network === network && c.family === family)!;

export const ECOSYSTEM_LABEL: Record<Ecosystem, string> = {
  evm: "EVM", solana: "Solana", sui: "Sui · Move", aptos: "Aptos · Move", starknet: "Starknet", stellar: "Stellar",
};

export const txUrl = (c: Chain, hash: string) => c.explorer?.replace("{hash}", hash);
