import { isAddress, parseAbi, type PublicClient, type Address } from "viem";
import type { Deployment } from "./types";

export const USDC_ASSET = "0x754704Bc059F8C67012fEd69BC8A327a5aafb603" as const;
export function parseUSDCEarn(
  value: unknown,
): NonNullable<Deployment["earnUSDC"]> {
  const m = value as NonNullable<Deployment["earnUSDC"]>;
  const validAddress = (x: unknown): x is Address =>
    typeof x === "string" && isAddress(x) && !/^0x0{40}$/i.test(x);
  if (
    !m ||
    !validAddress(m.vault) ||
    m.asset?.toLowerCase() !== USDC_ASSET.toLowerCase() ||
    !Array.isArray(m.adapters) ||
    ![4, 5].includes(m.adapters.length) ||
    !m.adapters.every(validAddress) ||
    new Set(m.adapters.map((x) => x.toLowerCase())).size !==
      m.adapters.length ||
    !/^\d+$/.test(m.forkBlock) ||
    !/^\d+$/.test(m.startBlock)
  )
    throw new Error("Invalid four- or five-protocol USDC deployment");
  return {
    vault: m.vault,
    asset: USDC_ASSET,
    adapters: [...m.adapters],
    forkBlock: m.forkBlock,
    startBlock: m.startBlock,
  };
}
export async function validateUSDCEarn(
  c: PublicClient,
  m: NonNullable<Deployment["earnUSDC"]>,
) {
  const abi = parseAbi([
    "function asset() view returns(address)",
    "function vault() view returns(address)",
    "function initialized() view returns(bool)",
    "function destinationCount() view returns(uint256)",
    "function adapters(uint256) view returns(address)",
  ]);
  const [asset, initialized, count, links] = await Promise.all([
    c.readContract({ address: m.vault, abi, functionName: "asset" }),
    c.readContract({ address: m.vault, abi, functionName: "initialized" }),
    c.readContract({ address: m.vault, abi, functionName: "destinationCount" }),
    Promise.all(
      m.adapters.map(async (address, i) =>
        Promise.all([
          c.readContract({
            address: m.vault,
            abi,
            functionName: "adapters",
            args: [BigInt(i)],
          }),
          c.readContract({ address, abi, functionName: "vault" }),
          c.readContract({ address, abi, functionName: "asset" }),
        ]),
      ),
    ),
  ]);
  if (
    !initialized ||
    count !== BigInt(m.adapters.length) ||
    asset.toLowerCase() !== m.asset.toLowerCase() ||
    links.some(
      ([adapter, vault, token], i) =>
        adapter.toLowerCase() !== m.adapters[i].toLowerCase() ||
        vault.toLowerCase() !== m.vault.toLowerCase() ||
        token.toLowerCase() !== m.asset.toLowerCase(),
    )
  )
    throw new Error("USDC vault links differ from manifest");
}
