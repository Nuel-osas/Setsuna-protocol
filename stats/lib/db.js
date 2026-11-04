// Postgres on Railway (STATS_DATABASE_URL): the chain-scan cache and last report, so a refresh never
// re-reads history, and Setsuna Bridge transfers, which leave no Setsuna mark on chain.
// Optional: without the URL the stats page falls back to its checked-in checkpoint.
import postgres from "postgres";

let client;
let schema;

export function db() {
  const url = process.env.STATS_DATABASE_URL;
  if (!url) return null;
  client ??= postgres(url, { ssl: "require", max: 2, idle_timeout: 20, connect_timeout: 10, onnotice: () => {} });
  return client;
}

export function ready(sql) {
  schema ??= sql`
    create table if not exists kv (
      key text primary key,
      value jsonb not null,
      updated_at timestamptz not null default now()
    );
    create table if not exists bridge_transfers (
      source_domain integer not null,
      burn_tx text not null,
      dest_domain integer not null,
      amount bigint not null,
      sender text not null,
      recipient text not null,
      delivered boolean not null default false,
      mint_tx text,
      burned_at timestamptz not null,
      origin text not null default 'app',
      created_at timestamptz not null default now(),
      primary key (source_domain, burn_tx)
    );
  `.simple().catch((error) => {
    schema = null;
    throw error;
  });
  return schema;
}

export async function kvGet(sql, key) {
  const [row] = await sql`select value, updated_at from kv where key = ${key}`;
  return row ? { value: row.value, at: row.updated_at.getTime() } : null;
}

export async function kvSet(sql, key, value) {
  await sql`
    insert into kv (key, value, updated_at) values (${key}, ${sql.json(value)}, now())
    on conflict (key) do update set value = excluded.value, updated_at = now()
  `;
}
