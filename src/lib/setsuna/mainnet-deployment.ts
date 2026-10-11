import { mainnetEarn } from "./mainnet-earn.ts";
import { mainnetTrading } from "./mainnet-trading.ts";
import type { Deployment } from "./types";
import { venues } from "./venues.ts";

/** Missing or invalid configuration exposes read-only markets, never a fork. */
export function mainnetDeployment(
  earnRaw = process.env.SETSUNA_MAINNET_EARN,
  tradingRaw = process.env.SETSUNA_MAINNET_TRADING,
): Deployment {
  let earn: Deployment | undefined;
  let trading: Deployment | undefined;
  // Invalid configuration for one product must not hide the other.
  try {
    earn = mainnetEarn(earnRaw);
  } catch {}
  try {
    trading = mainnetTrading(tradingRaw);
  } catch {}
  return {
    mode: earn || trading ? "mainnet" : "preview",
    chainId: 143,
    name: "Monad",
    rpc: "https://rpc2.monad.xyz",
    collateral: venues.collateral,
    exchange: venues.exchange,
    perpId: 1,
    explorer: "https://monadscan.com",
    ...(trading ? { ...trading, trading } : {}),
    ...(earn
      ? {
          earnMON: earn.earnMON,
          earnUSDC: earn.earnUSDC,
          earnMainnet: earn,
          rpc: earn.rpc,
        }
      : {}),
  };
}
