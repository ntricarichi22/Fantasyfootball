// Tiny module-level TTL memo for expensive server-side loads (Sleeper fetches,
// league-data assembly, valuation context). Survives across requests while the
// server process / lambda instance stays warm — which is exactly the win: the
// trade door fires three pipeline endpoints in parallel and they were each
// re-downloading the ~5MB Sleeper players blob and re-running the shared
// layers from scratch.
//
// In-flight de-duplication included: concurrent callers of the same key share
// one promise instead of racing three identical loads.

type Entry = { value: Promise<unknown>; expires: number };

const store = new Map<string, Entry>();

export function ttlMemo<T>(key: string, ttlMs: number, fn: () => Promise<T>): Promise<T> {
  const now = Date.now();
  const hit = store.get(key);
  if (hit && hit.expires > now) return hit.value as Promise<T>;

  const value = fn().catch(err => {
    // Never cache failures.
    store.delete(key);
    throw err;
  });
  store.set(key, { value, expires: now + ttlMs });
  return value;
}
