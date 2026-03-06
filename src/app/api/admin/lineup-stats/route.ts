import { NextResponse } from "next/server";
import { getSupabaseAdminClient } from "@/lib/supabaseAdmin";

export const runtime = "nodejs";

function jsonError(message: string, status = 400) {
  return NextResponse.json({ ok: false, error: message }, { status });
}

export async function GET(req: Request) {
  const url = new URL(req.url);
  const secret = url.searchParams.get("secret");

  const adminSecret = process.env.ADMIN_SECRET;
  if (!adminSecret) return jsonError("Missing ADMIN_SECRET env var", 500);
  if (secret !== adminSecret) return jsonError("Unauthorized", 401);

  const supabaseResult = getSupabaseAdminClient();
  if (supabaseResult.error) {
    return jsonError(`Supabase admin client error: ${supabaseResult.error}`, 500);
  }
  if (!supabaseResult.client) {
    return jsonError("Supabase admin client is null", 500);
  }

  const supabaseAdmin = supabaseResult.client;

  const { data: matchupRows, error: fetchError } = await supabaseAdmin
    .from("slp_raw_smoke")
    .select("league_id, endpoint, payload")
    .like("endpoint", "matchups_w%")
    .eq("status_code", 200);

  if (fetchError) {
    return jsonError(`Failed to load matchup rows: ${fetchError.message}`, 500);
  }

  let upserted = 0;

  for (const row of matchupRows ?? []) {
    const weekMatch = row.endpoint.match(/^matchups_w(\d+)$/);
    if (!weekMatch) continue;

    const week = Number(weekMatch[1]);
    if (!Array.isArray(row.payload)) continue;

    for (const match of row.payload) {
      const rosterId = match?.roster_id ?? null;
      const starters = Array.isArray(match?.starters) ? match.starters : [];
      const points = match?.points ?? null;

      if (!rosterId) continue;

      const { error: upsertError } = await supabaseAdmin
        .from("slp_lineup_stats")
        .upsert(
          {
            league_id: row.league_id,
            week,
            roster_id: rosterId,
            starters,
            points,
          },
          { onConflict: "league_id,week,roster_id" }
        );

      if (upsertError) {
        return jsonError(`Failed to upsert lineup stats: ${upsertError.message}`, 500);
      }

      upserted += 1;
    }
  }

  return NextResponse.json({
    ok: true,
    upserted,
  });
}
