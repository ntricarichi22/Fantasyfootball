import "server-only";
import { getSupabaseAdminClient } from "./supabase/admin.ts";

/** Fixed HEAD probe: no user data, counts, or full runtime snapshots are fetched. */
export async function probeDatabase(signal: AbortSignal): Promise<boolean> {
  const { client } = getSupabaseAdminClient();
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

/** One bounded database request per process/window, including during failures. */
export function createHealthHandler({ probe = probeDatabase, now = Date.now, timeoutMs = 2_000, cacheMs = 10_000 }: HealthOptions = {}) {
  let cached: { ok: boolean; expiresAt: number } | undefined;
  let pending: Promise<boolean> | undefined;

  async function boundedProbe(): Promise<boolean> {
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

  return async function GET(): Promise<Response> {
    let ok: boolean;
    if (cached && cached.expiresAt > now()) ok = cached.ok;
    else {
      pending ??= boundedProbe().then((result) => {
        cached = { ok: result, expiresAt: now() + cacheMs };
        return result;
      }).finally(() => { pending = undefined; });
      ok = await pending;
    }
    return Response.json({ ok }, { status: ok ? 200 : 503, headers: { "Cache-Control": "no-store" } });
  };
}
