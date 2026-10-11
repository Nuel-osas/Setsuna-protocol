import { getAddress, isAddress, type Address } from "viem";
import { venues } from "./demo-config";
import type { Deployment } from "./types";

/**
 * Capped setsUSDC and setsMON on Monad mainnet, written by
 * contracts/script/MainnetEarn.s.sol. Assets must match the pinned USDC and
 * WMON; anything else is refused.
 */
export function mainnetEarn(raw = process.env.SETSUNA_MAINNET_EARN) {
  if (!raw) return undefined;
  const m = JSON.parse(raw) as Record<string, unknown>;
  const address = (v: unknown): Address => {
    if (typeof v !== "string" || !isAddress(v) || /^0x0{40}$/i.test(v))
      throw new Error("Invalid mainnet Earn address");
    return getAddress(v);
  };
  const list = (v: unknown, n: number) => {
    if (!Array.isArray(v) || v.length !== n)
      throw new Error("Invalid mainnet Earn destinations");
    return v.map(address);
  };
  if (
    m.chainId !== 143 ||
    address(m.asset) !== getAddress(venues.usdc) ||
    address(m.monAsset) !== getAddress(venues.wmon)
  )
    throw new Error("Mainnet Earn deployment does not match the assets");
  const startBlock = String(Number(m.deployedAtBlock));
  return {
    mode: "mainnet",
    chainId: 143,
    name: "Monad",
    // Monad's rpc2 endpoint serves archive reads and 10,000-block log ranges;
    // rpc.monad.xyz limits logs to 100 blocks, too few for vault history.
    rpc: "https://rpc2.monad.xyz",
    collateral: venues.collateral,
    exchange: venues.exchange,
    perpId: 1,
    startBlock,
    explorer: "https://monadscan.com",
    earnUSDC: {
      vault: address(m.vault),
      asset: venues.usdc,
      adapters: list(m.adapters, 5) as [
        Address,
        Address,
        Address,
        Address,
        Address,
      ],
      forkBlock: startBlock,
      startBlock,
    },
    earnMON: {
      vault: address(m.monVault),
      gateway: address(m.monGateway),
      asset: venues.wmon,
      adapters: list(m.monAdapters, 2) as [Address, Address],
      forkBlock: startBlock,
      startBlock,
    },
  } satisfies Deployment;
}
