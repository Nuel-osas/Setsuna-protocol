import { erc20Abi, parseAbi, zeroAddress, type Address } from "viem";
import { clientFor } from "@/components/setsuna/WalletProvider";
import type { Deployment } from "./types";

export const spotABI = parseAbi([
  "function sellMON(uint256 minOut, uint256 deadline) payable returns(uint256)",
  "function buyMON(uint256 amount, uint256 minOut, uint256 deadline) returns(uint256)",
  "function market() view returns(address)",
  "function usdc() view returns(address)",
  "event Swapped(address indexed owner, bool monToUSDC, uint256 amountIn, uint256 amountOut)",
]);
export const kuruABI = parseAbi([
  "function getL2Book(uint32 bidPricePoints, uint32 askPricePoints) view returns(bytes)",
  "function getMarketParams() view returns(uint32,uint96,address,uint256,address,uint256,uint32,uint96,uint96,uint256,uint256)",
  "function placeAndExecuteMarketSell(uint96,uint256,bool,bool) payable returns(uint256)",
  "function placeAndExecuteMarketBuy(uint96,uint256,bool,bool) payable returns(uint256)",
]);

export async function readSpot(d: Deployment, owner?: Address) {
  if (!d.spot) throw new Error("Spot deployment unavailable");
  const s = d.spot,
    c = clientFor(d),
    block = await c.getBlock();
  if ((await c.getChainId()) !== d.chainId)
    throw new Error("Spot network changed");
  const [market, token, params, mon, usdc] = await Promise.all([
    c.readContract({
      address: s.gateway,
      abi: spotABI,
      functionName: "market",
      blockNumber: block.number,
    }),
    c.readContract({
      address: s.gateway,
      abi: spotABI,
      functionName: "usdc",
      blockNumber: block.number,
    }),
    c.readContract({
      address: s.market,
      abi: kuruABI,
      functionName: "getMarketParams",
      blockNumber: block.number,
    }),
    owner
      ? c.getBalance({ address: owner, blockNumber: block.number })
      : undefined,
    owner
      ? c.readContract({
          address: s.usdc,
          abi: erc20Abi,
          functionName: "balanceOf",
          args: [owner],
          blockNumber: block.number,
        })
      : undefined,
  ]);
  if (
    market.toLowerCase() !== s.market.toLowerCase() ||
    token.toLowerCase() !== s.usdc.toLowerCase() ||
    params[2] !== zeroAddress ||
    params[3] !== BigInt(18) ||
    params[4].toLowerCase() !== s.usdc.toLowerCase() ||
    params[5] !== BigInt(6)
  ) {
    throw new Error("Spot market configuration changed");
  }
  let historyUnavailable = false;
  const start = BigInt(s.startBlock),
    floor =
      block.number > BigInt(2000) ? block.number - BigInt(2000) : BigInt(0);
  const events = owner
    ? await c
        .getContractEvents({
          address: s.gateway,
          abi: spotABI,
          eventName: "Swapped",
          args: { owner },
          fromBlock: start > floor ? start : floor,
          toBlock: block.number,
        })
        .catch(() => {
          historyUnavailable = true;
          return [];
        })
    : [];
  return {
    block: block.number,
    timestamp: block.timestamp,
    mon,
    usdc,
    params,
    history: events.slice(-8).reverse(),
    historyUnavailable,
  };
}
export type SpotSnapshot = Awaited<ReturnType<typeof readSpot>>;

export async function quoteSpot(
  d: Deployment,
  monToUSDC: boolean,
  input: bigint,
) {
  if (!d.spot) throw new Error("Spot deployment unavailable");
  const c = clientFor(d),
    snapshot = await readSpot(d);
  const precision = monToUSDC ? snapshot.params[1] : BigInt(snapshot.params[0]);
  const scale = BigInt(10) ** BigInt(monToUSDC ? 18 : 6);
  const units = (input * precision) / scale;
  if (
    units <= BigInt(0) ||
    units >= BigInt(2) ** BigInt(96) ||
    (units * scale) / precision !== input
  ) {
    throw new Error("Use at most 10 decimal places for MON or 6 for USDC.");
  }
  // Kuru's zero-address eth_call path skips payment, returning book execution output.
  // It may quote partial depth. The funded gateway simulation and fill-or-kill execution
  // remain authoritative; a quote alone is never represented as a completed fill.
  const { result } = await c.simulateContract({
    address: d.spot.market,
    abi: kuruABI,
    functionName: monToUSDC
      ? "placeAndExecuteMarketSell"
      : "placeAndExecuteMarketBuy",
    args: [units, BigInt(0), false, true],
    account: zeroAddress,
    blockNumber: snapshot.block,
  });
  if (result <= BigInt(0))
    throw new Error("No executable liquidity for this amount.");
  return {
    input,
    output: result,
    minOut: (result * BigInt(995)) / BigInt(1000),
    monToUSDC,
    block: snapshot.block,
    deadline: snapshot.timestamp + BigInt(120),
  };
}
export type SpotQuote = Awaited<ReturnType<typeof quoteSpot>>;
