import { getAddress, isAddress, type Address } from "viem";
import { venues } from "./demo-config";
import type { Deployment } from "./types";

/**
 * Spot and Perps on Monad mainnet: the gateway and factory written by
 * contracts/script/MainnetTrading.s.sol. Venue addresses must match the
 * pinned Kuru and Perpl contracts; anything else is refused.
 */
export function mainnetTrading(raw = process.env.SETSUNA_MAINNET_TRADING) {
  if (!raw) return undefined;
  const m = JSON.parse(raw) as Record<string, unknown>;
  const address = (v: unknown): Address => {
    if (typeof v !== "string" || !isAddress(v) || /^0x0{40}$/i.test(v))
      throw new Error("Invalid mainnet trading address");
    return getAddress(v);
  };
  const same = (a: unknown, b: string) => address(a) === getAddress(b);
  if (
    m.chainId !== 143 ||
    !same(m.spotMarket, venues.market) ||
    !same(m.usdc, venues.usdc) ||
    !same(m.exchange, venues.exchange) ||
    !same(m.collateral, venues.collateral)
  )
    throw new Error("Mainnet trading deployment does not match the venues");
  const startBlock = String(Number(m.deployedAtBlock));
  return {
    mode: "mainnet",
    chainId: 143,
    name: "Monad",
    // Local verification can point at a loopback chain-143 fork; nothing else.
    rpc: /^http:\/\/127\.0\.0\.1:\d+\/?$/.test(
      process.env.SETSUNA_MAINNET_TRADING_RPC ?? "",
    )
      ? process.env.SETSUNA_MAINNET_TRADING_RPC!
      : "https://rpc.monad.xyz",
    collateral: venues.collateral,
    exchange: venues.exchange,
    perpId: 1,
    factory: address(m.perplFactory),
    startBlock,
    explorer: "https://monadscan.com",
    spot: {
      gateway: address(m.spotGateway),
      ...(m.spotOrdersFactory
        ? { ordersFactory: address(m.spotOrdersFactory) }
        : {}),
      market: venues.market,
      usdc: venues.usdc,
      startBlock,
    },
  } satisfies Deployment;
}
