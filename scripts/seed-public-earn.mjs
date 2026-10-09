import assert from "node:assert/strict";
import { mkdir, readFile, writeFile } from "node:fs/promises";
import {
  createPublicClient,
  createWalletClient,
  defineChain,
  erc20Abi,
  http,
  parseAbi,
  parseEther,
} from "viem";
import { generatePrivateKey, privateKeyToAccount } from "viem/accounts";

// A disclosed synthetic demonstration deposit, never mainnet capital or user traction.
assert.ok(process.argv.includes("--execute"), "Explicit --execute required");
const base = "https://setsuna-metropolis.vercel.app";
const d = await (await fetch(`${base}/api/deployment/`)).json();
assert.equal(d.mode, "demo");
assert.equal(d.chainId, 31337);
assert.equal(d.rpc, `${base}/api/rpc/`);
const c = createPublicClient({
  transport: http(d.rpc, { timeout: 25000, retryCount: 0 }),
});
assert.equal(await c.getChainId(), 31337);
const dir = ".local/public-earn-seed";
const resume = process.argv.includes("--resume");
if (!resume) await mkdir(dir, { mode: 0o700 });
const key = resume
    ? JSON.parse(await readFile(`${dir}/wallet.json`, "utf8")).privateKey
    : generatePrivateKey(),
  account = privateKeyToAccount(key);
if (!resume)
  await writeFile(
    `${dir}/wallet.json`,
    JSON.stringify({ privateKey: key, address: account.address }),
    { mode: 0o600 },
  );
const chain = defineChain({
  id: 31337,
  name: "Setsuna demo",
  nativeCurrency: { name: "MON", symbol: "MON", decimals: 18 },
  rpcUrls: { default: { http: [d.rpc] } },
});
const w = createWalletClient({
  account,
  chain,
  transport: http(d.rpc, { timeout: 25000, retryCount: 0 }),
});
const evidence = resume
  ? JSON.parse(await readFile(`${dir}/result.json`, "utf8"))
  : {
      author: "Codex",
      environment: "Public synthetic-fund demo",
      wallet: account.address,
      deployment: d,
      transactions: [],
      depositedMON: "10",
      depositedUSDC: "100",
      purpose:
        "Demonstrate natural-time keeper allocation; not customer deposits or traction",
    };
assert.equal(evidence.wallet, account.address);
assert.equal(evidence.deployment.earnMON.vault, d.earnMON.vault);
assert.equal(evidence.deployment.earnUSDC.vault, d.earnUSDC.vault);
const save = () =>
  writeFile(`${dir}/result.json`, JSON.stringify(evidence, null, 2));
const settled = async (hash, operation) => {
  evidence.transactions.push({ hash, operation, status: "pending" });
  await save();
  const status = (await c.waitForTransactionReceipt({ hash, timeout: 60000 }))
    .status;
  evidence.transactions.at(-1).status =
    status === "success" ? "confirmed" : "reverted";
  await save();
  assert.equal(status, "success");
};
for (const tx of evidence.transactions.filter(
  (tx) => tx.status === "pending",
)) {
  const receipt = await c.getTransactionReceipt({ hash: tx.hash });
  tx.status = receipt.status === "success" ? "confirmed" : "reverted";
}
const done = (operation) =>
  evidence.transactions.some(
    (tx) => tx.operation === operation && tx.status === "confirmed",
  );
await save();
if (!done("claim synthetic funds")) {
  const claimResponse = await fetch(`${base}/api/demo/fund/`, {
    method: "POST",
    headers: { "Content-Type": "application/json", Origin: base },
    body: JSON.stringify({ address: account.address }),
  });
  const claim = await claimResponse.json();
  assert.equal(claim.funded, true);
  await settled(claim.hash, "claim synthetic funds");
}
const gatewayABI = parseAbi([
  "function depositMON(address receiver,uint256 minShares,uint256 deadline) payable returns(uint256)",
]);
const block = await c.getBlock();
if (!done("deposit 10 MON"))
  await settled(
    await w.writeContract({
      address: d.earnMON.gateway,
      abi: gatewayABI,
      functionName: "depositMON",
      args: [account.address, 1n, block.timestamp + 120n],
      value: parseEther("10"),
      gas: 1000000n,
    }),
    "deposit 10 MON",
  );
if (!done("approve exactly 100 USDC"))
  await settled(
    await w.writeContract({
      address: d.earnUSDC.asset,
      abi: erc20Abi,
      functionName: "approve",
      args: [d.earnUSDC.vault, 100000000n],
      gas: 100000n,
    }),
    "approve exactly 100 USDC",
  );
if (!done("deposit 100 USDC"))
  await settled(
    await w.writeContract({
      address: d.earnUSDC.vault,
      abi: parseAbi(["function deposit(uint256,address) returns(uint256)"]),
      functionName: "deposit",
      args: [100000000n, account.address],
      gas: 1500000n,
    }),
    "deposit 100 USDC",
  );
evidence.recordedAt = new Date().toISOString();
await save();
console.log(
  JSON.stringify({
    wallet: account.address,
    transactions: evidence.transactions,
    dir,
  }),
);
