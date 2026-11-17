import "server-only";
import { getSupabaseAdminClient } from "./supabase/admin.ts";
import { currentFailoverConfig } from "./failover/config.ts";

/** Fixed HEAD probe: no user data, counts, or full runtime snapshots are fetched. */
export async function probeDatabase(signal: AbortSignal, client = getSupabaseAdminClient().client): Promise<boolean> {
  if (!client) return false;
  const { error } = await client.from("draft_state")
    .select("league_id", { head: true }).limit(1).abortSignal(signal);
  return !error;
}

type HealthOptions = {
  probe?: (signal: AbortSignal) => PromiseLike<boolean>;
  now?: () => number;
  timeoutMs?: number;
  cacheMs?: number;
};

export async function boundedHealthProbe(probe: (signal: AbortSignal) => PromiseLike<boolean>, timeoutMs = 2_000): Promise<boolean> {
  const controller = new AbortController();
  let timer: ReturnType<typeof setTimeout> | undefined;
  try {
    return await Promise.race([
      Promise.resolve().then(() => probe(controller.signal)).then((ok) => ok === true, () => false),
      new Promise<boolean>((resolve) => {
        timer = setTimeout(() => { controller.abort(); resolve(false); }, timeoutMs);
      }),
    ]);
  } finally { clearTimeout(timer); }
}

/** One bounded database request per process/window, including during failures. */
export function createHealthHandler({ probe = probeDatabase, now = Date.now, timeoutMs = 2_000, cacheMs = 10_000 }: HealthOptions = {}) {
  let cached: { ok: boolean; expiresAt: number } | undefined;
  let pending: Promise<boolean> | undefined;

  return async function GET(): Promise<Response> {
    const failover = currentFailoverConfig();
    if (failover.mode === "blocked" || failover.mode === "maintenance") return Response.json({ ok: false }, {
      status: 503, headers: { "Cache-Control": "no-store", "Retry-After": "60" },
    });
    let ok: boolean;
    if (cached && cached.expiresAt > now()) ok = cached.ok;
    else {
      pending ??= boundedHealthProbe(probe, timeoutMs).then((result) => {
        cached = { ok: result, expiresAt: now() + cacheMs };
        return result;
      }).finally(() => { pending = undefined; });
      ok = await pending;
    }
    return Response.json({ ok }, { status: ok ? 200 : 503, headers: { "Cache-Control": "no-store" } });
  };
}
