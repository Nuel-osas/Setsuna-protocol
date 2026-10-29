"use client";

import { createPublicClient, http, parseAbi } from "viem";
import { aptosUsdcBalance } from "./aptos";
import type { Chain } from "./chains";
import { suiUsdcBalance } from "./sui";

const erc20 = parseAbi(["function balanceOf(address) view returns (uint256)"]);

// USDC balance in base units (6 decimals) on any supported ecosystem.
export async function usdcBalance(chain: Chain, owner: string): Promise<bigint | null> {
  if (chain.ecosystem === "sui") return suiUsdcBalance(chain.network, owner);
  if (chain.ecosystem === "aptos") return aptosUsdcBalance(chain.network, owner);
  if (!chain.usdc || !chain.rpc) return null;
  try {
    if (chain.ecosystem === "evm") {
      const client = createPublicClient({ transport: http(chain.rpc) });
      return await client.readContract({ address: chain.usdc as `0x${string}`, abi: erc20, functionName: "balanceOf", args: [owner as `0x${string}`] });
    }
    if (chain.ecosystem === "solana") {
      const r = await fetch(chain.rpc, {
        method: "POST",
        headers: { "content-type": "application/json" },
        body: JSON.stringify({ jsonrpc: "2.0", id: 1, method: "getTokenAccountsByOwner", params: [owner, { mint: chain.usdc }, { encoding: "jsonParsed" }] }),
      });
      const j = await r.json();
      const accts: { account: { data: { parsed: { info: { tokenAmount: { amount: string } } } } } }[] = j.result?.value ?? [];
      return accts.reduce((s, a) => s + BigInt(a.account.data.parsed.info.tokenAmount.amount), 0n);
    }
  } catch {}
  return null;
}
