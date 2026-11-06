// POST /api/bridge-report {sourceDomain, burnTx, app?}: bridge.setsuna.finance and Setsuna's relayer
// report a mainnet burn once Circle has attested it. Public, so nothing from the request is trusted:
// the amount, chains and wallets come from Circle's record of that burn (and, for a sponsored burn,
// the signer from the sponsor contract's event on Monad), and a repeat report changes nothing.
// `app` only labels a sponsored transfer (e.g. "kova").
import { createPublicClient, http } from "viem";
import { db, ready } from "../lib/db.js";
import { DOMAINS, SPONSOR, irisTransfer, saveTransfer, sponsoredOwner } from "../lib/bridge.js";

const monad = createPublicClient({ transport: http(process.env.MONAD_RPC_URL ?? "https://rpc2.monad.xyz", { timeout: 10_000 }) });

const ORIGIN = "https://bridge.setsuna.finance";
const cors = { "Access-Control-Allow-Origin": ORIGIN, "Access-Control-Allow-Methods": "POST, OPTIONS", "Access-Control-Allow-Headers": "content-type", Vary: "Origin" };
const reply = (status, body) => Response.json(body, { status, headers: { ...cors, "Cache-Control": "no-store" } });

// Per-instance throttle; enough to stop a loop, not a substitute for verification.
const hits = new Map();
function throttled(ip) {
  const now = Date.now();
  const recent = (hits.get(ip) ?? []).filter((t) => now - t < 60_000);
  recent.push(now);
  hits.set(ip, recent);
  return recent.length > 30;
}

export function OPTIONS() {
  return new Response(null, { status: 204, headers: cors });
}

export async function POST(request) {
  if (throttled(request.headers.get("x-forwarded-for")?.split(",")[0]?.trim() ?? "unknown")) return reply(429, { error: "Too many reports." });
  const body = await request.json().catch(() => null);
  const sourceDomain = Number(body?.sourceDomain);
  const burnTx = String(body?.burnTx ?? "");
  const app = typeof body?.app === "string" && /^[a-z0-9-]{1,24}$/.test(body.app) ? body.app : null;
  if (!(sourceDomain in DOMAINS) || !/^(0x[0-9a-fA-F]{64}|[1-9A-HJ-NP-Za-km-z]{32,90})$/.test(burnTx)) return reply(400, { error: "Unrecognised transfer." });
  const sql = db();
  if (!sql) return reply(503, { error: "Not configured." });
  try {
    const t = await irisTransfer(sourceDomain, burnTx);
    if (!t) return reply(404, { error: "Circle has no record of this burn yet." });
    let origin = "app";
    if (t.sourceDomain === 15 && t.sender === SPONSOR) {
      const owner = await sponsoredOwner(monad, burnTx).catch(() => null);
      if (!owner) return reply(502, { error: "Could not read who signed this sponsored transfer yet." });
      t.sender = owner;
      origin = app ? `sponsored:${app}` : "sponsored";
    }
    await ready(sql);
    await saveTransfer(sql, burnTx, t, new Date(), origin);
    return reply(200, { ok: true });
  } catch {
    return reply(502, { error: "Could not record the transfer." });
  }
}
