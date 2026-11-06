// Setsuna Bridge transfers: verified against Circle's attestation service (Iris), never taken from a
// client, and grouped organic / rewarded / team like the rest of the stats.
import { decodeEventLog, parseAbi } from "viem";

export const DOMAINS = {
  0: "Ethereum", 1: "Avalanche", 2: "OP Mainnet", 3: "Arbitrum", 5: "Solana", 6: "Base", 7: "Polygon PoS",
  8: "Sui", 9: "Aptos", 10: "Unichain", 11: "Linea", 12: "Codex", 13: "Sonic", 14: "World Chain", 15: "Monad",
  16: "Sei", 17: "BNB Chain", 18: "XDC", 19: "HyperEVM", 21: "Ink", 22: "Plume", 25: "Starknet", 26: "Arc",
  27: "Stellar", 28: "Edge", 29: "Injective", 30: "Morph", 31: "Pharos", 32: "Cronos", 33: "Plasma", 37: "X Layer",
};

const FORWARD_HOOK = "0x636374702d666f7277617264";

// SetsunaBridgeSponsor burns on Monad for users who only signed, so Circle records the contract as
// the sender. The user is in the contract's Bridged event in the same transaction.
export const SPONSOR = "0xeabf1aa629a686c9e5862b316f954bf2c0b68dbe";
const sponsorAbi = parseAbi([
  "event Bridged(address indexed owner, address indexed token, uint256 value, uint256 burned, uint32 indexed destinationDomain, bytes32 mintRecipient, uint256 maxFee, bool forward, address relayer)",
]);

/** For a sponsored burn: the wallet that signed it, from the Bridged event in the burn tx, or null. */
export async function sponsoredOwner(client, burnTx) {
  const receipt = await client.getTransactionReceipt({ hash: burnTx });
  for (const log of receipt.logs) {
    if (log.address.toLowerCase() !== SPONSOR) continue;
    try {
      const ev = decodeEventLog({ abi: sponsorAbi, data: log.data, topics: log.topics });
      if (ev.eventName === "Bridged") return ev.args.owner.toLowerCase();
    } catch {}
  }
  return null;
}

/** A bytes32 that holds a 20-byte EVM address becomes that address; anything else stays as is. */
export function normal(addr) {
  const a = String(addr ?? "").toLowerCase();
  return /^0x0{24}[0-9a-f]{40}$/.test(a) ? `0x${a.slice(26)}` : a;
}

/** Circle's record of a burn, or null if Circle doesn't know it (yet). Amount in USDC base units. */
export async function irisTransfer(sourceDomain, burnTx) {
  const res = await fetch(`https://iris-api.circle.com/v2/messages/${sourceDomain}?transactionHash=${encodeURIComponent(burnTx)}`, {
    signal: AbortSignal.timeout(10_000),
  });
  if (!res.ok) return null;
  const m = (await res.json()).messages?.[0];
  const d = m?.decodedMessage;
  const body = d?.decodedMessageBody;
  if (!d || !body?.amount) return null;
  return {
    sourceDomain: Number(d.sourceDomain),
    destDomain: Number(d.destinationDomain),
    amount: BigInt(body.amount),
    sender: normal(body.messageSender),
    recipient: normal(body.mintRecipient),
    delivered: String(body.hookData ?? "").startsWith(FORWARD_HOOK),
    mintTx: m.destinationMintTxHash || m.forwardTxHash || null,
  };
}

export async function saveTransfer(sql, burnTx, t, burnedAt, origin) {
  await sql`
    insert into bridge_transfers
      (source_domain, burn_tx, dest_domain, amount, sender, recipient, delivered, mint_tx, burned_at, origin)
    values
      (${t.sourceDomain}, ${burnTx}, ${t.destDomain}, ${t.amount.toString()}, ${t.sender}, ${t.recipient},
       ${t.delivered}, ${t.mintTx}, ${burnedAt}, ${origin})
    on conflict (source_domain, burn_tx) do update set mint_tx = coalesce(excluded.mint_tx, bridge_transfers.mint_tx)
  `;
}

const GROUPS = ["organic", "incentivized", "team"];
const day = (d) => new Date(d).toISOString().slice(0, 10);
const round = (n) => Math.round(n * 100) / 100;

/** Totals, daily volume, routes and recent transfers from stored rows. */
export function summarize(rows, team, paid) {
  const teamSet = new Set(team.map((a) => a.toLowerCase()));
  const paidSet = new Set(paid.map((a) => a.toLowerCase()));
  const group = (r) =>
    teamSet.has(r.sender) || teamSet.has(r.recipient) ? "team" : paidSet.has(r.sender) || paidSet.has(r.recipient) ? "incentivized" : "organic";
  const items = rows.map((r) => ({
    burnTx: r.burn_tx, from: DOMAINS[r.source_domain] ?? `Domain ${r.source_domain}`, to: DOMAINS[r.dest_domain] ?? `Domain ${r.dest_domain}`,
    usdc: Number(r.amount) / 1e6, sender: r.sender, recipient: r.recipient, delivered: r.delivered, mintTx: r.mint_tx,
    at: new Date(r.burned_at).toISOString(), group: group(r), origin: r.origin, sponsored: String(r.origin ?? "").startsWith("sponsored"),
  }));
  const totals = Object.fromEntries(GROUPS.map((g) => {
    const mine = items.filter((i) => i.group === g);
    return [g, {
      transfers: mine.length, volumeUSDC: round(mine.reduce((s, i) => s + i.usdc, 0)), wallets: new Set(mine.map((i) => i.sender)).size,
      delivered: mine.filter((i) => i.delivered).length, sponsored: mine.filter((i) => i.sponsored).length,
    }];
  }));
  const days = [...new Set(items.map((i) => day(i.at)))].sort();
  const daily = days.flatMap((d) => GROUPS.map((g) => {
    const mine = items.filter((i) => i.group === g && day(i.at) === d);
    return { day: d, group: g, volume_usdc: round(mine.reduce((s, i) => s + i.usdc, 0)), transfers: mine.length };
  }));
  const routes = {};
  for (const i of items) {
    const r = (routes[`${i.from} → ${i.to}`] ??= { route: `${i.from} → ${i.to}`, transfers: 0, volumeUSDC: 0, organicUSDC: 0 });
    r.transfers++;
    r.volumeUSDC = round(r.volumeUSDC + i.usdc);
    if (i.group === "organic") r.organicUSDC = round(r.organicUSDC + i.usdc);
  }
  return {
    totals,
    daily,
    routes: Object.values(routes).sort((a, b) => b.volumeUSDC - a.volumeUSDC),
    recent: [...items].sort((a, b) => (a.at < b.at ? 1 : -1)).slice(0, 25),
    since: items.length ? items.reduce((m, i) => (i.at < m ? i.at : m), items[0].at) : null,
  };
}
