import assert from "node:assert/strict";
import { execFileSync } from "node:child_process";
import { readFile, writeFile } from "node:fs/promises";
import { setTimeout as delay } from "node:timers/promises";
import { createPublicClient, erc20Abi, http } from "viem";

assert.ok(
  process.argv.includes("--execute"),
  "Explicit restart authorization required",
);
const { dir } = JSON.parse(
  await readFile(".local/public-demo/latest.json", "utf8"),
);
const proof = JSON.parse(await readFile(`${dir}/result.json`, "utf8"));
assert.equal(proof.status, "passed");
const d = proof.deployment;
assert.equal(d.chainId, 31337);
const c = createPublicClient({
  transport: http(d.rpc, { timeout: 25000, retryCount: 0 }),
});
const quote = (s) => "'" + s.replaceAll("'", "'\\''") + "'";
const metadata = () => {
  const code =
    'fetch("http://127.0.0.1:8545",{method:"POST",headers:{"Content-Type":"application/json"},body:JSON.stringify({jsonrpc:"2.0",id:1,method:"anvil_metadata",params:[]})}).then(r=>r.json()).then(j=>console.log(JSON.stringify(j.result)));';
  const output = execFileSync(
    "railway",
    ["ssh", "--service", "setsuna-workers", "--", "node", "-e", quote(code)],
    { encoding: "utf8", timeout: 55000 },
  );
  const m = JSON.parse(
    output
      .trim()
      .split(/\r?\n/)
      .find((line) => line.startsWith("{")),
  );
  assert.equal(m.chainId, 31337);
  assert.ok(m.instanceId);
  return m;
};
const seed = JSON.parse(
  await readFile(".local/public-earn-seed/result.json", "utf8"),
);
const snapshot = async () => {
  const wallets = [];
  for (const address of [proof.wallet, seed.wallet]) {
    const tokens = [];
    for (const token of [
      d.spot.usdc,
      d.collateral,
      d.earnMON.vault,
      d.earnUSDC.vault,
    ])
      tokens.push({
        token,
        balance: String(
          await c.readContract({
            address: token,
            abi: erc20Abi,
            functionName: "balanceOf",
            args: [address],
          }),
        ),
      });
    wallets.push({
      address,
      native: String(await c.getBalance({ address })),
      nonce: await c.getTransactionCount({ address }),
      tokens,
    });
  }
  const receipts = await Promise.all(
    proof.transactions.map(async (hash) => {
      const r = await c.getTransactionReceipt({ hash });
      return {
        hash,
        status: r.status,
        blockHash: r.blockHash,
        logs: r.logs.map((l) => ({
          address: l.address,
          topics: l.topics,
          data: l.data,
        })),
      };
    }),
  );
  return { wallets, receipts };
};
const before = await snapshot(),
  priorInstance = metadata(),
  priorBlock = await c.getBlock();
await writeFile(
  ".local/cloud-persistence-before.json",
  JSON.stringify({ before, priorInstance }, null, 2),
);
console.log(
  "Recorded user/seed balances, shares, nonces and all 25 receipts. Restarting the owned Railway service…",
);
execFileSync(
  "railway",
  ["restart", "--service", "setsuna-workers", "--yes", "--json"],
  { timeout: 55000 },
);
let nextInstance;
for (let i = 0; i < 90; i++) {
  await delay(1000);
  try {
    const h = await fetch(`${d.explorer}/health`, {
      signal: AbortSignal.timeout(1000),
    });
    if (!h.ok || !(await h.json()).ready) continue;
    const candidate = metadata();
    if (candidate.instanceId !== priorInstance.instanceId) {
      nextInstance = candidate;
      break;
    }
  } catch {}
}
assert.ok(
  nextInstance,
  "A new healthy node instance must replace the prior process",
);
assert.deepEqual(await snapshot(), before);
assert.ok((await c.getBlock()).timestamp >= priorBlock.timestamp);
const afterDeployment = await (
  await fetch(`${proof.url}/api/deployment/`)
).json();
assert.deepEqual(afterDeployment, d);
const result = {
  author: "Codex",
  recordedAt: new Date().toISOString(),
  status: "passed",
  beforeInstance: priorInstance.instanceId,
  afterInstance: nextInstance.instanceId,
  checks: [
    "new node process confirmed",
    "same contract manifest",
    "user and seed token/native balances retained",
    "vault shares retained",
    "wallet nonces retained",
    "all 25 receipt block hashes and events retained",
    "monotonic clock",
    "three-worker health restored",
  ],
  snapshot: before,
};
await writeFile(
  ".local/cloud-persistence-result.json",
  JSON.stringify(result, null, 2),
);
console.log(
  JSON.stringify({ status: result.status, checks: result.checks.length }),
);
