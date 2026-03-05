import { NextResponse } from "next/server";
import { supabaseAdmin } from "@/lib/supabaseAdmin";

export const runtime = "nodejs";

function jsonError(message: string, status = 400) {
  return NextResponse.json({ ok: false, error: message }, { status });
}

export async function GET(req: Request) {
  const url = new URL(req.url);

  // Simple admin guard
  const secret = url.searchParams.get("secret");
  if (!process.env.ADMIN_SECRET) return jsonError("Missing ADMIN_SECRET env var", 500);
  if (secret !== process.env.ADMIN_SECRET) return jsonError("Unauthorized", 401);

  const leagueId = process.env.NEXT_PUBLIC_SLEEPER_LEAGUE_ID;
  if (!leagueId) return jsonError("Missing NEXT_PUBLIC_SLEEPER_LEAGUE_ID env var", 500);

  const requestUrl = `https://api.sleeper.app/v1/league/${leagueId}`;

  // Fetch with timeout
  const controller = new AbortController();
  const timeout = setTimeout(() => controller.abort(), 30000);

  let statusCode: number | null = null;
  let payload: any = null;
  let error: string | null = null;

  try {
    const res = await fetch(requestUrl, { signal: controller.signal, cache: "no-store" });
    statusCode = res.status;
    const text = await res.text();

    if (!res.ok) {
      error = `Sleeper ${res.status}: ${text.slice(0, 500)}`;
    } else {
      payload = JSON.parse(text);
    }
  } catch (e: any) {
    error = e?.name === "AbortError" ? "Fetch timed out" : (e?.message ?? String(e));
  } finally {
    clearTimeout(timeout);
  }

  // Insert RAW row (even if error)
  const { data, error: dbErr } = await supabaseAdmin
    .from("slp_raw_smoke")
    .insert({
      league_id: leagueId,
      endpoint: "league",
      request_url: requestUrl,
      status_code: statusCode,
      payload,
      error: error ?? (dbErr ? dbErr.message : null),
    })
    .select("id, created_at")
    .single();

  if (dbErr) return jsonError(`DB insert failed: ${dbErr.message}`, 500);

  return NextResponse.json({
    ok: true,
    inserted: data,
    league_id: leagueId,
    request_url: requestUrl,
    status_code: statusCode,
    has_payload: !!payload,
    error,
  });
}
