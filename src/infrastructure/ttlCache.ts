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
const MAX_ENTRIES = 512;

/** Drop a memoized entry so the next caller reloads immediately — for writes
 * that must be visible right away (e.g. a team rename busting identity). */
export function ttlInvalidate(key: string): void {
  store.delete(key);
}

/** Invalidate every memo whose key begins with a namespace. */
export function ttlInvalidatePrefix(prefix: string): void {
  for (const key of store.keys()) {
    if (key.startsWith(prefix)) store.delete(key);
  }
}

export function ttlMemo<T>(key: string, ttlMs: number, fn: () => Promise<T>): Promise<T> {
  const now = Date.now();
  const hit = store.get(key);
  if (hit && hit.expires > now) return hit.value as Promise<T>;

  const value = Promise.resolve().then(fn).catch(err => {
    // Never cache failures.
    if (store.get(key)?.value === value) store.delete(key);
    throw err;
  });
  for (const [entryKey, entry] of store) if (entry.expires <= now) store.delete(entryKey);
  if (!store.has(key) && store.size >= MAX_ENTRIES) store.delete(store.keys().next().value!);
  store.set(key, { value, expires: now + ttlMs });
  return value;
}
