// Setsuna relayer: pays the MON for setsAUSD savers and for sponsored bridges out of Monad. An app
// (or the SDK) posts the user's signature; the relayer simulates the call, submits it through
// SetsunaAUSDSaver or SetsunaBridgeSponsor and pays the gas. Value only ever goes where the user
// signed: the contracts enforce that, not this server.
// It can't be used for anything else: it builds every transaction itself and only ever calls
// SetsunaAUSDSaver.save / .withdraw or SetsunaBridgeSponsor.bridgeUSDC / .bridgeAUSD, simulates
// first (a failing request costs nothing), and stops at a daily MON budget per purpose, a balance
// floor and a gas-price ceiling.
import { createServer } from "node:http";
import {
  createPublicClient,
  createWalletClient,
  decodeEventLog,
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
// Sponsored bridging out of Monad: USDC, or AUSD swapped to USDC, burned through Circle CCTP V2.
const SPONSOR = "0xeabF1Aa629a686C9E5862b316F954bF2C0b68DBe";
const USDC = "0x754704Bc059F8C67012fEd69BC8A327a5aafb603";
const MONAD_DOMAIN = 15;
const MIN_BRIDGE = 1_000_000n; // 1 USDC or AUSD
const BRIDGES_PER_OWNER_PER_DAY = Number(process.env.BRIDGES_PER_OWNER_PER_DAY ?? 10);
const BRIDGE_DAILY_BUDGET_WEI = BigInt(process.env.BRIDGE_DAILY_BUDGET_WEI ?? 3n * 10n ** 18n); // 3 MON, ~50 bridges
const STATS_REPORT_URL = process.env.STATS_REPORT_URL ?? "https://stats.setsuna.finance/api/bridge-report";

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
const AUSD = "0x00000000eFE302BEAA2b3e6e1b18d08D69a9012a";
const TRANSFER =
  "(address owner,uint256 value,uint256 validAfter,uint256 validBefore,bytes32 salt,uint32 destinationDomain,bytes32 mintRecipient,uint256 maxFee,uint32 minFinalityThreshold,bool forward,uint256 minUsdcOut)";
const sponsorAbi = parseAbi([
  `function bridgeUSDC(${TRANSFER} t, uint8 v, bytes32 r, bytes32 s) returns (uint256)`,
  `function bridgeAUSD(${TRANSFER} t, uint8 v, bytes32 r, bytes32 s) returns (uint256)`,
  "event Bridged(address indexed owner, address indexed token, uint256 value, uint256 burned, uint32 indexed destinationDomain, bytes32 mintRecipient, uint256 maxFee, bool forward, address relayer)",
]);
const fmt6 = (v) => (Number(v) / 1e6).toLocaleString("en-US", { maximumFractionDigits: 6 });
const wrapperAbi = parseAbi([
  "function previewDeposit(uint256 assets) view returns (uint256)",
  "function previewRedeem(uint256 shares) view returns (uint256)",
  "function balanceOf(address) view returns (uint256)",
]);

/* ── limits, kept in memory: one process sends everything ── */
const day = () => new Date().toISOString().slice(0, 10);
const BUDGETS = { ausd: DAILY_BUDGET_WEI, bridge: BRIDGE_DAILY_BUDGET_WEI };
const PER_OWNER = { ausd: OPS_PER_OWNER_PER_DAY, bridge: BRIDGES_PER_OWNER_PER_DAY };
const spent = { ausd: { day: day(), wei: 0n }, bridge: { day: day(), wei: 0n } };
const ownerOps = new Map(); // `${day}:${kind}:${owner}` -> count
const ipHits = new Map(); // ip -> [timestamps]
function rateLimited(ip) {
  const now = Date.now();
  const hits = (ipHits.get(ip) ?? []).filter((t) => now - t < 3_600_000);
  hits.push(now);
  ipHits.set(ip, hits);
  return hits.length > REQUESTS_PER_IP_PER_HOUR;
}
function ownerAllowed(owner, kind = "ausd") {
  return (ownerOps.get(`${day()}:${kind}:${owner}`) ?? 0) < PER_OWNER[kind];
}
function countOwner(owner, kind = "ausd") {
  const k = `${day()}:${kind}:${owner}`;
  ownerOps.set(k, (ownerOps.get(k) ?? 0) + 1);
}
function budgetLeft(kind = "ausd") {
  if (spent[kind].day !== day()) spent[kind] = { day: day(), wei: 0n };
  return BUDGETS[kind] - spent[kind].wei;
}

/* ── one transaction at a time, so the relayer never races its own nonce ── */
let queue = Promise.resolve();
const serial = (fn) => (queue = queue.then(fn, fn));

async function submit(data, to = SAVER, kind = "ausd") {
  const [balance, gasPrice] = await Promise.all([pub.getBalance({ address: account.address }), pub.getGasPrice()]);
  if (balance < FLOOR_WEI) throw Object.assign(new Error("Sponsored gas is paused right now. Try again later."), { status: 503 });
  if (gasPrice > MAX_GAS_PRICE) throw Object.assign(new Error("Monad gas is unusually expensive right now. Try again shortly."), { status: 503 });
  // Simulate first: a call that would revert costs Setsuna nothing.
  try {
    await pub.call({ account: account.address, to, data });
  } catch (e) {
    const raw = `${e.shortMessage ?? ""} ${e.details ?? ""} ${e.message ?? ""}`;
    const reason = /0x1dbc01d4|used|0xd309466d/i.test(raw)
      ? "This signature has already been used."
      : /0x8baa579f|0x3c754a06|invalid signature|0xb0669cbc/i.test(raw)
        ? "The signature doesn't match this request, or it has expired."
        : /InsufficientOutput|0x/i.test(raw) && /balance|0xe450d38c|exceeds/i.test(raw)
          ? "The wallet doesn't hold enough for this."
          : /0x2f352531/i.test(raw)
            ? "The transfer details are invalid: check the recipient and the swap minimum."
            : /fewer coins|Exchange resulted/i.test(raw)
              ? "The AUSD swap would return less than the signed minimum. Get a fresh quote."
              : /max fee|maxFee/i.test(raw)
                ? "The fee ceiling must be below the amount that reaches Circle."
                : "This request would fail on Monad, so it wasn't sent. Check the signature, amount and expiry.";
    throw Object.assign(new Error(reason), { status: 400 });
  }
  const gas = ((await pub.estimateGas({ account: account.address, to, data })) * 12n) / 10n;
  const cost = gas * gasPrice; // Monad charges the gas limit
  if (cost > budgetLeft(kind)) throw Object.assign(new Error("Today's sponsored gas budget is used up. Try again tomorrow."), { status: 503 });
  const hash = await wallet.sendTransaction({ to, data, gas });
  spent[kind].wei += cost;
  const receipt = await pub.waitForTransactionReceipt({ hash, timeout: 60_000 });
  if (receipt.status !== "success") throw Object.assign(new Error(`Transaction reverted: ${hash}`), { status: 502 });
  return { txHash: hash, block: String(receipt.blockNumber), gasPaidMON: formatEther(cost), logs: receipt.logs };
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
  // Say plainly when the wallet can't cover the save, before simulating.
  const held = await pub.readContract({ address: AUSD, abi: wrapperAbi, functionName: "balanceOf", args: [owner] });
  if (held < value)
    throw Object.assign(new Error(`This wallet holds ${fmt6(held)} AUSD, less than the ${fmt6(value)} AUSD it's trying to save.`), { status: 400 });
  const preview = await pub.readContract({ address: WRAPPER, abi: wrapperAbi, functionName: "previewDeposit", args: [value] });
  const minShares = body.minShares ? big(body.minShares, "minShares") : preview - preview / 1000n;
  const data = encodeFunctionData({ abi: saverAbi, functionName: "save", args: [owner, value, validAfter, validBefore, body.nonce, v, r, s, minShares] });
  const { logs, ...out } = await serial(() => submit(data));
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
  if (shares > held)
    throw Object.assign(new Error(`This wallet holds ${(Number(held) / 1e12).toLocaleString("en-US", { maximumFractionDigits: 6 })} setsAUSD, less than it's trying to withdraw.`), { status: 400 });
  if (quote < MIN_WITHDRAW && shares !== held)
    throw Object.assign(new Error("Sponsored withdrawals start at 0.5 AUSD, or withdraw everything."), { status: 400 });
  const minAssets = body.minAssets ? big(body.minAssets, "minAssets") : quote - quote / 1000n;
  const data = encodeFunctionData({ abi: saverAbi, functionName: "withdraw", args: [owner, shares, deadline, v, r, s, minAssets] });
  const { logs, ...out } = await serial(() => submit(data));
  countOwner(owner);
  return out;
}

/* ── sponsored bridging out of Monad ── */

const hex32 = (v, name) => {
  if (typeof v !== "string" || !/^0x[0-9a-fA-F]{64}$/.test(v)) throw Object.assign(new Error(`${name} must be 32 bytes of hex`), { status: 400 });
  return v;
};
const appLabel = (v) => (typeof v === "string" && /^[a-z0-9-]{1,24}$/.test(v) ? v : undefined);

/** Circle's forwarding fee from Monad to `domain`, in USDC base units, or null if it doesn't deliver there. */
async function forwardFee(domain) {
  try {
    const res = await fetch(`https://iris-api.circle.com/v2/burn/USDC/fees/${MONAD_DOMAIN}/${domain}?forward=true`, { signal: AbortSignal.timeout(8_000) });
    if (!res.ok) return null;
    const quotes = await res.json();
    const q = Array.isArray(quotes) ? (quotes.find((x) => x.finalityThreshold === 2000) ?? quotes[0]) : null;
    return q?.forwardFee?.med == null ? null : BigInt(Math.ceil(q.forwardFee.med));
  } catch {
    return null;
  }
}

/** Records the burn on stats.setsuna.finance once Circle has it; retries for ~10 minutes. */
function report(burnTx, app) {
  let tries = 0;
  const attempt = async () => {
    tries++;
    try {
      const res = await fetch(STATS_REPORT_URL, {
        method: "POST",
        headers: { "content-type": "application/json" },
        body: JSON.stringify({ sourceDomain: MONAD_DOMAIN, burnTx, app }),
        signal: AbortSignal.timeout(10_000),
      });
      if (res.ok || (res.status !== 404 && res.status < 500)) {
        console.log(JSON.stringify({ at: new Date().toISOString(), op: "stats-report", tx: burnTx, status: res.status }));
        return;
      }
    } catch {}
    if (tries < 20) setTimeout(attempt, 30_000);
  };
  setTimeout(attempt, 5_000);
}

async function bridge(body) {
  const token = body.token;
  if (token !== "USDC" && token !== "AUSD") throw Object.assign(new Error('token must be "USDC" or "AUSD"'), { status: 400 });
  const t = body.transfer ?? {};
  const transfer = {
    owner: addr(t.owner, "transfer.owner"),
    value: big(t.value, "transfer.value"),
    validAfter: big(t.validAfter ?? "0", "transfer.validAfter"),
    validBefore: big(t.validBefore, "transfer.validBefore"),
    salt: hex32(t.salt, "transfer.salt"),
    destinationDomain: Number(t.destinationDomain),
    mintRecipient: hex32(t.mintRecipient, "transfer.mintRecipient"),
    maxFee: big(t.maxFee, "transfer.maxFee"),
    minFinalityThreshold: Number(t.minFinalityThreshold ?? 2000),
    forward: t.forward === true,
    minUsdcOut: big(t.minUsdcOut ?? "0", "transfer.minUsdcOut"),
  };
  const d = transfer.destinationDomain;
  if (!Number.isInteger(d) || d < 0 || d > 0xffffffff || d === MONAD_DOMAIN)
    throw Object.assign(new Error("transfer.destinationDomain must be another chain's CCTP domain"), { status: 400 });
  if (![1000, 2000].includes(transfer.minFinalityThreshold)) throw Object.assign(new Error("transfer.minFinalityThreshold must be 1000 or 2000"), { status: 400 });
  if (/^0x0{64}$/.test(transfer.mintRecipient)) throw Object.assign(new Error("transfer.mintRecipient is empty"), { status: 400 });
  if (transfer.value < MIN_BRIDGE) throw Object.assign(new Error("Sponsored bridges start at 1 USDC or AUSD."), { status: 400 });
  if (token === "USDC" && transfer.minUsdcOut !== 0n) throw Object.assign(new Error("transfer.minUsdcOut must be 0 for USDC"), { status: 400 });
  // Least that reaches Circle: the amount itself, or the AUSD swap's floor.
  const floor = (transfer.value * 9_980n) / 10_000n;
  const reaching = token === "AUSD" ? (transfer.minUsdcOut > floor ? transfer.minUsdcOut : floor) : transfer.value;
  if (transfer.maxFee >= reaching) throw Object.assign(new Error("The fee ceiling must be below the amount that reaches Circle."), { status: 400 });
  if (transfer.forward) {
    const fee = await forwardFee(d);
    if (fee === null)
      throw Object.assign(new Error("Circle doesn't deliver to that chain. Send with forward: false; the recipient then claims there with their own gas."), { status: 400 });
    // Circle charges the whole ceiling and its fee drifts by a few percent between quote and send:
    // allow a ceiling up to 5% under today's fee (quotes carry a 5% margin).
    if (transfer.maxFee * 100n < fee * 95n)
      throw Object.assign(new Error(`The fee ceiling is below Circle's delivery fee (${fmt6(fee)} USDC). Get a fresh quote.`), { status: 400 });
    // Circle keeps the whole ceiling, so a stale or mistyped one would overcharge the user.
    if (transfer.maxFee > fee * 2n + 50_000n)
      throw Object.assign(new Error(`The fee ceiling is far above Circle's delivery fee (${fmt6(fee)} USDC), and Circle keeps all of it. Get a fresh quote.`), { status: 400 });
  }
  if (!ownerAllowed(transfer.owner, "bridge")) throw Object.assign(new Error("This wallet has used today's sponsored bridges. Try again tomorrow."), { status: 429 });
  const { v, r, s } = sig(body.signature);
  const held = await pub.readContract({ address: token === "AUSD" ? AUSD : USDC, abi: wrapperAbi, functionName: "balanceOf", args: [transfer.owner] });
  if (held < transfer.value)
    throw Object.assign(new Error(`This wallet holds ${fmt6(held)} ${token}, less than the ${fmt6(transfer.value)} ${token} it's trying to bridge.`), { status: 400 });
  const data = encodeFunctionData({ abi: sponsorAbi, functionName: token === "AUSD" ? "bridgeAUSD" : "bridgeUSDC", args: [transfer, v, r, s] });
  const { logs, ...out } = await serial(() => submit(data, SPONSOR, "bridge"));
  countOwner(transfer.owner, "bridge");
  let burned = null;
  for (const log of logs) {
    if (log.address.toLowerCase() !== SPONSOR.toLowerCase()) continue;
    try {
      const ev = decodeEventLog({ abi: sponsorAbi, data: log.data, topics: log.topics });
      if (ev.eventName === "Bridged") burned = ev.args.burned.toString();
    } catch {}
  }
  report(out.txHash, appLabel(body.app));
  return { ...out, burned, destinationDomain: d, sourceDomain: MONAD_DOMAIN };
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
      bridgeSponsor: SPONSOR,
      sponsoring: balance !== undefined && balance >= FLOOR_WEI && budgetLeft() > 0n,
      bridging: balance !== undefined && balance >= FLOOR_WEI && budgetLeft("bridge") > 0n,
      budgetLeftTodayMON: formatEther(budgetLeft()),
      bridgeBudgetLeftTodayMON: formatEther(budgetLeft("bridge")),
      limits: { minSaveAUSD: 1, opsPerWalletPerDay: OPS_PER_OWNER_PER_DAY, minBridge: 1, bridgesPerWalletPerDay: BRIDGES_PER_OWNER_PER_DAY },
      endpoints: ["POST /v1/ausd/save", "POST /v1/ausd/withdraw", "POST /v1/bridge"],
    });
  }
  if (req.method !== "POST" || !["/v1/ausd/save", "/v1/ausd/withdraw", "/v1/bridge"].includes(url.pathname))
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
    const out = url.pathname === "/v1/bridge" ? await bridge(body) : url.pathname.endsWith("/save") ? await save(body) : await withdraw(body);
    console.log(JSON.stringify({ at: new Date().toISOString(), op: url.pathname, owner: body.owner ?? body.transfer?.owner, tx: out.txHash, gas: out.gasPaidMON }));
    return send(res, 200, out);
  } catch (e) {
    const status = e.status ?? 400;
    // Simulation failures mean the signature or the request is wrong; nothing was spent.
    const message = e.status ? e.message : (e.shortMessage ?? e.message ?? "Request failed").split("\n")[0];
    console.log(JSON.stringify({ at: new Date().toISOString(), op: url.pathname, owner: body?.owner ?? body?.transfer?.owner, error: message.slice(0, 160) }));
    return send(res, status, { error: message });
  }
}).listen(PORT, () => console.log(`setsuna-relayer on :${PORT} as ${account.address}`));
