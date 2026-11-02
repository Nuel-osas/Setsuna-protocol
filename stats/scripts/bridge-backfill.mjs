// One-off: record Setsuna Bridge transfers made before the bridge reported them itself (29 Oct to
// 2 Nov 2026). Burns are found from wallets known to have used the bridge, each is checked against
// Circle's record, and stored with its onchain time. Re-running changes nothing.
//   node --env-file=.env.local scripts/bridge-backfill.mjs
import { createPublicClient, http, parseAbiItem } from "viem";
import { db, ready } from "../lib/db.js";
import { irisTransfer, saveTransfer } from "../lib/bridge.js";

const SUI_SENDERS = [
  "0x98a945d6523ba0b4685c4d50d0449c811fded93ad7a20cf2d61af6a6fd4d4d0b", // builder's test wallet
  "0x4cf1f7bad353d91db65e1075a3d973ec0925ca1e9ca0e296eaf7c936401227af", // onboarded user (History screenshot)
  "0x0099f97251af2d072fc492316ae30de3ab5639beb09073509d54bf49197513b4", // same user's second wallet
];
const EVM_SENDERS = ["0x194317BDC3c2Dc6c13eE1F47bc0e41a7365f0989"]; // builder's MetaMask test account
const SUI_BURN = "0xeb14978abfe93a37c5d5bf86a0623b923553a5f0e794daac7724f1e2fdbfb830::deposit_for_burn::DepositForBurn";
const MESSENGER = "0x28b5a0e9C621a5BadaA536219b3a228C8168cf5d";
const burnEvent = parseAbiItem(
  "event DepositForBurn(address indexed burnToken, uint256 amount, address indexed depositor, bytes32 mintRecipient, uint32 destinationDomain, bytes32 destinationTokenMessenger, bytes32 destinationCaller, uint256 maxFee, uint32 indexed minFinalityThreshold, bytes hookData)",
);

async function suiBurns(sender) {
  const query = `{ events(first: 50, filter: { sender: "${sender}", type: "${SUI_BURN}" }) { nodes { timestamp transaction { digest } } } }`;
  const res = await fetch("https://graphql.mainnet.sui.io/graphql", { method: "POST", headers: { "content-type": "application/json" }, body: JSON.stringify({ query }) });
  return (await res.json()).data.events.nodes.map((n) => ({ domain: 8, tx: n.transaction.digest, at: new Date(n.timestamp) }));
}

async function monadBurns() {
  const c = createPublicClient({ transport: http("https://rpc2.monad.xyz", { retryCount: 4 }) });
  const head = await c.getBlockNumber();
  const spans = [];
  for (let s = 117_550_000n; s <= head; s += 10_000n) spans.push([s, s + 9_999n > head ? head : s + 9_999n]);
  const logs = [];
  for (let i = 0; i < spans.length; i += 10)
    logs.push(...(await Promise.all(spans.slice(i, i + 10).map(([a, b]) => c.getLogs({ address: MESSENGER, event: burnEvent, args: { depositor: EVM_SENDERS }, fromBlock: a, toBlock: b })))).flat());
  return Promise.all(logs.map(async (l) => ({ domain: 15, tx: l.transactionHash, at: new Date(Number((await c.getBlock({ blockNumber: l.blockNumber })).timestamp) * 1000) })));
}

async function ethereumBurns() {
  const out = [];
  for (const a of EVM_SENDERS) {
    const items = (await (await fetch(`https://eth.blockscout.com/api/v2/addresses/${a}/transactions`)).json()).items ?? [];
    for (const t of items) if (t.to?.hash?.toLowerCase() === MESSENGER.toLowerCase() || /depositForBurn/i.test(t.method ?? "")) out.push({ domain: 0, tx: t.hash, at: new Date(t.timestamp) });
  }
  return out;
}

const sql = db();
if (!sql) throw new Error("STATS_DATABASE_URL is not set");
await ready(sql);
const burns = [...(await Promise.all(SUI_SENDERS.map(suiBurns))).flat(), ...(await monadBurns()), ...(await ethereumBurns())];
let saved = 0;
let usdc = 0;
for (const b of burns) {
  const t = await irisTransfer(b.domain, b.tx);
  if (!t) {
    console.log("not found at Circle, skipped:", b.domain, b.tx);
    continue;
  }
  await saveTransfer(sql, b.tx, t, b.at, "backfill");
  saved++;
  usdc += Number(t.amount) / 1e6;
}
const [{ n, total }] = await sql`select count(*)::int as n, coalesce(sum(amount), 0)::bigint as total from bridge_transfers`;
console.log(`found ${burns.length} burns, saved ${saved} (${usdc.toFixed(2)} USDC); table now holds ${n} transfers, ${Number(total) / 1e6} USDC`);
await sql.end();
