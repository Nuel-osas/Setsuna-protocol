// Setsuna relayer: pays the gas for setsAUSD savers. An app (or the SDK) posts the saver's
// signature; the relayer simulates the call, submits it through SetsunaAUSDSaver and pays the MON.
// Value only ever reaches the signer: the saver contract enforces that, not this server.
// It can't be used for anything else: it builds every transaction itself and only ever calls
// SetsunaAUSDSaver.save or .withdraw, simulates first (a failing request costs nothing), and
// stops at a daily MON budget, a balance floor and a gas-price ceiling.
import { createServer } from "node:http";
import {
  createPublicClient,
  createWalletClient,
  defineChain,
  encodeFunctionData,
  fallback,
  formatEther,
  getAddress,
  http,
  isAddress,
  isHex,
  parseAbi,
  parseSignature,
} from "viem";
import { privateKeyToAccount } from "viem/accounts";

const SAVER = "0x4cbf5688cc98BCb76CcAB602AFc7b6fD57863cC3";
const WRAPPER = "0x551903E3687820A733FBe406DD33Fee8D12bd2F3";
const PORT = Number(process.env.PORT ?? 8080);
const MIN_SAVE = 1_000_000n; // 1 AUSD
const OPS_PER_OWNER_PER_DAY = Number(process.env.OPS_PER_OWNER_PER_DAY ?? 5);
const DAILY_BUDGET_WEI = BigInt(process.env.DAILY_BUDGET_WEI ?? 3n * 10n ** 18n); // 3 MON
const FLOOR_WEI = BigInt(process.env.FLOOR_WEI ?? 10n ** 18n); // stop below 1 MON
const REQUESTS_PER_IP_PER_HOUR = 30;
const MIN_WITHDRAW = 500_000n; // 0.5 AUSD, unless the whole position is leaving
const MAX_GAS_PRICE = BigInt(process.env.MAX_GAS_PRICE_WEI ?? 500n * 10n ** 9n); // 500 gwei

const key = process.env.SETSUNA_RELAYER_PRIVATE_KEY;
if (!key || !/^0x[0-9a-fA-F]{64}$/.test(key)) throw new Error("SETSUNA_RELAYER_PRIVATE_KEY is missing");
const account = privateKeyToAccount(key);
const monad = defineChain({
  id: 143,
  name: "Monad",
  nativeCurrency: { name: "Monad", symbol: "MON", decimals: 18 },
  rpcUrls: { default: { http: ["https://rpc2.monad.xyz"] } },
});
// RPC_URL overrides the endpoints for local fork tests only.
const transport = process.env.RPC_URL
  ? http(process.env.RPC_URL)
  : fallback(
      ["https://rpc2.monad.xyz", "https://rpc1.monad.xyz", "https://rpc.monad.xyz", "https://rpc3.monad.xyz"].map((u) =>
        http(u, { timeout: 15_000, retryCount: 1 }),
      ),
    );
const pub = createPublicClient({ chain: monad, transport });
const wallet = createWalletClient({ account, chain: monad, transport });

const saverAbi = parseAbi([
  "function save(address owner, uint256 value, uint256 validAfter, uint256 validBefore, bytes32 nonce, uint8 v, bytes32 r, bytes32 s, uint256 minShares) returns (uint256)",
  "function withdraw(address owner, uint256 shares, uint256 deadline, uint8 v, bytes32 r, bytes32 s, uint256 minAssets) returns (uint256)",
]);
const wrapperAbi = parseAbi([
  "function previewDeposit(uint256 assets) view returns (uint256)",
  "function previewRedeem(uint256 shares) view returns (uint256)",
  "function balanceOf(address) view returns (uint256)",
]);

/* ── limits, kept in memory: one process sends everything ── */
const day = () => new Date().toISOString().slice(0, 10);
let budget = { day: day(), spent: 0n };
const ownerOps = new Map(); // `${day}:${owner}` -> count
const ipHits = new Map(); // ip -> [timestamps]
function rateLimited(ip) {
  const now = Date.now();
  const hits = (ipHits.get(ip) ?? []).filter((t) => now - t < 3_600_000);
  hits.push(now);
  ipHits.set(ip, hits);
  return hits.length > REQUESTS_PER_IP_PER_HOUR;
}
function ownerAllowed(owner) {
  return (ownerOps.get(`${day()}:${owner}`) ?? 0) < OPS_PER_OWNER_PER_DAY;
}
function countOwner(owner) {
  const k = `${day()}:${owner}`;
  ownerOps.set(k, (ownerOps.get(k) ?? 0) + 1);
}
function budgetLeft() {
  if (budget.day !== day()) budget = { day: day(), spent: 0n };
  return DAILY_BUDGET_WEI - budget.spent;
}

/* ── one transaction at a time, so the relayer never races its own nonce ── */
let queue = Promise.resolve();
const serial = (fn) => (queue = queue.then(fn, fn));

async function submit(data) {
  const [balance, gasPrice] = await Promise.all([pub.getBalance({ address: account.address }), pub.getGasPrice()]);
  if (balance < FLOOR_WEI) throw Object.assign(new Error("Sponsored gas is paused right now. Try again later."), { status: 503 });
  if (gasPrice > MAX_GAS_PRICE) throw Object.assign(new Error("Monad gas is unusually expensive right now. Try again shortly."), { status: 503 });
  // Simulate first: a call that would revert costs Setsuna nothing.
  try {
    await pub.call({ account: account.address, to: SAVER, data });
  } catch (e) {
    const raw = `${e.shortMessage ?? ""} ${e.details ?? ""} ${e.message ?? ""}`;
    const reason = /0x1dbc01d4|used|0xd309466d/i.test(raw)
      ? "This signature has already been used."
      : /0x8baa579f|0x3c754a06|invalid signature|0xb0669cbc/i.test(raw)
        ? "The signature doesn't match this request, or it has expired."
        : /InsufficientOutput|0x/i.test(raw) && /balance|0xe450d38c|exceeds/i.test(raw)
          ? "The wallet doesn't hold enough for this."
          : "This request would fail on Monad, so it wasn't sent. Check the signature, amount and expiry.";
    throw Object.assign(new Error(reason), { status: 400 });
  }
  const gas = ((await pub.estimateGas({ account: account.address, to: SAVER, data })) * 12n) / 10n;
  const cost = gas * gasPrice; // Monad charges the gas limit
  if (cost > budgetLeft()) throw Object.assign(new Error("Today's sponsored gas budget is used up. Try again tomorrow."), { status: 503 });
  const hash = await wallet.sendTransaction({ to: SAVER, data, gas });
  budget.spent += cost;
  const receipt = await pub.waitForTransactionReceipt({ hash, timeout: 60_000 });
  if (receipt.status !== "success") throw Object.assign(new Error(`Transaction reverted: ${hash}`), { status: 502 });
  return { txHash: hash, block: String(receipt.blockNumber), gasPaidMON: formatEther(cost) };
}

const big = (v, name) => {
  if (typeof v !== "string" || !/^\d+$/.test(v)) throw Object.assign(new Error(`${name} must be an integer string`), { status: 400 });
  return BigInt(v);
};
const addr = (v, name) => {
  if (typeof v !== "string" || !isAddress(v)) throw Object.assign(new Error(`${name} must be an address`), { status: 400 });
  return getAddress(v);
};
const sig = (v) => {
  if (typeof v !== "string" || !isHex(v) || v.length !== 132) throw Object.assign(new Error("signature must be a 65-byte hex string"), { status: 400 });
  const { r, s, v: vv, yParity } = parseSignature(v);
  return { r, s, v: Number(vv ?? BigInt(yParity + 27)) };
};

async function save(body) {
  const owner = addr(body.owner, "owner");
  const value = big(body.value, "value");
  const validAfter = big(body.validAfter ?? "0", "validAfter");
  const validBefore = big(body.validBefore, "validBefore");
  if (typeof body.nonce !== "string" || !/^0x[0-9a-fA-F]{64}$/.test(body.nonce)) throw Object.assign(new Error("nonce must be 32 bytes of hex"), { status: 400 });
  if (value < MIN_SAVE) throw Object.assign(new Error("Sponsored saves start at 1 AUSD."), { status: 400 });
  if (!ownerAllowed(owner)) throw Object.assign(new Error("This wallet has used today's sponsored moves. Try again tomorrow."), { status: 429 });
  const { v, r, s } = sig(body.signature);
  const preview = await pub.readContract({ address: WRAPPER, abi: wrapperAbi, functionName: "previewDeposit", args: [value] });
  const minShares = body.minShares ? big(body.minShares, "minShares") : preview - preview / 1000n;
  const data = encodeFunctionData({ abi: saverAbi, functionName: "save", args: [owner, value, validAfter, validBefore, body.nonce, v, r, s, minShares] });
  const out = await serial(() => submit(data));
  countOwner(owner);
  return out;
}

async function withdraw(body) {
  const owner = addr(body.owner, "owner");
  const shares = big(body.shares, "shares");
  const deadline = big(body.deadline, "deadline");
  if (shares === 0n) throw Object.assign(new Error("shares must be more than zero"), { status: 400 });
  // Withdrawals are always sponsored within the per-wallet limit: nobody gets stuck.
  if (!ownerAllowed(owner)) throw Object.assign(new Error("This wallet has used today's sponsored moves. Try again tomorrow."), { status: 429 });
  const { v, r, s } = sig(body.signature);
  const [quote, held] = await Promise.all([
    pub.readContract({ address: WRAPPER, abi: wrapperAbi, functionName: "previewRedeem", args: [shares] }),
    pub.readContract({ address: WRAPPER, abi: wrapperAbi, functionName: "balanceOf", args: [owner] }),
  ]);
  if (quote < MIN_WITHDRAW && shares !== held)
    throw Object.assign(new Error("Sponsored withdrawals start at 0.5 AUSD, or withdraw everything."), { status: 400 });
  const minAssets = body.minAssets ? big(body.minAssets, "minAssets") : quote - quote / 1000n;
  const data = encodeFunctionData({ abi: saverAbi, functionName: "withdraw", args: [owner, shares, deadline, v, r, s, minAssets] });
  const out = await serial(() => submit(data));
  countOwner(owner);
  return out;
}

const cors = {
  "access-control-allow-origin": "*",
  "access-control-allow-methods": "GET, POST, OPTIONS",
  "access-control-allow-headers": "content-type",
};
function send(res, status, body) {
  res.writeHead(status, { "content-type": "application/json", ...cors });
  res.end(JSON.stringify(body));
}

createServer(async (req, res) => {
  const url = new URL(req.url, "http://relay");
  const ip = String(req.headers["x-forwarded-for"] ?? req.socket.remoteAddress ?? "").split(",")[0].trim();
  if (req.method === "OPTIONS") return send(res, 204, {});
  if (req.method === "GET" && (url.pathname === "/" || url.pathname === "/health")) {
    const balance = await pub.getBalance({ address: account.address }).catch(() => undefined);
    return send(res, 200, {
      service: "setsuna-relayer",
      relayer: account.address,
      saver: SAVER,
      setsAUSD: WRAPPER,
      balanceMON: balance === undefined ? null : formatEther(balance),
      sponsoring: balance !== undefined && balance >= FLOOR_WEI && budgetLeft() > 0n,
      budgetLeftTodayMON: formatEther(budgetLeft()),
      limits: { minSaveAUSD: 1, opsPerWalletPerDay: OPS_PER_OWNER_PER_DAY },
      endpoints: ["POST /v1/ausd/save", "POST /v1/ausd/withdraw"],
    });
  }
  if (req.method !== "POST" || !["/v1/ausd/save", "/v1/ausd/withdraw"].includes(url.pathname))
    return send(res, 404, { error: "not found" });
  if (rateLimited(ip)) return send(res, 429, { error: "Too many requests. Try again later." });
  let body;
  try {
    const chunks = [];
    let size = 0;
    for await (const c of req) {
      size += c.length;
      if (size > 4096) throw Object.assign(new Error("body too large"), { status: 413 });
      chunks.push(c);
    }
    body = JSON.parse(Buffer.concat(chunks).toString("utf8"));
  } catch (e) {
    return send(res, e.status ?? 400, { error: e.status ? e.message : "body must be JSON" });
  }
  try {
    const out = url.pathname.endsWith("/save") ? await save(body) : await withdraw(body);
    console.log(JSON.stringify({ at: new Date().toISOString(), op: url.pathname, owner: body.owner, tx: out.txHash, gas: out.gasPaidMON }));
    return send(res, 200, out);
  } catch (e) {
    const status = e.status ?? 400;
    // Simulation failures mean the signature or the request is wrong; nothing was spent.
    const message = e.status ? e.message : (e.shortMessage ?? e.message ?? "Request failed").split("\n")[0];
    console.log(JSON.stringify({ at: new Date().toISOString(), op: url.pathname, owner: body?.owner, error: message.slice(0, 160) }));
    return send(res, status, { error: message });
  }
}).listen(PORT, () => console.log(`setsuna-relayer on :${PORT} as ${account.address}`));
