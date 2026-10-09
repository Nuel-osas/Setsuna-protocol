import { mkdir, readFile, writeFile } from "node:fs/promises";
import { resolve } from "node:path";
import { spawn } from "node:child_process";
import { parseArgs } from "node:util";
import {
  createPublicClient,
  createWalletClient,
  decodeEventLog,
  getContractAddress,
  http,
  parseEther,
  toHex,
} from "viem";
import { generatePrivateKey, privateKeyToAccount } from "viem/accounts";
import { demoTradingFixture } from "./demo-trading-fixture.mjs";
import { demoForkProfiles } from "./demo-fork-profiles.mjs";
import { validateUSDCEarn } from "../src/lib/setsuna/usdc-deployment.ts";

const { values } = parseArgs({
  options: {
    output: { type: "string" },
    execute: { type: "boolean", default: false },
    "local-admin": { type: "boolean", default: false },
    unified: { type: "boolean", default: false },
  },
});
const profile = demoForkProfiles[values.unified ? "unified" : "trading"];
const proofBlock = profile.block,
  proofHash = profile.hash;
async function main() {
  const rpc = process.env.SETSUNA_DEMO_RPC_URL,
    adminRPC = process.env.SETSUNA_DEMO_ADMIN_RPC_URL;
  if (!rpc || !adminRPC || !values.output)
    throw new Error("Demo RPCs and a new output directory are required");
  for (const value of [rpc, adminRPC]) {
    const url = new URL(value);
    if (
      values["local-admin"]
        ? !["localhost", "127.0.0.1"].includes(url.hostname)
        : url.protocol !== "https:"
    )
      throw new Error("Unreviewed RPC transport");
  }
  const client = createPublicClient({
    transport: http(rpc, { timeout: 15000, retryCount: 0 }),
  });
  const admin = createPublicClient({
    transport: http(adminRPC, { timeout: 15000, retryCount: 0 }),
  });
  if (
    (await client.getChainId()) !== 31337 ||
    (await admin.getChainId()) !== 31337
  )
    throw new Error("Demo chain 31337 required");
  const block = await client.getBlock();
  if (
    (await admin.getBlock({ blockNumber: block.number })).hash !== block.hash ||
    (await client.getBlock({ blockNumber: proofBlock })).hash !== proofHash
  )
    throw new Error("Endpoints do not identify the reviewed Monad fork");
  if (!values.execute) {
    console.log(
      JSON.stringify({
        mode: "read-only",
        chainId: 31337,
        sourceBlock: String(proofBlock),
        next: "Pass --execute to deploy the reviewed synthetic-fund demo.",
      }),
    );
    return;
  }
  const dir = resolve(values.output);
  // No automatic overwrite/resume after an uncertain broadcast.
  await mkdir(dir, { mode: 0o700 });
  const owner = privateKeyToAccount(generatePrivateKey()).address;
  const keeperKey = generatePrivateKey(),
    keeper = privateKeyToAccount(keeperKey).address;
  const usdcKeeperKey = values.unified ? generatePrivateKey() : undefined;
  const usdcKeeper = usdcKeeperKey
    ? privateKeyToAccount(usdcKeeperKey).address
    : undefined;
  const journal = {
    chainId: 31337,
    owner,
    keeper,
    ...(usdcKeeper ? { usdcKeeper } : {}),
    sourceBlock: String(proofBlock),
    operations: [],
  };
  const save = () =>
    writeFile(
      `${dir}/deployment-journal.json`,
      JSON.stringify(journal, null, 2) + "\n",
      { mode: 0o600 },
    );
  await save();
  await writeFile(
    `${dir}/keeper.env`,
    `EARN_KEEPER_PRIVATE_KEY=${keeperKey}\nMONAD_RPC_URL=${JSON.stringify(rpc)}\n`,
    { mode: 0o600, flag: "wx" },
  );
  if (usdcKeeperKey)
    await writeFile(
      `${dir}/usdc-keeper.env`,
      `EARN_KEEPER_PRIVATE_KEY=${usdcKeeperKey}\nMONAD_RPC_URL=${JSON.stringify(rpc)}\n`,
      { mode: 0o600, flag: "wx" },
    );
  for (const account of [owner, keeper, ...(usdcKeeper ? [usdcKeeper] : [])])
    await admin.request({
      method: values["local-admin"]
        ? "anvil_setBalance"
        : "tenderly_setBalance",
      params: [account, toHex(parseEther("100"))],
    });
  if (values["local-admin"])
    await admin.request({
      method: "anvil_impersonateAccount",
      params: [owner],
    });
  const wallet = createWalletClient({
    account: owner,
    transport: http(adminRPC, { timeout: 15000, retryCount: 0 }),
  });
  const artifact = async (file, name = file) =>
    JSON.parse(
      await readFile(
        new URL(`../contracts/out/${file}.sol/${name}.json`, import.meta.url),
        "utf8",
      ),
    );
  async function deploy(file, name, args = []) {
    const a = await artifact(file, name);
    if (
      (a.bytecode.object.length - 2) / 2 > 49152 ||
      (a.deployedBytecode.object.length - 2) / 2 > 24576
    )
      throw new Error(`Contract size limit exceeded: ${name}`);
    const nonce = await client.getTransactionCount({
      address: owner,
      blockTag: "pending",
    });
    const expected = getContractAddress({ from: owner, nonce: BigInt(nonce) });
    const entry = {
      operation: name,
      nonce,
      address: expected,
      state: "pending",
    };
    journal.operations.push(entry);
    await save();
    const hash = await wallet.deployContract({
      abi: a.abi,
      bytecode: a.bytecode.object,
      args,
      nonce,
      chain: null,
    });
    entry.hash = hash;
    await save();
    const receipt = await client.waitForTransactionReceipt({
      hash,
      timeout: 60000,
    });
    if (
      receipt.status !== "success" ||
      receipt.contractAddress?.toLowerCase() !== expected.toLowerCase()
    )
      throw new Error("Deployment not confirmed");
    entry.state = "confirmed";
    await save();
    return expected;
  }
  const factory = await deploy("LocalEarnDemo.s", "LocalMONFactory");
  const monFactory = await artifact("LocalEarnDemo.s", "LocalMONFactory");
  const createEntry = {
    operation: "createVault",
    state: "pending",
    nonce: await client.getTransactionCount({
      address: owner,
      blockTag: "pending",
    }),
  };
  journal.operations.push(createEntry);
  await save();
  const { request } = await client.simulateContract({
    address: factory,
    abi: monFactory.abi,
    functionName: "createVault",
    account: owner,
  });
  const hash = await wallet.writeContract({
    ...request,
    nonce: createEntry.nonce,
    chain: null,
  });
  createEntry.hash = hash;
  await save();
  const receipt = await client.waitForTransactionReceipt({
    hash,
    timeout: 60000,
  });
  if (receipt.status !== "success")
    throw new Error("Vault initialization failed");
  const event = receipt.logs
    .filter((l) => l.address.toLowerCase() === factory.toLowerCase())
    .flatMap((l) => {
      try {
        return [
          decodeEventLog({
            abi: monFactory.abi,
            data: l.data,
            topics: l.topics,
          }),
        ];
      } catch {
        return [];
      }
    })
    .find((e) => e.eventName === "VaultCreated");
  if (!event) throw new Error("Vault creation event missing");
  createEntry.state = "confirmed";
  await save();
  const exchange = "0x34B6552d57a35a1D042CcAe1951BD1C370112a6F",
    ausd = "0x00000000eFE302BEAA2b3e6e1b18d08D69a9012a";
  const usdc = "0x754704Bc059F8C67012fEd69BC8A327a5aafb603",
    market = "0x065C9d28E428A0db40191a54d33d5b7c71a9C394";
  const perplFactory = await deploy("SetsunaFactory", "SetsunaFactory", [
    exchange,
    ausd,
    1n,
  ]);
  const spotGateway = await deploy("SetsunaSpot", "SetsunaSpot", [
    market,
    usdc,
  ]);
  const manifest = {
    mode: "HOSTED_FORK_ONLY",
    syntheticFunding: true,
    forkChainId: 143,
    chainId: 31337,
    forkBlock: String(proofBlock),
    forkHash: proofHash,
    startBlock: String(receipt.blockNumber),
    vault: event.args.vault,
    gateway: event.args.gateway,
    neverland: event.args.neverlandAdapter,
    euler: event.args.eulerAdapter,
    perplFactory,
    spotGateway,
    ...(process.env.SETSUNA_DEMO_EXPLORER_URL
      ? { explorer: process.env.SETSUNA_DEMO_EXPLORER_URL }
      : {}),
  };
  if (values.unified) {
    const vaultDeployer = await deploy(
      "SetsunaUSDCV2Factory",
      "USDCV2VaultDeployer",
    );
    const usdcFactory = await deploy(
      "SetsunaUSDCV2Factory",
      "SetsunaUSDCV2Factory",
      [vaultDeployer],
    );
    const a = await artifact("SetsunaUSDCV2Factory");
    const entry = {
      operation: "createFiveProtocolVault",
      state: "pending",
      nonce: await client.getTransactionCount({
        address: owner,
        blockTag: "pending",
      }),
    };
    journal.operations.push(entry);
    await save();
    const { request } = await client.simulateContract({
      address: usdcFactory,
      abi: a.abi,
      functionName: "createFiveProtocolVault",
      account: owner,
    });
    entry.hash = await wallet.writeContract({
      ...request,
      nonce: entry.nonce,
      chain: null,
    });
    await save();
    const r = await client.waitForTransactionReceipt({
      hash: entry.hash,
      timeout: 60000,
    });
    if (r.status !== "success")
      throw new Error("USDC vault initialization failed");
    const created = r.logs
      .filter((l) => l.address.toLowerCase() === usdcFactory.toLowerCase())
      .flatMap((l) => {
        try {
          return [
            decodeEventLog({ abi: a.abi, data: l.data, topics: l.topics }),
          ];
        } catch {
          return [];
        }
      })
      .find((e) => e.eventName === "VaultCreated");
    if (!created || created.args.adapters.length !== 5)
      throw new Error("Five-protocol creation event missing");
    manifest.earnUSDC = {
      vault: created.args.vault,
      asset: usdc,
      adapters: created.args.adapters,
      forkBlock: String(proofBlock),
      startBlock: String(r.blockNumber),
    };
    await validateUSDCEarn(client, manifest.earnUSDC);
    manifest.usdcFactory = usdcFactory;
    manifest.usdcVaultDeployer = vaultDeployer;
    entry.state = "confirmed";
    await save();
  }
  const priceFixture = await demoTradingFixture({
    rpc,
    adminRPC,
    manifest,
    localAdmin: values["local-admin"],
    record: async (entry) => {
      if (!journal.operations.includes(entry)) journal.operations.push(entry);
      await save();
    },
  });
  manifest.perplFixture = await priceFixture.prepare();
  await writeFile(
    `${dir}/base-manifest.json`,
    JSON.stringify(manifest, null, 2) + "\n",
    { mode: 0o600 },
  );
  await new Promise((resolve, reject) => {
    const child = spawn(
      process.execPath,
      [
        new URL("deploy-demo-faucet.mjs", import.meta.url).pathname,
        "--manifest",
        `${dir}/base-manifest.json`,
        "--output",
        `${dir}/manifest.json`,
        "--execute",
        ...(values["local-admin"] ? ["--local-admin"] : []),
      ],
      { env: process.env, stdio: "inherit" },
    );
    child.once("error", reject);
    child.once("exit", (code) =>
      code === 0 ? resolve() : reject(new Error("Faucet setup incomplete")),
    );
  });
  if (values["local-admin"])
    await admin.request({
      method: "anvil_stopImpersonatingAccount",
      params: [owner],
    });
  console.log(
    JSON.stringify({
      mode: "HOSTED_FORK_ONLY",
      manifest: `${dir}/manifest.json`,
      keeperEnvironmentFile: `${dir}/keeper.env`,
      vault: manifest.vault,
      note: "Start the Earn executor and demo trading price worker. Perpl uses a disclosed fixed historical mark with synthetic funds.",
    }),
  );
}
main().catch((error) => {
  const reason = String(error.shortMessage ?? error.message)
    .replace(/https?:\/\/[^\s"'<>]+/g, "[RPC endpoint]")
    .slice(0, 500);
  console.error(
    `Hosted demo setup stopped: ${reason}. Inspect deployment-journal.json and onchain receipts before retrying.`,
  );
  process.exitCode = 1;
});
