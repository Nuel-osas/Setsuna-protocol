import { mkdir, open, readFile, rename, unlink } from "node:fs/promises";
import { resolve } from "node:path";
import { fileURLToPath } from "node:url";
import { parseArgs } from "node:util";
import { createWalletClient, http, isAddress, parseGwei } from "viem";
import { privateKeyToAccount } from "viem/accounts";
import { keeperNetwork } from "./earn-keeper-network.mjs";
import {
  assetPolicy,
  executeAction,
  inspectVault,
  json,
  reconcilePending,
  ReconciliationRequired,
} from "./earn-keeper-core.mjs";

async function main() {
  const { values } = parseArgs({
    options: {
      vault: { type: "string" },
      rpc: { type: "string" },
      execute: { type: "boolean", default: false },
      "max-gas-price-gwei": { type: "string" },
      "max-gas": { type: "string", default: "1000000" },
      asset: { type: "string", default: "USDC" },
      multi: { type: "boolean", default: false },
      "min-annual-gain": { type: "string" },
      "min-annual-gain-usdc": { type: "string" },
      "state-dir": { type: "string" },
      "demo-manifest": { type: "string" },
      help: { type: "boolean", default: false },
    },
  });
  if (values.help) {
    console.log(
      "Usage: node scripts/earn-keeper.mjs --vault ADDRESS [--rpc URL]\n" +
        "One read-only check by default. MONAD_RPC_URL supplies the endpoint. Requires chain ID 143.\n" +
        "For a synthetic-fund fork ONLY, pass --demo-manifest PATH --asset MON --rpc URL. Chain and contract links are verified.\n" +
        "Execute at most one permissionless action with --execute --max-gas-price-gwei N and EARN_KEEPER_PRIVATE_KEY.\n" +
        "Optional: --asset MON|USDC --max-gas 1000000 --min-annual-gain 0.001 --state-dir PATH. Gain uses the selected asset, never USD conversion.\n" +
        "Use one dedicated signer and one shared state directory. Pending work is reconciled before further writes.",
    );
    return;
  }
  const address = values.vault;
  const rpc = values.rpc ?? process.env.MONAD_RPC_URL;
  if (!isAddress(address ?? "") || !rpc)
    throw new Error("Provide a vault address and RPC");
  if (!/^\d+$/.test(values["max-gas"]) || BigInt(values["max-gas"]) < 21_000n)
    throw new Error("Invalid execution bounds");
  if (
    values["min-annual-gain-usdc"] &&
    (values.asset !== "USDC" || values["min-annual-gain"])
  ) {
    throw new Error(
      "Use the asset-denominated flag for MON; do not mix gain flags",
    );
  }
  const assetSymbol = values.asset;
  if (values.multi && assetSymbol !== "USDC")
    throw new Error("Multi-vault mode requires USDC");
  const { minimumGain } = assetPolicy(
    assetSymbol,
    values["min-annual-gain"] ?? values["min-annual-gain-usdc"] ?? "0.001",
  );
  const maxGasPrice = values["max-gas-price-gwei"]
    ? parseGwei(values["max-gas-price-gwei"])
    : undefined;
  if (
    values.execute &&
    (!process.env.EARN_KEEPER_PRIVATE_KEY || !maxGasPrice || maxGasPrice <= 0n)
  ) {
    throw new Error(
      "Execution requires EARN_KEEPER_PRIVATE_KEY and a positive gas-price ceiling",
    );
  }
  const abi = JSON.parse(
    await readFile(
      new URL(
        `../contracts/abi/${values.multi ? "SetsunaUSDCVault" : "SetsunaEarnVault"}.json`,
        import.meta.url,
      ),
      "utf8",
    ),
  );
  const manifest = values["demo-manifest"]
    ? JSON.parse(await readFile(values["demo-manifest"], "utf8"))
    : undefined;
  const { client, chain, chainId } = await keeperNetwork({
    rpc,
    manifest,
    address,
    assetSymbol,
  });
  if (!values.execute) {
    console.log(
      json({
        mode: "read-only",
        ...(await inspectVault({
          client,
          address,
          abi,
          minimumGain,
          assetSymbol,
        })),
      }),
    );
    return;
  }
  const wallet = createWalletClient({
    chain,
    account: privateKeyToAccount(process.env.EARN_KEEPER_PRIVATE_KEY),
    transport: http(rpc, { timeout: 15_000, retryCount: 0 }),
  });
  const directory = resolve(
    values["state-dir"] ??
      fileURLToPath(new URL("../.local/earn-executor/", import.meta.url)),
  );
  await mkdir(directory, { recursive: true, mode: 0o700 });
  const prefix = resolve(
    directory,
    `${chainId}-${wallet.account.address.toLowerCase()}`,
  );
  const lock = await open(`${prefix}.lock`, "wx", 0o600);
  try {
    await lock.writeFile(
      json({ pid: process.pid, startedAt: new Date().toISOString() }),
    );
    await lock.sync();
    const persist = async (state) => {
      const temp = `${prefix}.tmp-${process.pid}`;
      const file = await open(temp, "w", 0o600);
      try {
        await file.writeFile(json(state) + "\n");
        await file.sync();
      } finally {
        await file.close();
      }
      await rename(temp, `${prefix}.json`);
      const parent = await open(directory, "r");
      try {
        await parent.sync();
      } finally {
        await parent.close();
      }
    };
    let state;
    try {
      state = JSON.parse(await readFile(`${prefix}.json`, "utf8"));
    } catch (error) {
      if (error.code !== "ENOENT") throw error;
    }
    const reconciled = await reconcilePending({
      client,
      state,
      persist,
      abi,
      chainId,
      signer: wallet.account.address,
    });
    if (reconciled) {
      console.log(json({ mode: "execute", reconciled }));
      return;
    }
    const report = await inspectVault({
      client,
      address,
      abi,
      minimumGain,
      assetSymbol,
    });
    if (!report.action) {
      console.log(json({ mode: "execute", ...report }));
      return;
    }
    const result = await executeAction({
      client,
      wallet,
      address,
      abi,
      action: report.action,
      chainId,
      maxGasPrice,
      maxGas: BigInt(values["max-gas"]),
      minimumGain,
      persist,
    });
    console.log(json({ mode: "execute", vault: address, result }));
  } finally {
    await lock.close();
    await unlink(`${prefix}.lock`);
  }
}

main().catch((error) => {
  // Do not echo exception messages: RPC errors may contain endpoint credentials.
  console.error(
    json({
      action: "stopped",
      error: error?.name ?? "Error",
      ...(error instanceof ReconciliationRequired
        ? { hash: error.hash, reconciliationRequired: true }
        : {}),
    }),
  );
  process.exitCode = 1;
});
