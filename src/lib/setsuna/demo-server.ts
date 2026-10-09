import { createPublicClient, http, parseAbi } from "viem";
import { demoConfig, venues } from "./demo-config";
import { validateUSDCEarn } from "./usdc-deployment";
export function demoRPC() {
  const rpc = process.env.SETSUNA_DEMO_RPC_URL;
  if (!rpc) throw new Error("No demo RPC configured");
  const url = new URL(rpc);
  if (
    url.protocol !== "https:" &&
    !(
      process.env.NODE_ENV !== "production" &&
      url.protocol === "http:" &&
      ["127.0.0.1", "localhost"].includes(url.hostname)
    )
  )
    throw new Error("Demo RPC must use HTTPS");
  return rpc;
}
export async function validatedDemo(origin: string) {
  const raw = process.env.SETSUNA_DEMO_MANIFEST;
  if (!raw) throw new Error("No demo manifest configured");
  const d = demoConfig(raw, `${origin}/api/rpc/`);
  const c = createPublicClient({
    transport: http(demoRPC(), { timeout: 8000, retryCount: 0 }),
  });
  if ((await c.getChainId()) !== d.chainId)
    throw new Error("Demo RPC chain mismatch");
  const abi = parseAbi([
    "function vault() view returns(address)",
    "function asset() view returns(address)",
    "function initialized() view returns(bool)",
    "function adapters(uint256) view returns(address)",
    "function exchange() view returns(address)",
    "function collateral() view returns(address)",
    "function perpId() view returns(uint256)",
    "function market() view returns(address)",
    "function usdc() view returns(address)",
  ]);
  const m = d.earnMON!,
    s = d.spot!;
  const [
    vault,
    asset,
    initialized,
    a,
    b,
    exchange,
    collateral,
    perp,
    market,
    usdc,
  ] = await Promise.all([
    c.readContract({ address: m.gateway, abi, functionName: "vault" }),
    c.readContract({ address: m.vault, abi, functionName: "asset" }),
    c.readContract({ address: m.vault, abi, functionName: "initialized" }),
    c.readContract({
      address: m.vault,
      abi,
      functionName: "adapters",
      args: [BigInt(0)],
    }),
    c.readContract({
      address: m.vault,
      abi,
      functionName: "adapters",
      args: [BigInt(1)],
    }),
    c.readContract({ address: d.factory!, abi, functionName: "exchange" }),
    c.readContract({ address: d.factory!, abi, functionName: "collateral" }),
    c.readContract({ address: d.factory!, abi, functionName: "perpId" }),
    c.readContract({ address: s.gateway, abi, functionName: "market" }),
    c.readContract({ address: s.gateway, abi, functionName: "usdc" }),
  ]);
  const matches = [
    [vault, m.vault],
    [asset, venues.wmon],
    [a, m.adapters[0]],
    [b, m.adapters[1]],
    [exchange, venues.exchange],
    [collateral, venues.collateral],
    [market, venues.market],
    [usdc, venues.usdc],
  ];
  if (
    !initialized ||
    perp !== BigInt(1) ||
    matches.some(([a, b]) => a.toLowerCase() !== b.toLowerCase())
  )
    throw new Error("Demo contract links do not match");
  if (d.earnUSDC) await validateUSDCEarn(c, d.earnUSDC);
  return d;
}
