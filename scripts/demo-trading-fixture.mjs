// Synthetic demo only. No oracle mutation path exists on Monad mainnet/testnet.
import { readFile } from "node:fs/promises";
import {
  createPublicClient,
  createWalletClient,
  http,
  parseAbi,
  parseEther,
  toHex,
} from "viem";
import { keeperNetwork } from "./earn-keeper-network.mjs";
import { venues } from "../src/lib/setsuna/demo-config.ts";
import { reviewedDemoFork } from "./demo-fork-profiles.mjs";
const ownerABI = parseAbi([
  "function owner() view returns(address)",
  "function setIgnOracle(uint256 perpId, bool ignore)",
  "function updateMarkPricePNSByOwner(uint256 perpId, uint32 price)",
]);

export async function demoTradingFixture({
  rpc,
  adminRPC,
  manifest,
  localAdmin = false,
  record = async () => {},
}) {
  for (const value of [rpc, adminRPC]) {
    const url = new URL(value);
    if (
      localAdmin
        ? !["localhost", "127.0.0.1"].includes(url.hostname)
        : url.protocol !== "https:"
    )
      throw new Error("Unreviewed fixture transport");
  }
  const profile = reviewedDemoFork(manifest);
  const proofBlock = profile.block,
    proofHash = profile.hash;
  const { client } = await keeperNetwork({
    rpc,
    manifest,
    address: manifest.vault,
    assetSymbol: "MON",
  });
  const admin = createPublicClient({
    transport: http(adminRPC, { timeout: 15000, retryCount: 0 }),
  });
  async function guard() {
    if (
      (await client.getChainId()) !== 31337 ||
      (await admin.getChainId()) !== 31337
    )
      throw new Error("Fixture refuses non-demo chain");
    const b = await client.getBlock();
    if (
      (await admin.getBlock({ blockNumber: b.number })).hash !== b.hash ||
      (await client.getBlock({ blockNumber: proofBlock })).hash !== proofHash
    )
      throw new Error("Fixture endpoints do not identify the reviewed fork");
  }
  await guard();
  const exchangeABI = JSON.parse(
    await readFile(
      new URL("../contracts/abi/IPerplExchange.json", import.meta.url),
    ),
  );
  // Reviewed price recorded by .local/trading/demo.json at the source fork.
  // Pin it explicitly: nested/pruned forks need not retain historical eth_call state.
  const original = await client.readContract({
    address: venues.exchange,
    abi: exchangeABI,
    functionName: "getPerpetualInfo",
    args: [1n],
  });
  if (original.markPNS !== profile.markPNS)
    throw new Error("Venue mark differs from the reviewed historical fixture");
  const owner = await client.readContract({
    address: venues.exchange,
    abi: ownerABI,
    functionName: "owner",
  });
  const fixture = {
    mode: "FIXED_HISTORICAL_MARK",
    markPNS: String(original.markPNS),
    originalMarkTimestamp: profile.markTimestamp,
    oracleGuardDisabledOnFork: true,
  };
  if (original.markPNS <= 0n || original.markPNS > 0xffffffffn)
    throw new Error("Invalid historical mark");
  if (
    manifest.perplFixture &&
    (manifest.perplFixture.mode !== fixture.mode ||
      manifest.perplFixture.markPNS !== fixture.markPNS ||
      manifest.perplFixture.oracleGuardDisabledOnFork !== true)
  )
    throw new Error("Manifest fixture differs from reviewed source");
  async function call(functionName, args) {
    await guard();
    if (localAdmin)
      await admin.request({
        method: "anvil_impersonateAccount",
        params: [owner],
      });
    const entry = {
      operation: functionName,
      state: "pending",
      at: new Date().toISOString(),
    };
    await record(entry);
    try {
      const wallet = createWalletClient({
        account: owner,
        transport: http(adminRPC, { timeout: 15000, retryCount: 0 }),
      });
      const { request } = await client.simulateContract({
        address: venues.exchange,
        abi: ownerABI,
        functionName,
        args,
        account: owner,
      });
      const hash = await wallet.writeContract({ ...request, chain: null });
      entry.hash = hash;
      await record(entry);
      const receipt = await client.waitForTransactionReceipt({
        hash,
        timeout: 60000,
      });
      if (receipt.status !== "success")
        throw new Error("Fixture operation reverted");
      entry.state = "confirmed";
      await record(entry);
      return hash;
    } finally {
      if (localAdmin)
        await admin.request({
          method: "anvil_stopImpersonatingAccount",
          params: [owner],
        });
    }
  }
  return {
    fixture,
    async prepare() {
      await guard();
      await admin.request({
        method: localAdmin ? "anvil_setBalance" : "tenderly_setBalance",
        params: [owner, toHex(parseEther("10"))],
      });
      await call("setIgnOracle", [1n, true]);
      await this.refresh();
      return fixture;
    },
    async refresh() {
      const hash = await call("updateMarkPricePNSByOwner", [
        1n,
        Number(original.markPNS),
      ]);
      const latest = await client.readContract({
        address: venues.exchange,
        abi: exchangeABI,
        functionName: "getPerpetualInfo",
        args: [1n],
      });
      if (latest.markPNS !== original.markPNS)
        throw new Error("Fixture mark was not applied");
      return {
        hash,
        markPNS: String(latest.markPNS),
        markTimestamp: String(latest.markTimestamp),
      };
    },
  };
}
