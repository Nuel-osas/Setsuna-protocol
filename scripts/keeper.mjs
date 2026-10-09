import { readFile } from "node:fs/promises";
import { parseArgs } from "node:util";
import { setTimeout as delay } from "node:timers/promises";
import { createPublicClient, createWalletClient, defineChain, http, isAddress, parseGwei } from "viem";
import { privateKeyToAccount } from "viem/accounts";
import { checkAccount, json, PendingReceiptError } from "./keeper-core.mjs";

const { values } = parseArgs({ options: {
  account: { type: "string", multiple: true }, rpc: { type: "string" }, "chain-id": { type: "string" },
  execute: { type: "boolean", default: false }, watch: { type: "boolean", default: false },
  "poll-ms": { type: "string", default: "2000" }, "max-gas-price-gwei": { type: "string" },
  "min-fee-cns": { type: "string", default: "0" }, help: { type: "boolean", default: false },
} });
if (values.help) {
  console.log("Usage: node scripts/keeper.mjs --rpc URL --chain-id ID --account ADDRESS [--account ADDRESS] [--watch]\n" +
    "Defaults to one read-only check. To execute: --execute --max-gas-price-gwei N and KEEPER_PRIVATE_KEY in the environment.\n" +
    "Optional: --poll-ms 2000 --min-fee-cns 0. Run only one execution process per signer.");
  process.exit(0);
}
const rpc = values.rpc ?? process.env.MONAD_RPC_URL;
const chainId = Number(values["chain-id"]);
const addresses = values.account ?? [];
const pollMs = Number(values["poll-ms"]);
if (!rpc || !Number.isSafeInteger(chainId) || chainId < 1 || addresses.length === 0 ||
    !addresses.every((address) => isAddress(address)) || !Number.isSafeInteger(pollMs) || pollMs < 500) {
  throw new Error("Provide --rpc, --chain-id and valid --account addresses; --poll-ms must be at least 500");
}
if (!/^\d+$/.test(values["min-fee-cns"])) throw new Error("--min-fee-cns must be a nonnegative integer");
const maxGasPrice = values["max-gas-price-gwei"] ? parseGwei(values["max-gas-price-gwei"]) : undefined;
if (values.execute && (!process.env.KEEPER_PRIVATE_KEY || !maxGasPrice || maxGasPrice <= 0n)) {
  throw new Error("--execute requires KEEPER_PRIVATE_KEY and a positive --max-gas-price-gwei");
}
const chain = defineChain({ id: chainId, name: "Configured Monad/Local Network", nativeCurrency: { name: "MON", symbol: "MON", decimals: 18 }, rpcUrls: { default: { http: [rpc] } } });
const publicClient = createPublicClient({ chain, transport: http(rpc, { timeout: 15_000 }) });
if (await publicClient.getChainId() !== chainId) throw new Error("RPC chain ID differs from --chain-id");
const walletClient = values.execute ? createWalletClient({ chain, transport: http(rpc), account: privateKeyToAccount(process.env.KEEPER_PRIVATE_KEY) }) : undefined;
const abi = JSON.parse(await readFile(new URL("../contracts/abi/SetsunaAccount.json", import.meta.url), "utf8"));
let stopping = false;
process.on("SIGINT", () => { stopping = true; });
process.on("SIGTERM", () => { stopping = true; });
do {
  for (const address of [...new Set(addresses.map((address) => address.toLowerCase()))]) {
    if (stopping) break;
    try {
      console.log(json({ observedAt: new Date().toISOString(), chainId, ...await checkAccount({
        publicClient, walletClient, address, abi, execute: values.execute, maxGasPrice,
        minFee: BigInt(values["min-fee-cns"]),
      }) }));
    } catch (error) {
      // RPC exception details can contain credential-bearing endpoints; print only the error class.
      console.error(json({ account: address, action: "check-failed", error: error?.name ?? "Error" }));
      if (error instanceof PendingReceiptError) {
        console.error(json({ action: "stopped-for-reconciliation", hash: error.hash }));
        stopping = true;
        process.exitCode = 1;
      }
      if (!values.watch) process.exitCode = 1;
    }
  }
  if (values.watch && !stopping) await delay(pollMs);
} while (values.watch && !stopping);
