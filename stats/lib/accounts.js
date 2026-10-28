// Accounts: who signed up, matched against who acted on chain.
// Privy knows the email and Google sign-ups and their wallets. Passkey (Mera) and browser-wallet
// users leave no sign-up record anywhere, so any active wallet that is not a Privy wallet is
// counted as a passkey-or-wallet user. Only counts and short addresses leave this module:
// no emails, no Privy ids.
import { getAddress } from "viem";

const PRIVY = "https://auth.privy.io/api/v1/users";

/** Every Privy user, following the cursor. Needs the app id and secret (server-side only). */
export async function fetchPrivyUsers({ appId, secret, fetchImpl = fetch }) {
  const auth = `Basic ${Buffer.from(`${appId}:${secret}`).toString("base64")}`;
  const users = [];
  let cursor;
  for (let page = 0; page < 200; page++) {
    const url = new URL(PRIVY);
    url.searchParams.set("limit", "100");
    if (cursor) url.searchParams.set("cursor", cursor);
    const res = await fetchImpl(url, { headers: { Authorization: auth, "privy-app-id": appId } });
    if (!res.ok) throw Object.assign(new Error(`privy ${res.status}`), { name: "PrivyError", status: res.status });
    const body = await res.json();
    users.push(...(body.data ?? []));
    cursor = body.next_cursor;
    if (!cursor) break;
  }
  return users;
}

const seconds = (t) => (typeof t === "number" ? (t > 1e12 ? Math.floor(t / 1000) : t) : Math.floor(Date.parse(t) / 1000));
const day = (t) => new Date(t * 1000).toISOString().slice(0, 10);
const short = (a) => `${a.slice(0, 6)}…${a.slice(-4)}`;

function method(user) {
  const types = (user.linked_accounts ?? []).map((a) => a.type);
  if (types.includes("google_oauth")) return "google";
  if (types.includes("email")) return "email";
  if (types.some((t) => t.endsWith("_oauth"))) return "social";
  return "wallet";
}

function walletsOf(user) {
  const out = [];
  for (const a of user.linked_accounts ?? []) {
    if (a.type === "wallet" && /^0x[0-9a-fA-F]{40}$/.test(a.address ?? "")) out.push(getAddress(a.address));
    if (a.type === "smart_wallet" && /^0x[0-9a-fA-F]{40}$/.test(a.address ?? "")) out.push(getAddress(a.address));
  }
  return out;
}

/**
 * users: Privy users. walletRows: the on-chain report's wallets ({wallet, group, first_seen}).
 * team: team addresses. Team Privy accounts (any wallet on the team list) are counted apart.
 */
export function accountsReport({ users, walletRows, team }) {
  const teamSet = new Set(team.map((a) => getAddress(a)));
  const active = new Map(walletRows.map((r) => [getAddress(r.wallet), r]));
  const privyWallets = new Map();

  const accounts = users.map((u) => {
    const wallets = walletsOf(u);
    const isTeam = wallets.some((w) => teamSet.has(w));
    const acted = wallets.filter((w) => active.has(w) && active.get(w).group !== "team");
    for (const w of wallets) privyWallets.set(w, true);
    return { created: seconds(u.created_at), method: method(u), team: isTeam, activated: acted.length > 0 };
  });
  const external = accounts.filter((a) => !a.team);

  // Active on chain, not a team wallet, and not any Privy account's wallet.
  const others = walletRows.filter((r) => r.group !== "team" && !privyWallets.has(getAddress(r.wallet)));

  const byMethod = {};
  for (const a of external) byMethod[a.method] = (byMethod[a.method] ?? 0) + 1;

  const days = new Map();
  const bump = (key, field) => {
    if (!days.has(key)) days.set(key, { day: key, privy_signups: 0, passkey_or_wallet_users: 0 });
    days.get(key)[field]++;
  };
  for (const a of external) bump(day(a.created), "privy_signups");
  for (const r of others) if (r.first_seen) bump(r.first_seen.slice(0, 10), "passkey_or_wallet_users");

  const activated = external.filter((a) => a.activated).length;
  return {
    available: true,
    users_total: external.length + others.length,
    privy_accounts: external.length,
    privy_by_method: byMethod,
    privy_activated: activated,
    privy_activation_pct: external.length ? Math.round((activated / external.length) * 1000) / 10 : null,
    passkey_or_wallet_users: others.length,
    team_privy_accounts: accounts.length - external.length,
    daily: [...days.values()].sort((a, b) => (a.day < b.day ? -1 : 1)),
    passkey_or_wallet: others.map((r) => ({ wallet: short(getAddress(r.wallet)), group: r.group, first_seen: r.first_seen })),
  };
}
