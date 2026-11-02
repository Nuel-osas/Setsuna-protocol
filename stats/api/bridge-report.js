// POST /api/bridge-report {sourceDomain, burnTx}: bridge.setsuna.finance reports a mainnet burn once
// Circle has attested it. Public, so nothing from the request is trusted: the amount, chains and
// wallets come from Circle's record of that burn, and a repeat report changes nothing.
import { db, ready } from "../lib/db.js";
import { DOMAINS, irisTransfer, saveTransfer } from "../lib/bridge.js";

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
  if (!(sourceDomain in DOMAINS) || !/^(0x[0-9a-fA-F]{64}|[1-9A-HJ-NP-Za-km-z]{32,90})$/.test(burnTx)) return reply(400, { error: "Unrecognised transfer." });
  const sql = db();
  if (!sql) return reply(503, { error: "Not configured." });
  try {
    const t = await irisTransfer(sourceDomain, burnTx);
    if (!t) return reply(404, { error: "Circle has no record of this burn yet." });
    await ready(sql);
    await saveTransfer(sql, burnTx, t, new Date(), "app");
    return reply(200, { ok: true });
  } catch {
    return reply(502, { error: "Could not record the transfer." });
  }
}
