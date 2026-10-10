/**
 * Fixed-window limiter held in one server instance. Instances do not share it,
 * so it raises the cost of scripted abuse; the faucet contract still enforces
 * the hard per-address cooldown and total claim budget.
 */
export function createRateLimit(
  limit: number,
  windowMs: number,
  maxKeys = 5000,
  now = Date.now,
) {
  const hits = new Map<string, { count: number; reset: number }>();
  return (key: string) => {
    const t = now();
    let entry = hits.get(key);
    if (!entry || entry.reset <= t) {
      if (!entry && hits.size >= maxKeys) {
        for (const [k, v] of hits) if (v.reset <= t) hits.delete(k);
        if (hits.size >= maxKeys) hits.delete(hits.keys().next().value!);
      }
      entry = { count: 0, reset: t + windowMs };
      hits.set(key, entry);
    }
    return ++entry.count <= limit;
  };
}

/** Vercel sets x-real-ip and overwrites x-forwarded-for, so clients cannot choose it. */
export function clientIP(request: Request) {
  return (
    request.headers.get("x-real-ip") ??
    request.headers.get("x-forwarded-for")?.split(",")[0].trim() ??
    "unknown"
  );
}
