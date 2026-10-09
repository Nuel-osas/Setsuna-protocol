import { createPublicClient, defineChain, http, parseAbi } from "viem";
import { monad } from "viem/chains";
import { demoConfig } from "../src/lib/setsuna/demo-config.ts";
import {
  parseUSDCEarn,
  validateUSDCEarn,
} from "../src/lib/setsuna/usdc-deployment.ts";

/** Explicit demo opt-in; the existing production path remains chain 143 only. */
export async function keeperNetwork({ rpc, manifest, address, assetSymbol }) {
  const client = createPublicClient({
    transport: http(rpc, { timeout: 15000, retryCount: 0 }),
  });
  const actualChain = await client.getChainId();
  if (manifest?.mode === "LOCAL_USDC_FORK_ONLY") {
    const m = parseUSDCEarn(manifest.earnUSDC);
    if (
      !["localhost", "127.0.0.1"].includes(new URL(rpc).hostname) ||
      actualChain !== 31337 ||
      manifest.chainId !== 31337 ||
      manifest.syntheticFunding !== true ||
      assetSymbol !== "USDC" ||
      address.toLowerCase() !== m.vault.toLowerCase()
    )
      throw new Error("Invalid local USDC executor environment");
    if (
      (await client.getBlock({ blockNumber: BigInt(m.forkBlock) })).hash !==
      manifest.forkHash
    )
      throw new Error("USDC source block mismatch");
    await validateUSDCEarn(client, m);
    return {
      client,
      chainId: actualChain,
      chain: defineChain({
        id: 31337,
        name: "Setsuna USDC fork",
        nativeCurrency: { name: "MON", symbol: "MON", decimals: 18 },
        rpcUrls: { default: { http: [rpc] } },
      }),
    };
  }
  if (!manifest) {
    if (actualChain !== 143)
      throw new Error("RPC must report Monad chain ID 143");
    return { client, chain: monad, chainId: actualChain };
  }
  const d = demoConfig(JSON.stringify(manifest), rpc);
  if (assetSymbol === "USDC" && d.earnUSDC) {
    const m = d.earnUSDC;
    if (
      actualChain !== d.chainId ||
      address.toLowerCase() !== m.vault.toLowerCase() ||
      (await client.getBlock({ blockNumber: BigInt(m.forkBlock) })).hash !==
        manifest.forkHash
    )
      throw new Error("Hosted USDC source or vault mismatch");
    await validateUSDCEarn(client, m);
    return {
      client,
      chainId: actualChain,
      chain: defineChain({
        id: actualChain,
        name: "Setsuna USDC demo",
        nativeCurrency: { name: "MON", symbol: "MON", decimals: 18 },
        rpcUrls: { default: { http: [rpc] } },
      }),
    };
  }
  if (
    actualChain !== d.chainId ||
    assetSymbol !== "MON" ||
    address.toLowerCase() !== d.earnMON.vault.toLowerCase()
  )
    throw new Error("Demo executor asset, vault or network mismatch");
  if (!/^0x[0-9a-fA-F]{64}$/.test(manifest.forkHash ?? ""))
    throw new Error("Demo executor requires the reviewed source block hash");
  const fork = await client.getBlock({
    blockNumber: BigInt(d.earnMON.forkBlock),
  });
  if (fork.hash.toLowerCase() !== manifest.forkHash.toLowerCase())
    throw new Error("Demo source block mismatch");
  const abi = parseAbi([
    "function vault() view returns(address)",
    "function asset() view returns(address)",
    "function initialized() view returns(bool)",
    "function adapters(uint256) view returns(address)",
  ]);
  const m = d.earnMON;
  const [linked, asset, initialized, a, b] = await Promise.all([
    client.readContract({ address: m.gateway, abi, functionName: "vault" }),
    client.readContract({ address, abi, functionName: "asset" }),
    client.readContract({ address, abi, functionName: "initialized" }),
    client.readContract({ address, abi, functionName: "adapters", args: [0n] }),
    client.readContract({ address, abi, functionName: "adapters", args: [1n] }),
  ]);
  if (
    !initialized ||
    [
      [linked, address],
      [asset, m.asset],
      [a, m.adapters[0]],
      [b, m.adapters[1]],
    ].some(([x, y]) => x.toLowerCase() !== y.toLowerCase())
  )
    throw new Error("Demo vault links differ from the reviewed manifest");
  return {
    client,
    chainId: actualChain,
    chain: defineChain({
      id: actualChain,
      name: "Setsuna synthetic-fund demo",
      nativeCurrency: { name: "MON", symbol: "MON", decimals: 18 },
      rpcUrls: { default: { http: [rpc] } },
    }),
  };
}
