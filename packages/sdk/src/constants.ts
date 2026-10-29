import { defineChain, type Address, type Chain } from "viem";

/** Monad mainnet. Setsuna's reads default to rpc2, which serves archive reads and wide log ranges. */
export const monad: Chain = defineChain({
  id: 143,
  name: "Monad",
  nativeCurrency: { name: "Monad", symbol: "MON", decimals: 18 },
  rpcUrls: { default: { http: ["https://rpc2.monad.xyz"] } },
  blockExplorers: { default: { name: "Monadscan", url: "https://monadscan.com" } },
});

export const DEFAULT_RPC = "https://rpc2.monad.xyz";
export const APP_URL = "https://setsuna.finance";

export type VaultId = "setsUSDC" | "setsMON";
export type Venue = "Aave" | "Morpho" | "Euler" | "Neverland" | "Curvance";

export interface VaultConfig {
  id: VaultId;
  /** The ERC-4626 vault, which is also the share token. */
  address: Address;
  /** The token the vault holds: USDC, or WMON for setsMON. */
  asset: Address;
  assetSymbol: "USDC" | "MON";
  assetDecimals: number;
  shareDecimals: number;
  /** setsMON takes and returns native MON through this gateway. */
  gateway?: Address;
  /** Lending markets the vault may supply, in the contract's adapter order. */
  venues: { venue: Venue; market: string; adapter: Address }[];
  deployedBlock: bigint;
}

/** Deployed 11 October 2026. Contracts are immutable and verified on Sourcify (exact match). */
export const VAULTS: Record<VaultId, VaultConfig> = {
  setsUSDC: {
    id: "setsUSDC",
    address: "0x0a531817EEFB7b1FFD7c511c0817F58ac343CC67",
    asset: "0x754704Bc059F8C67012fEd69BC8A327a5aafb603",
    assetSymbol: "USDC",
    assetDecimals: 6,
    shareDecimals: 12,
    venues: [
      { venue: "Aave", market: "USDC reserve", adapter: "0xA6891baBC8af6e29D2b1C0B6C94863e25fD273EF" },
      { venue: "Morpho", market: "aHYPER / USDC", adapter: "0xda4aFc689252a8FcCf4d340C6e364F0e27A3e6f0" },
      { venue: "Euler", market: "eUSDC-12", adapter: "0xFA1E53e408D0316f88Ae2e456C6E80e97654339e" },
      { venue: "Neverland", market: "USDC reserve", adapter: "0x66616685f688245Ac6f93C2d3E0Cd803dAA6Bbbd" },
      { venue: "Curvance", market: "wsrUSD / USDC", adapter: "0x8c616B8Cf13dA2d83C0C04A9d7F3Ce34C3281FA0" },
    ],
    deployedBlock: 112600483n,
  },
  setsMON: {
    id: "setsMON",
    address: "0x408A8C85a3e15446885ADCc954575e7a918dFd33",
    asset: "0x3bd359C1119dA7Da1D913D1C4D2B7c461115433A",
    assetSymbol: "MON",
    assetDecimals: 18,
    shareDecimals: 24,
    gateway: "0x34fAFC57C6B086bC31a32693BDA0260c85Ff5BB3",
    venues: [
      { venue: "Neverland", market: "WMON", adapter: "0xAc58757CB9300d69DEAd5A4846d391B1C05d6F6F" },
      { venue: "Euler", market: "WMON / shMON", adapter: "0x9A09c5De249BE9370aeE5C1daFE45c5F60eDe1Bc" },
    ],
    deployedBlock: 112600487n,
  },
};

/**
 * setsAUSD, deployed 28 October 2026: AUSD in and out, held as setsUSDC. Each setsAUSD share is one
 * setsUSDC share, so setsUSDC's rate, fee and 2,000 USDC cap apply. Swaps go through one Curve stable
 * pool and revert below 99.8% of one-for-one. Shares carry EIP-2612 permit.
 */
export const AUSD_SAVINGS = {
  id: "setsAUSD",
  address: "0x551903E3687820A733FBe406DD33Fee8D12bd2F3",
  name: "Setsuna AUSD Savings",
  asset: "0x00000000eFE302BEAA2b3e6e1b18d08D69a9012a",
  assetSymbol: "AUSD",
  assetName: "Agora Dollar",
  assetDecimals: 6,
  shareDecimals: 12,
  underlying: "setsUSDC",
  pool: "0x942644106B073E30D72c2C5D7529D5C296ea91ab",
  poolIndex: { AUSD: 0, USDC: 1 },
  deployedBlock: 117431452n,
  /** SetsunaAUSDSaver: carries out a saver's signed save or withdrawal for whoever pays the gas. */
  saver: "0x4cbf5688cc98BCb76CcAB602AFc7b6fD57863cC3",
} as const;

/** Setsuna's relayer, which pays the gas for setsAUSD saves and withdrawals made through AUSD_SAVINGS.saver. */
export const RELAYER_URL = "https://setsuna-relayer-production.up.railway.app";

/** The app's own protection: accept at most 0.1% less than quoted, within 10 minutes. */
export const DEFAULT_SLIPPAGE_BPS = 10;
export const DEFAULT_DEADLINE_SECONDS = 600;
