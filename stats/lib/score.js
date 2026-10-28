// Setsuna real-usage scoring, read from Monad mainnet logs. Read-only: no key, no transactions.
// Shared by scripts/usage-scorecard.mjs (CLI) and stats.setsuna.finance (api/stats.js), so both
// count the same way. A wallet is an address, not a person.
import { getAddress, parseAbiItem } from "viem";

export const CONTRACTS = {
  setsUSDC: "0x0a531817EEFB7b1FFD7c511c0817F58ac343CC67",
  setsMON: "0x408A8C85a3e15446885ADCc954575e7a918dFd33",
  spot: "0x978BdBaD035F1cdf47e10915c0ceC4A94C3fC17D",
  orders: "0x323ad3cd45Cc366306B60878b59ED0d6C56EEfA4",
  perps: "0x00206Efbf5C49B61f2701a20d86329df4C3aB50D",
  // AUSD savings held as setsUSDC; its savers are counted, the wrapper itself is not a wallet.
  setsAUSD: "0x551903E3687820A733FBe406DD33Fee8D12bd2F3",
};
const SETS_AUSD_FROM = 117431452n;
const FROM = 112443702n; // trading deployment; Earn v2 followed at 112600382
// "Meaningful" Earn position and the retention window, per the sprint plan.
export const MEANINGFUL = { setsUSDC: 1, setsMON: 20, setsAUSD: 1 }; // in the vault's asset
export const RETENTION_HOURS = 72;
// The sprint plan's targets. Planning goals, not published thresholds.
const TARGETS = [
  ["activatedWallets", "External activated wallets", "wallets", 20, 30, "A confirmed deposit or trade, team wallets excluded"],
  ["spotTraders", "Active traders", "wallets", 10, 15, "At least one executed spot trade"],
  ["spotVolumeUSDC", "Spot volume", "USDC", 10000, 25000, "Filled value at the USDC side, once per execution"],
  ["returningTraders", "Returning traders", "wallets", 5, null, "Spot trades on two or more UTC days"],
  ["earnMeaningful", "Earn depositors", "wallets", 10, null, `Holding at least ${MEANINGFUL.setsUSDC} USDC or ${MEANINGFUL.setsMON} MON`],
  ["tvlUSDC", "External USDC TVL", "USDC", 500, 1000, "setsUSDC assets held by these wallets now"],
  ["retention72hPct", "Earn retention, 72h", "%", 50, null, `Still meaningful, among depositors at least ${RETENTION_HOURS}h old`],
];
const GROUPS = ["organic", "incentivized", "team"];

const ev = {
  swapped: parseAbiItem("event Swapped(address indexed owner, bool monToUSDC, uint256 amountIn, uint256 amountOut)"),
  deposit: parseAbiItem("event Deposit(address indexed sender, address indexed owner, uint256 assets, uint256 shares)"),
  perpsAccount: parseAbiItem("event AccountCreated(address indexed owner, address indexed account, uint256 perpId)"),
  ordersAccount: parseAbiItem("event AccountCreated(address indexed owner, address indexed account)"),
  order: parseAbiItem("event OrderSubmitted(uint256 indexed positionNonce, uint8 orderType, uint256 lotLNS)"),
  limit: parseAbiItem("event LimitPlaced(uint40 indexed orderId, bool isBuy, uint32 price, uint96 size)"),
};
const vaultAbi = [
  parseAbiItem("function balanceOf(address) view returns (uint256)"),
  parseAbiItem("function convertToAssets(uint256) view returns (uint256)"),
];

const big = (_, v) => (typeof v === "bigint" ? `${v}n` : v);
const unbig = (_, v) => (typeof v === "string" && /^\d+n$/.test(v) ? BigInt(v.slice(0, -1)) : v);
const day = (t) => new Date(t * 1000).toISOString().slice(0, 10);
const iso = (t) => (t === null ? null : new Date(t * 1000).toISOString());

/**
 * cache: {logs: {"<address>:<event>": json}, times: {block: unixSeconds}} — mutated in place,
 * so callers persist it (a file for the CLI, memory and a checked-in checkpoint for the site).
 */
export async function computeUsage({ client, cache, team, incentivized = [] }) {
  const teamSet = new Set(team.map((a) => getAddress(a)));
  const paid = new Set(incentivized.map((a) => getAddress(a)));
  const group = (a) => (teamSet.has(a) ? "team" : paid.has(a) ? "incentivized" : "organic");
  const head = await client.getBlock();
  cache.logs ??= {};
  cache.times ??= {};

  async function logs(address, event, from = FROM) {
    const key = `${address.toLowerCase()}:${event.name}`;
    const hit = cache.logs[key] ? JSON.parse(cache.logs[key], unbig) : { to: from - 1n, rows: [] };
    const spans = [];
    for (let s = hit.to + 1n; s <= head.number; s += 10_000n) spans.push([s, s + 9_999n > head.number ? head.number : s + 9_999n]);
    for (let i = 0; i < spans.length; i += 8) {
      const got = (await Promise.all(spans.slice(i, i + 8).map(([fromBlock, toBlock]) => client.getLogs({ address, event, fromBlock, toBlock })))).flat();
      hit.rows.push(...got.map((l) => ({ address: l.address, blockNumber: l.blockNumber, args: l.args })));
    }
    hit.to = head.number;
    cache.logs[key] = JSON.stringify(hit, big);
    return hit.rows;
  }
  async function stamp(entries) {
    const need = [...new Set(entries.map((e) => String(e.blockNumber)).filter((b) => !(b in cache.times)))];
    for (let i = 0; i < need.length; i += 20)
      await Promise.all(need.slice(i, i + 20).map(async (b) => (cache.times[b] = Number((await client.getBlock({ blockNumber: BigInt(b) })).timestamp))));
    return entries.map((e) => ({ ...e, time: cache.times[String(e.blockNumber)] }));
  }

  /* Spot: filled value in USDC, once per execution */
  const trades = (await stamp(await logs(CONTRACTS.spot, ev.swapped))).map((l) => ({
    wallet: getAddress(l.args.owner),
    usd: Number(l.args.monToUSDC ? l.args.amountOut : l.args.amountIn) / 1e6,
    time: l.time,
  }));

  /* Perps and limit orders: accounts, then what each account sent */
  const perpsAccounts = await logs(CONTRACTS.perps, ev.perpsAccount);
  const orderAccounts = await logs(CONTRACTS.orders, ev.ordersAccount);
  const ownerOf = new Map([...perpsAccounts, ...orderAccounts].map((l) => [getAddress(l.args.account), getAddress(l.args.owner)]));
  const perOwner = async (accounts, event) =>
    (await stamp((await Promise.all(accounts.map((l) => logs(getAddress(l.args.account), event)))).flat())).map((o) => ({ wallet: ownerOf.get(getAddress(o.address)), time: o.time }));
  const perpsOrders = await perOwner(perpsAccounts, ev.order);
  const limitOrders = await perOwner(orderAccounts, ev.limit);

  /* Earn: depositors and their positions now */
  const positions = [];
  const depositEvents = [];
  const wrapper = getAddress(CONTRACTS.setsAUSD);
  for (const [vault, address, decimals, from] of [["setsUSDC", CONTRACTS.setsUSDC, 6, FROM], ["setsMON", CONTRACTS.setsMON, 18, FROM], ["setsAUSD", CONTRACTS.setsAUSD, 6, SETS_AUSD_FROM]]) {
    const deps = await stamp(await logs(address, ev.deposit, from));
    const first = new Map();
    for (const d of deps) {
      const w = getAddress(d.args.owner);
      if (w === wrapper) continue; // setsAUSD's own setsUSDC; its savers are counted under setsAUSD
      depositEvents.push({ wallet: w, vault, time: d.time });
      if (!first.has(w) || d.time < first.get(w)) first.set(w, d.time);
    }
    await Promise.all(
      [...first].map(async ([wallet, since]) => {
        const shares = await client.readContract({ address, abi: vaultAbi, functionName: "balanceOf", args: [wallet], blockNumber: head.number });
        const assets = shares ? await client.readContract({ address, abi: vaultAbi, functionName: "convertToAssets", args: [shares], blockNumber: head.number }) : 0n;
        positions.push({ wallet, vault, since, assets: Number(assets) / 10 ** decimals });
      }),
    );
  }

  /* Per wallet */
  const wallets = new Map();
  const row = (w) => {
    if (!wallets.has(w))
      wallets.set(w, { wallet: w, group: group(w), first_seen: null, spot_volume_usdc: 0, spot_trades: 0, spot_days: new Set(), earn_usdc: 0, earn_mon: 0, earn_ausd: 0, perps_orders: 0, limit_orders: 0 });
    return wallets.get(w);
  };
  const seen = (r, t) => (r.first_seen = r.first_seen === null ? t : Math.min(r.first_seen, t));
  for (const t of trades) { const r = row(t.wallet); r.spot_volume_usdc += t.usd; r.spot_trades++; r.spot_days.add(day(t.time)); seen(r, t.time); }
  for (const o of perpsOrders) if (o.wallet) { const r = row(o.wallet); r.perps_orders++; seen(r, o.time); }
  for (const o of limitOrders) if (o.wallet) { const r = row(o.wallet); r.limit_orders++; seen(r, o.time); }
  const field = { setsUSDC: "earn_usdc", setsMON: "earn_mon", setsAUSD: "earn_ausd" };
  for (const p of positions) { const r = row(p.wallet); r[field[p.vault]] += p.assets; seen(r, p.since); }

  /* Score each group */
  const now = Number(head.timestamp);
  const round = (n) => Math.round(n * 100) / 100;
  function score(g) {
    const mine = [...wallets.values()].filter((r) => r.group === g);
    const volume = mine.reduce((s, r) => s + r.spot_volume_usdc, 0);
    const top = Math.max(0, ...mine.map((r) => r.spot_volume_usdc));
    const pos = positions.filter((p) => group(p.wallet) === g);
    const old = pos.filter((p) => now - p.since >= RETENTION_HOURS * 3600);
    return {
      activatedWallets: mine.length,
      spotTraders: mine.filter((r) => r.spot_trades).length,
      spotVolumeUSDC: round(volume),
      spotExecutions: mine.reduce((s, r) => s + r.spot_trades, 0),
      largestWalletSharePct: volume ? Math.round((top / volume) * 1000) / 10 : null,
      returningTraders: mine.filter((r) => r.spot_days.size >= 2).length,
      perpsTraders: mine.filter((r) => r.perps_orders).length,
      perpsOrders: mine.reduce((s, r) => s + r.perps_orders, 0),
      limitOrderTraders: mine.filter((r) => r.limit_orders).length,
      earnDepositors: new Set(pos.map((p) => p.wallet)).size,
      earnMeaningful: new Set(pos.filter((p) => p.assets >= MEANINGFUL[p.vault]).map((p) => p.wallet)).size,
      // setsAUSD is held as setsUSDC, so it counts toward USDC TVL.
      tvlUSDC: round(pos.filter((p) => p.vault === "setsUSDC" || p.vault === "setsAUSD").reduce((s, p) => s + p.assets, 0)),
      tvlAUSD: round(pos.filter((p) => p.vault === "setsAUSD").reduce((s, p) => s + p.assets, 0)),
      ausdSavers: new Set(pos.filter((p) => p.vault === "setsAUSD").map((p) => p.wallet)).size,
      tvlMON: round(pos.filter((p) => p.vault === "setsMON").reduce((s, p) => s + p.assets, 0)),
      retention72hPct: old.length ? Math.round((old.filter((p) => p.assets >= MEANINGFUL[p.vault]).length / old.length) * 1000) / 10 : null,
    };
  }
  const scores = Object.fromEntries(GROUPS.map((g) => [g, score(g)]));

  /* Daily activity per group, launch day to today */
  const daily = [];
  const startT = Math.min(...[...wallets.values()].map((r) => r.first_seen), now);
  const start = new Date(day(startT) + "T00:00:00Z");
  for (let d = start; d.getTime() / 1000 <= now; d = new Date(d.getTime() + 86_400_000)) {
    const key = d.toISOString().slice(0, 10);
    for (const g of GROUPS) {
      const tr = trades.filter((t) => group(t.wallet) === g && day(t.time) === key);
      daily.push({
        day: key,
        group: g,
        new_wallets: [...wallets.values()].filter((r) => r.group === g && r.first_seen !== null && day(r.first_seen) === key).length,
        spot_volume_usdc: round(tr.reduce((s, t) => s + t.usd, 0)),
        spot_trades: tr.length,
        earn_deposits: depositEvents.filter((e) => group(e.wallet) === g && day(e.time) === key).length,
      });
    }
  }

  const scorecard = TARGETS.map(([metric, label, unit, low, high, definition]) => ({
    metric, label, unit, definition,
    organic: scores.organic[metric],
    incentivized: scores.incentivized[metric],
    team: scores.team[metric],
    external: metric === "retention72hPct" ? null : (scores.organic[metric] ?? 0) + (scores.incentivized[metric] ?? 0),
    target_low: low,
    target_high: high,
  }));
  {
    const ext = positions.filter((p) => group(p.wallet) !== "team" && now - p.since >= RETENTION_HOURS * 3600);
    scorecard.find((r) => r.metric === "retention72hPct").external = ext.length ? Math.round((ext.filter((p) => p.assets >= MEANINGFUL[p.vault]).length / ext.length) * 1000) / 10 : null;
  }
  const activity = ["spotExecutions", "largestWalletSharePct", "perpsTraders", "perpsOrders", "limitOrderTraders", "earnDepositors", "tvlMON", "ausdSavers", "tvlAUSD"].map((metric) => ({
    metric, organic: scores.organic[metric], incentivized: scores.incentivized[metric], team: scores.team[metric],
  }));
  const walletRows = [...wallets.values()]
    .map((r) => ({ ...r, spot_days: r.spot_days.size, first_seen: iso(r.first_seen), spot_volume_usdc: round(r.spot_volume_usdc), earn_usdc: round(r.earn_usdc), earn_mon: round(r.earn_mon), earn_ausd: round(r.earn_ausd) }))
    .sort((a, b) => (a.first_seen < b.first_seen ? -1 : 1));

  return {
    snapshot: { through_block: Number(head.number), at: iso(now), network: "Monad mainnet (chain 143)", team_wallets: teamSet.size, incentivized_wallets: paid.size },
    scorecard,
    activity,
    daily,
    wallets: walletRows,
  };
}
