import { spawn } from "node:child_process";
import { createServer } from "node:net";
import { mkdir, open, readFile, writeFile } from "node:fs/promises";
import { setTimeout as delay } from "node:timers/promises";
import {
  createPublicClient,
  createWalletClient,
  http,
  defineChain,
  decodeEventLog,
  erc20Abi,
  parseEther,
  toHex,
} from "viem";
import { generatePrivateKey, privateKeyToAccount } from "viem/accounts";
import { json } from "./earn-keeper-core.mjs";

// Own a new loopback-only fork. No mutation is ever sent to the upstream.
const withCurvance = process.argv.includes("--curvance");
const port = withCurvance ? 18613 : 18612;
const rpc = `http://127.0.0.1:${port}`;
const forkBlock = withCurvance ? 111560409n : 111523095n,
  forkHash = withCurvance
    ? "0xc8a3dcf05b4b35daf91e0abc74bc91ebc2ec45830d93a8f2b6451cff8214a84b"
    : "0x404c09a41e4e601ddb38ecbb9ed758dfa91581b8420171847d257acd9c351573";
const upstream =
  process.env.MONAD_RPC_URL ?? "https://rpc-mainnet.monadinfra.com";
const dir = withCurvance ? ".local/setsusdc-five" : ".local/setsusdc";
const children = [];
let stop;
const stopped = new Promise((resolve) => (stop = resolve));
for (const signal of ["SIGINT", "SIGTERM"]) process.once(signal, stop);
await new Promise((resolve, reject) => {
  const s = createServer();
  s.once("error", () =>
    reject(new Error("USDC fork port occupied; existing process left alone")),
  );
  s.listen(port, "127.0.0.1", () => s.close(resolve));
});
const up = createPublicClient({
  transport: http(upstream, { timeout: 20000 }),
});
if (
  (await up.getChainId()) !== 143 ||
  (await up.getBlock({ blockNumber: forkBlock })).hash !== forkHash
)
  throw new Error("Upstream differs from reviewed source block");
await mkdir(dir, { recursive: true });
const log = await open(`${dir}/anvil.log`, "w");
const anvil = spawn(
  "anvil",
  [
    "--fork-url",
    upstream,
    "--fork-block-number",
    String(forkBlock),
    "--chain-id",
    "31337",
    "--port",
    String(port),
    "--host",
    "127.0.0.1",
    "--silent",
    "--gas-limit",
    "100000000",
    "--timestamp",
    withCurvance ? "1791447513" : "1791436247",
  ],
  { stdio: ["ignore", log.fd, log.fd] },
);
children.push(anvil);
const chain = defineChain({
  id: 31337,
  name: "Setsuna USDC local fork",
  nativeCurrency: { name: "MON", symbol: "MON", decimals: 18 },
  rpcUrls: { default: { http: [rpc] } },
});
const c = createPublicClient({
  chain,
  transport: http(rpc, { timeout: 30000, retryCount: 0 }),
});
const transactions = [];
const artifact = async (file, name = file) =>
  JSON.parse(await readFile(`contracts/out/${file}.sol/${name}.json`, "utf8"));
try {
  for (let i = 0; ; i++) {
    try {
      if ((await c.getChainId()) === 31337) break;
    } catch {}
    if (i === 80 || anvil.exitCode !== null)
      throw new Error("Owned fork failed to start");
    await delay(250);
  }
  await c.request({ method: "anvil_setBlockTimestampInterval", params: [1] });
  const [owner, seedOwner] = await c.request({ method: "eth_accounts" });
  const wallet = createWalletClient({
    chain,
    account: owner,
    transport: http(rpc),
  });
  const seed = createWalletClient({
    chain,
    account: seedOwner,
    transport: http(rpc),
  });
  async function receipt(hash, label) {
    const r = await c.waitForTransactionReceipt({ hash, timeout: 60000 });
    if (r.status !== "success") throw new Error(`${label} reverted`);
    transactions.push({
      label,
      hash,
      block: String(r.blockNumber),
      gas: String(r.gasUsed),
    });
    return r;
  }
  async function deploy(file, name, args = []) {
    const a = await artifact(file, name);
    if (
      (a.bytecode.object.length - 2) / 2 > 49152 ||
      (a.deployedBytecode.object.length - 2) / 2 > 24576
    )
      throw new Error("Contract size limit");
    return (
      await receipt(
        await wallet.deployContract({
          abi: a.abi,
          bytecode: a.bytecode.object,
          args,
          gas: 15000000n,
        }),
        name,
      )
    ).contractAddress;
  }
  async function send(w, address, abi, functionName, args = []) {
    await c.simulateContract({
      account: w.account,
      address,
      abi,
      functionName,
      args,
      gas: functionName.startsWith("create") ? 20000000n : 6000000n,
    });
    return receipt(
      await w.writeContract({
        address,
        abi,
        functionName,
        args,
        gas: functionName.startsWith("create") ? 20000000n : 6000000n,
      }),
      functionName,
    );
  }
  const holder = await deploy("SetsunaUSDCV2Factory", "USDCV2VaultDeployer");
  const factory = await deploy("SetsunaUSDCV2Factory", "SetsunaUSDCV2Factory", [
    holder,
  ]);
  const fa = (await artifact("SetsunaUSDCV2Factory")).abi;
  const created = await send(
    wallet,
    factory,
    fa,
    withCurvance ? "createFiveProtocolVault" : "createVault",
  );
  const event = created.logs
    .filter((l) => l.address.toLowerCase() === factory.toLowerCase())
    .map((l) => decodeEventLog({ abi: fa, data: l.data, topics: l.topics }))
    .find((e) => e.eventName === "VaultCreated");
  if (!event) throw new Error("Vault event missing");
  const vault = event.args.vault,
    adapters = event.args.adapters;
  const asset = "0x754704Bc059F8C67012fEd69BC8A327a5aafb603";
  const source = "0x35a73BAcb179d3740395A3ceCc87FF2e581d6042";
  // Synthetic funding on the owned fork; never impersonate an upstream account.
  await c.request({ method: "anvil_impersonateAccount", params: [source] });
  await c.request({
    method: "anvil_setBalance",
    params: [source, toHex(parseEther("10"))],
  });
  const funder = createWalletClient({
    chain,
    account: source,
    transport: http(rpc),
  });
  await send(funder, asset, erc20Abi, "transfer", [owner, 10000_000000n]);
  await send(funder, asset, erc20Abi, "transfer", [seedOwner, 1000_000000n]);
  await c.request({
    method: "anvil_stopImpersonatingAccount",
    params: [source],
  });
  const abi = (await artifact("SetsunaUSDCVault")).abi;
  await send(seed, asset, erc20Abi, "approve", [vault, 1000_000000n]);
  await send(seed, vault, abi, "deposit", [1000_000000n, seedOwner]);
  await send(wallet, vault, abi, "observeRates");
  async function advance() {
    const b = await c.getBlock();
    await c.request({
      method: "evm_setNextBlockTimestamp",
      params: [Number(b.timestamp) + 601],
    });
    await c.request({ method: "evm_mine", params: [] });
  }
  await advance();
  await send(wallet, vault, abi, "observeRates");
  for (let i = 0; i < 12; i++) {
    await advance();
    await send(wallet, vault, abi, "observeRates");
    await c.request({ method: "evm_mine", params: [] });
    const p = await c.readContract({
      address: vault,
      abi,
      functionName: "previewRebalance",
    });
    if (
      p.grossMovement > 0n &&
      (p.repairsLimits || p.annualIncomeAfter >= p.annualIncomeBefore + 1000n)
    )
      await send(wallet, vault, abi, "rebalance");
  }
  const manifest = {
    mode: "LOCAL_USDC_FORK_ONLY",
    syntheticFunding: true,
    chainId: 31337,
    forkHash,
    factory,
    vaultDeployer: holder,
    owner,
    seedOwner,
    earnUSDC: {
      vault,
      asset,
      adapters,
      forkBlock: String(forkBlock),
      startBlock: String(created.blockNumber),
    },
  };
  await writeFile(`${dir}/demo.json`, json(manifest));
  await writeFile(
    `${dir}/deployment-proof.json`,
    json({ manifest, transactions }),
  );
  const keeperKey = generatePrivateKey(),
    keeper = privateKeyToAccount(keeperKey).address;
  await c.request({
    method: "anvil_setBalance",
    params: [keeper, toHex(parseEther("100"))],
  });
  await writeFile(
    `${dir}/keeper.env`,
    `EARN_KEEPER_PRIVATE_KEY=${keeperKey}\n`,
    { mode: 0o600 },
  );
  await c.request({ method: "anvil_setBlockTimestampInterval", params: [2] });
  await c.request({ method: "evm_setIntervalMining", params: [2] });
  const keeperLog = await open(`${dir}/keeper.log`, "w");
  const worker = spawn(
    process.execPath,
    [
      "scripts/earn-keeper-watch.mjs",
      "--multi",
      "--asset",
      "USDC",
      "--vault",
      vault,
      "--rpc",
      rpc,
      "--demo-manifest",
      `${dir}/demo.json`,
      "--execute",
      "--max-gas-price-gwei",
      "1000",
      "--max-gas",
      "3000000",
      "--state-dir",
      `${dir}/executor`,
    ],
    {
      env: { ...process.env, EARN_KEEPER_PRIVATE_KEY: keeperKey },
      stdio: ["ignore", keeperLog.fd, keeperLog.fd],
    },
  );
  children.push(worker);
  await writeFile(
    `${dir}/services.json`,
    json({ anvil: anvil.pid, keeper: worker.pid, rpc }),
  );
  console.log(
    json({
      mode: manifest.mode,
      vault,
      adapters,
      sourceBlock: String(forkBlock),
      rpc,
      transactions: transactions.length,
    }),
  );
  console.log(
    withCurvance
      ? "Five-protocol USDC fork ready. Run npm run dev:usdc-five on port 3015."
      : "Four-protocol USDC fork ready. Run npm run dev:usdc on port 3014.",
  );
  await stopped;
} finally {
  for (const child of children) child.kill("SIGTERM");
  await log.close();
}
