import { NextResponse } from "next/server";
import { getSupabaseAdminClient } from "@/lib/supabaseAdmin";

export const runtime = "nodejs";

function jsonError(message: string, status = 400) {
  return NextResponse.json({ ok: false, error: message }, { status });
}

export async function GET(req: Request) {
  const url = new URL(req.url);

  // Admin guard
  const secret = url.searchParams.get("secret");
  const adminSecret = process.env.ADMIN_SECRET;
  if (!adminSecret) return jsonError("Missing ADMIN_SECRET env var", 500);
  if (secret !== adminSecret) return jsonError("Unauthorized", 401);

  const leagueId = process.env.NEXT_PUBLIC_SLEEPER_LEAGUE_ID;
  if (!leagueId) return jsonError("Missing NEXT_PUBLIC_SLEEPER_LEAGUE_ID env var", 500);

  // Supabase admin client (server-only)
  const { client: supabaseAdmin, error: supabaseAdminError } = getSupabaseAdminClient();
  if (supabaseAdminError) return jsonError(`Supabase admin client error: ${supabaseAdminError}`, 500);

  const requestUrl = `https://api.sleeper.app/v1/league/${leagueId}`;

  // Fetch with timeout
  const controller = new AbortController();
  const timeout = setTimeout(() => controller.abort(), 30_000);

  let statusCode: number | null = null;
  let payload: unknown = null;
  let fetchError: string | null = null;

  try {
    const res = await fetch(requestUrl, { signal: controller.signal, cache: "no-store" });
    statusCode = res.status;

    const text = await res.text();

    if (!res.ok) {
      fetchError = `Sleeper ${res.status}: ${text.slice(0, 500)}`;
    } else {
      payload = JSON.parse(text) as unknown;
    }
  } catch (e: unknown) {
    const err = e as { name?: string; message?: string };
    fetchError = err?.name === "AbortError" ? "Fetch timed out" : (err?.message ?? String(e));
  } finally {
    clearTimeout(timeout);
  }

  // Insert RAW row (even if fetch failed)
  const insertRes = await supabaseAdmin
    .from("slp_raw_smoke")
    .insert({
      league_id: leagueId,
      endpoint: "league",
      request_url: requestUrl,
      status_code: statusCode,
      payload: payload as any, // jsonb accepts objects/null; keep it loose
      error: fetchError,
    })
    .select("id, created_at")
    .single();

  if (insertRes.error) return jsonError(`DB insert failed: ${insertRes.error.message}`, 500);

  return NextResponse.json({
    ok: true,
    inserted: insertRes.data,
    league_id: leagueId,
    request_url: requestUrl,
    status_code: statusCode,
    has_payload: !!payload,
    error: fetchError,
  });
}
