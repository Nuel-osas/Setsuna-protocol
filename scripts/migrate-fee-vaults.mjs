// One-time hosted-fork migration: deploys fee-enabled setsMON and setsUSDC
// vaults beside the existing fee-free ones, seeds them with synthetic funds and
// switches the deployment manifest to them. The old vaults stay on the fork,
// unused. Re-running after a failure starts again from a fresh deployer; the
// manifest changes only once everything is confirmed.
import { readFile, rename, mkdir } from "node:fs/promises";
import { existsSync } from "node:fs";
import { parseArgs } from "node:util";
import {
  createPublicClient,
  createWalletClient,
  decodeEventLog,
  erc20Abi,
  http,
  parseAbi,
  parseEther,
  toHex,
} from "viem";
import { generatePrivateKey, privateKeyToAccount } from "viem/accounts";
import { atomicJSON } from "./anvil-demo-gateway.mjs";
import { reviewedDemoFork } from "./demo-fork-profiles.mjs";
import { validateUSDCEarn } from "../src/lib/setsuna/usdc-deployment.ts";

const EARN_FEE_BPS = 200; // 2% of yield; matches start-anvil-demo.mjs

const { values } = parseArgs({
  options: {
    "state-dir": { type: "string" },
    "local-admin": { type: "boolean", default: false },
  },
});
const USDC = "0x754704Bc059F8C67012fEd69BC8A327a5aafb603";
const SEED_MON = parseEther("10");
const SEED_USDC = 500n * 10n ** 6n;

async function main() {
  const stateDir = values["state-dir"];
  const adminRPC = process.env.SETSUNA_DEMO_ADMIN_RPC_URL;
  const treasury = process.env.SETSUNA_TREASURY;
  if (!stateDir || !adminRPC)
    throw new Error("State directory and admin RPC required");
  if (
    !values["local-admin"] ||
    !["127.0.0.1", "localhost"].includes(new URL(adminRPC).hostname)
  )
    throw new Error("Migration runs only through the loopback fork");
  if (
    !/^0x[0-9a-fA-F]{40}$/.test(treasury ?? "") ||
    /^0x0{40}$/i.test(treasury)
  )
    throw new Error("SETSUNA_TREASURY must be the fee recipient address");
  const manifestPath = `${stateDir}/deployment/manifest.json`;
  const manifest = JSON.parse(await readFile(manifestPath, "utf8"));
  reviewedDemoFork(manifest);
  if (
    manifest.earnFee?.bps === EARN_FEE_BPS &&
    manifest.earnFee?.recipient?.toLowerCase() === treasury.toLowerCase()
  ) {
    console.log(
      JSON.stringify({ event: "fee-vaults-present", vault: manifest.vault }),
    );
    return;
  }
  // Never move keepers while a transaction is unreconciled.
  for (const asset of ["mon", "usdc"]) {
    const dir = `${stateDir}/workers/${asset}`;
    if (!existsSync(dir)) continue;
    for (const name of (await import("node:fs")).readdirSync(dir))
      if (name.endsWith(".json")) {
        const journal = JSON.parse(await readFile(`${dir}/${name}`, "utf8"));
        if (journal.pending)
          throw new Error(
            `Pending ${asset} keeper transaction; reconcile first`,
          );
      }
  }

  const client = createPublicClient({
    transport: http(adminRPC, { timeout: 30000, retryCount: 0 }),
  });
  if ((await client.getChainId()) !== 31337)
    throw new Error("Demo chain 31337 required");
  const owner = privateKeyToAccount(generatePrivateKey()).address;
  await client.request({
    method: "anvil_setBalance",
    params: [owner, toHex(parseEther("1000"))],
  });
  await client.request({ method: "anvil_impersonateAccount", params: [owner] });
  const wallet = createWalletClient({
    account: owner,
    transport: http(adminRPC, { timeout: 30000, retryCount: 0 }),
  });
  const artifact = async (file, name = file) =>
    JSON.parse(
      await readFile(
        new URL(`../contracts/out/${file}.sol/${name}.json`, import.meta.url),
        "utf8",
      ),
    );
  let step = "setup";
  const send = async (request) => {
    let gas;
    try {
      await client.simulateContract({ ...request, account: owner });
      gas = await client.estimateContractGas({ ...request, account: owner });
    } catch (error) {
      throw new Error(
        `Migration simulation failed at ${step}: ${String(error.shortMessage ?? error.message).split("\n")[0]}`,
      );
    }
    // Vault calls read every venue through try/catch, so a bare estimate can
    // run out of gas on execution; the fork's 1B block limit leaves ample room.
    return wallet.writeContract({ ...request, gas: (gas * 3n) / 2n });
  };
  const confirm = async (hash) => {
    const receipt = await client.waitForTransactionReceipt({
      hash,
      timeout: 60000,
    });
    if (receipt.status !== "success")
      throw new Error(`Migration transaction reverted at ${step}`);
    return receipt;
  };
  const deploy = async (file, name, args) => {
    const a = await artifact(file, name);
    const receipt = await confirm(
      await wallet.deployContract({
        abi: a.abi,
        bytecode: a.bytecode.object,
        args,
        chain: null,
      }),
    );
    return receipt.contractAddress;
  };
  const created = (receipt, abi, from) =>
    receipt.logs
      .filter((l) => l.address.toLowerCase() === from.toLowerCase())
      .flatMap((l) => {
        try {
          return [decodeEventLog({ abi, data: l.data, topics: l.topics })];
        } catch {
          return [];
        }
      })
      .find((e) => e.eventName === "VaultCreated");

  try {
    // setsMON
    step = "setsMON";
    const monFactory = await deploy("LocalEarnDemo.s", "LocalMONFactory", [
      treasury,
      BigInt(EARN_FEE_BPS),
    ]);
    const monAbi = (await artifact("LocalEarnDemo.s", "LocalMONFactory")).abi;
    const monReceipt = await confirm(
      await send({
        address: monFactory,
        abi: monAbi,
        functionName: "createVault",
        chain: null,
      }),
    );
    const mon = created(monReceipt, monAbi, monFactory);
    if (!mon) throw new Error("setsMON creation event missing");

    // setsUSDC (five protocols)
    step = "setsUSDC";
    const vaultDeployer = await deploy(
      "SetsunaUSDCV2Factory",
      "USDCV2VaultDeployer",
      [treasury, BigInt(EARN_FEE_BPS), 25_000n * 10n ** 6n],
    );
    const usdcFactory = await deploy(
      "SetsunaUSDCV2Factory",
      "SetsunaUSDCV2Factory",
      [vaultDeployer],
    );
    const usdcAbi = (await artifact("SetsunaUSDCV2Factory")).abi;
    const usdcReceipt = await confirm(
      await send({
        address: usdcFactory,
        abi: usdcAbi,
        functionName: "createFiveProtocolVault",
        chain: null,
      }),
    );
    const usdc = created(usdcReceipt, usdcAbi, usdcFactory);
    if (!usdc || usdc.args.adapters.length !== 5)
      throw new Error("Five-protocol creation event missing");
    const startBlock = String(monReceipt.blockNumber);
    const earnUSDC = {
      vault: usdc.args.vault,
      asset: USDC,
      adapters: usdc.args.adapters,
      forkBlock: manifest.forkBlock,
      startBlock: String(usdcReceipt.blockNumber),
    };
    await validateUSDCEarn(client, earnUSDC);

    // Every new vault must carry the fixed fee.
    const feeAbi = parseAbi([
      "function feeRecipient() view returns (address)",
      "function performanceFeeBps() view returns (uint256)",
    ]);
    for (const vault of [mon.args.vault, earnUSDC.vault]) {
      const [recipient, bps] = await Promise.all([
        client.readContract({
          address: vault,
          abi: feeAbi,
          functionName: "feeRecipient",
        }),
        client.readContract({
          address: vault,
          abi: feeAbi,
          functionName: "performanceFeeBps",
        }),
      ]);
      if (
        recipient.toLowerCase() !== treasury.toLowerCase() ||
        Number(bps) !== EARN_FEE_BPS
      )
        throw new Error("New vault does not carry the configured fee");
    }

    // Synthetic seed deposits, as the original demo vaults had.
    step = "seed";
    await confirm(
      await send({
        address: mon.args.gateway,
        abi: parseAbi([
          "function depositMON(address receiver, uint256 minShares, uint256 deadline) payable returns (uint256)",
        ]),
        functionName: "depositMON",
        args: [owner, 1n, BigInt(Math.floor(Date.now() / 1000) + 3600)],
        value: SEED_MON,
        chain: null,
      }),
    );
    const trace = await client.request({
      method: "debug_traceCall",
      params: [
        { to: USDC, data: `0x70a08231${owner.slice(2).padStart(64, "0")}` },
        "latest",
        { disableMemory: true, disableStorage: true },
      ],
    });
    const slot = toHex(
      BigInt(
        `0x${trace.structLogs
          .filter((x) => x.op === "SLOAD")
          .at(-1)
          .stack.at(-1)
          .replace(/^0x/, "")}`,
      ),
      { size: 32 },
    );
    await client.request({
      method: "anvil_setStorageAt",
      params: [USDC, slot, toHex(SEED_USDC, { size: 32 })],
    });
    if (
      (await client.readContract({
        address: USDC,
        abi: erc20Abi,
        functionName: "balanceOf",
        args: [owner],
      })) !== SEED_USDC
    )
      throw new Error("USDC seed funding layout mismatch");
    await confirm(
      await send({
        address: USDC,
        abi: erc20Abi,
        functionName: "approve",
        args: [earnUSDC.vault, SEED_USDC],
        chain: null,
      }),
    );
    await confirm(
      await send({
        address: earnUSDC.vault,
        abi: parseAbi([
          "function deposit(uint256 assets, address receiver) returns (uint256)",
        ]),
        functionName: "deposit",
        args: [SEED_USDC, owner],
        chain: null,
      }),
    );

    // Old keeper journals describe the old vaults; keep them for the record.
    const workers = `${stateDir}/workers`;
    if (existsSync(workers)) {
      const archive = `${stateDir}/workers-before-fee-vaults-${Date.now()}`;
      await mkdir(archive, { recursive: true, mode: 0o700 });
      for (const name of ["manifest.json", "mon", "usdc"])
        if (existsSync(`${workers}/${name}`))
          await rename(`${workers}/${name}`, `${archive}/${name}`);
    }
    const next = {
      ...manifest,
      startBlock,
      vault: mon.args.vault,
      gateway: mon.args.gateway,
      neverland: mon.args.neverlandAdapter,
      euler: mon.args.eulerAdapter,
      earnUSDC,
      usdcFactory,
      usdcVaultDeployer: vaultDeployer,
      earnFee: {
        bps: EARN_FEE_BPS,
        recipient: treasury,
        migratedAtBlock: String(usdcReceipt.blockNumber),
        previous: {
          vault: manifest.vault,
          usdcVault: manifest.earnUSDC?.vault,
        },
      },
    };
    await atomicJSON(`${manifestPath}.before-fee-vaults`, manifest);
    await atomicJSON(manifestPath, next);
    console.log(
      JSON.stringify({
        event: "fee-vaults-migrated",
        mon: next.vault,
        usdc: earnUSDC.vault,
        treasury,
      }),
    );
  } finally {
    await client
      .request({ method: "anvil_stopImpersonatingAccount", params: [owner] })
      .catch(() => {});
  }
}
main().catch((error) => {
  console.error(
    `Fee vault migration stopped: ${String(
      error.message?.includes("at ")
        ? error.message
        : (error.shortMessage ?? error.message),
    )
      .replace(/https?:\/\/[^\s"'<>]+/g, "[RPC endpoint]")
      .slice(0, 300)}`,
  );
  process.exitCode = 1;
});
