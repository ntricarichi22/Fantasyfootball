/** Cache identity only. Authorization must still be checked by the server. */
export function browserStorageScope(identity: { userId: string; leagueId: string; rosterId?: string; role?: string } | null): string | null {
  if (!identity?.userId || !identity.leagueId) return null;
  return [identity.leagueId, identity.userId, identity.rosterId ?? "", identity.role ?? ""].map(encodeURIComponent).join(":");
}

export function browserStorageKey(feature: string, scope: string | null): string | null {
  return scope ? `cfc:${feature}:v2:${scope}` : null;
}

export function readBrowserJson(storage: "localStorage" | "sessionStorage", key: string | null): unknown {
  if (typeof window === "undefined" || !key) return null;
  try { return JSON.parse(window[storage].getItem(key) ?? "null"); }
  catch { return null; }
}

export function writeBrowserJson(storage: "localStorage" | "sessionStorage", key: string | null, value: unknown): void {
  if (typeof window === "undefined" || !key) return;
  try { window[storage].setItem(key, JSON.stringify(value)); }
  catch { /* Browser storage is optional; disabled/full storage must not break the app. */ }
}
