// GET /api/bridge-transfers?keys=0x…,0x…: the recorded Setsuna Bridge transfers sent from or to these
// wallets, newest first, so bridge.setsuna.finance can show a wallet its transfers on any device and
// resume one that stopped. Public by design: every field is already public on-chain (Circle's record
// of each burn). Keys are EVM addresses, or the 32-byte hex form of Sui, Aptos and Solana accounts
// (for Solana, the wallet and its USDC token account, which is where Circle mints).
import { db, ready } from "../lib/db.js";
import { normal } from "../lib/bridge.js";

const ORIGIN = "https://bridge.setsuna.finance";
const cors = { "Access-Control-Allow-Origin": ORIGIN, "Access-Control-Allow-Methods": "GET, OPTIONS", "Access-Control-Allow-Headers": "content-type", Vary: "Origin" };
const reply = (status, body) => Response.json(body, { status, headers: { ...cors, "Cache-Control": "no-store" } });

// Per-instance throttle; enough to stop a loop.
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

export async function GET(request) {
  if (throttled(request.headers.get("x-forwarded-for")?.split(",")[0]?.trim() ?? "unknown")) return reply(429, { error: "Too many lookups." });
  const raw = (new URL(request.url).searchParams.get("keys") ?? "").split(",").map((k) => k.trim().toLowerCase()).filter(Boolean);
  if (!raw.length || raw.length > 8 || raw.some((k) => !/^0x([0-9a-f]{40}|[0-9a-f]{64})$/.test(k)))
    return reply(400, { error: "Pass 1 to 8 wallet keys as 0x hex." });
  const keys = [...new Set(raw.map(normal))];
  const sql = db();
  if (!sql) return reply(503, { error: "Not configured." });
  try {
    await ready(sql);
    const rows = await sql`
      select source_domain, burn_tx, dest_domain, amount, sender, recipient, delivered, mint_tx, burned_at
      from bridge_transfers
      where sender in ${sql(keys)} or recipient in ${sql(keys)}
      order by burned_at desc
      limit 50
    `;
    return reply(200, {
      transfers: rows.map((r) => ({
        sourceDomain: r.source_domain,
        burnTx: r.burn_tx,
        destDomain: r.dest_domain,
        amount: String(r.amount), // USDC base units
        sender: r.sender,
        recipient: r.recipient,
        // Sent with Circle's Forwarding Service: Circle mints and takes its gas in USDC.
        circleDelivers: r.delivered,
        // The mint on the destination, once recorded.
        mintTx: r.mint_tx,
        burnedAt: new Date(r.burned_at).toISOString(),
      })),
    });
  } catch {
    return reply(502, { error: "Could not read transfers." });
  }
}
