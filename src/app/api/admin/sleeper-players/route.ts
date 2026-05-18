import { NextResponse } from "next/server";
import { getSupabaseAdminClient } from "@/infrastructure/supabase/admin";

export const runtime = "nodejs";

function jsonError(message: string, status = 400) {
  return NextResponse.json({ ok: false, error: message }, { status });
}

async function sleep(ms: number) {
  return new Promise((r) => setTimeout(r, ms));
}

async function fetchJsonWithRetry(url: string, timeoutMs = 30_000, retries = 2) {
  let lastErr: string | null = null;

  for (let attempt = 0; attempt <= retries; attempt++) {
    const controller = new AbortController();
    const t = setTimeout(() => controller.abort(), timeoutMs);

    try {
      const res = await fetch(url, { signal: controller.signal, cache: "no-store" });
      const status = res.status;
      const text = await res.text();

      if (!res.ok) {
        lastErr = `Sleeper ${status}: ${text.slice(0, 500)}`;
      } else {
        const json = JSON.parse(text) as unknown;
        clearTimeout(t);
        return { ok: true as const, status, json, error: null as string | null };
      }
    } catch (e: unknown) {
      const err = e as { name?: string; message?: string };
      lastErr =
        err?.name === "AbortError" ? `Fetch timed out after ${timeoutMs}ms` : (err?.message ?? String(e));
    } finally {
      clearTimeout(t);
    }

    if (attempt < retries) await sleep(300 * (attempt + 1));
  }

  return { ok: false as const, status: null as number | null, json: null as unknown, error: lastErr };
}

export async function GET(req: Request) {
  const url = new URL(req.url);

  const secret = url.searchParams.get("secret");
  const adminSecret = process.env.ADMIN_SECRET;
  if (!adminSecret) return jsonError("Missing ADMIN_SECRET env var", 500);
  if (secret !== adminSecret) return jsonError("Unauthorized", 401);

  const supabaseResult = getSupabaseAdminClient();
  if (supabaseResult.error) return jsonError(`Supabase admin client error: ${supabaseResult.error}`, 500);
  if (!supabaseResult.client) return jsonError("Supabase admin client is null", 500);
  const supabaseAdmin = supabaseResult.client;

  const requestUrl = "https://api.sleeper.app/v1/players/nfl";
  const res = await fetchJsonWithRetry(requestUrl, 45_000, 1);

  const { error: upsertErr } = await supabaseAdmin
    .from("slp_raw_global")
    .upsert(
      {
        created_at: new Date().toISOString(),
        endpoint: "players_nfl",
        request_url: requestUrl,
        status_code: res.status,
        payload: res.ok ? (res.json as any) : null,
        error: res.ok ? null : res.error,
      },
      { onConflict: "request_url" }
    );

  if (upsertErr) return jsonError(`DB upsert failed: ${upsertErr.message}`, 500);

  // payload is huge; don’t return it
  const payloadKeys = res.ok && res.json && typeof res.json === "object" ? Object.keys(res.json as any).length : 0;

  return NextResponse.json({
    ok: true,
    endpoint: "players_nfl",
    request_url: requestUrl,
    status_code: res.status,
    has_payload: res.ok,
    payload_player_count: payloadKeys,
    error: res.ok ? null : res.error,
  });
}
