/** Small, short-lived read cache. Failures are never cached; concurrent readers share work. */
export function createReadCache<T>(ttl: number, limit = 16, now = Date.now) {
  type Entry = { value?: T; expires: number; pending?: Promise<T> };
  const entries = new Map<string, Entry>();
  return {
    peek(key: string): T | undefined {
      const entry = entries.get(key);
      return entry && entry.expires > now() ? entry.value : undefined;
    },
    invalidate(key: string) {
      entries.delete(key);
    },
    read(key: string, load: () => Promise<T>): Promise<T> {
      const existing = entries.get(key);
      if (existing?.pending) return existing.pending;
      if (existing && existing.expires > now())
        return Promise.resolve(existing.value!);
      const entry: Entry = { expires: 0 };
      entries.delete(key);
      entries.set(key, entry);
      while (entries.size > limit) entries.delete(entries.keys().next().value!);
      entry.pending = Promise.resolve()
        .then(load)
        .then(
          (value) => {
            if (entries.get(key) === entry) {
              entry.value = value;
              entry.expires = now() + ttl;
              entry.pending = undefined;
            }
            return value;
          },
          (error) => {
            if (entries.get(key) === entry) entries.delete(key);
            throw error;
          },
        );
      return entry.pending;
    },
  };
}
