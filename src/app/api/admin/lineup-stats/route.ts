import { NextResponse } from "next/server";
import { supabaseAdmin } from "@/lib/supabaseAdmin";

export const runtime = "nodejs";

export async function GET(req: Request) {
  const { searchParams } = new URL(req.url);
  const secret = searchParams.get("secret");

  if (secret !== process.env.ADMIN_SECRET) {
    return NextResponse.json({ error: "Unauthorized" }, { status: 401 });
  }

  // Pull all relevant matchup rows
  const { data: matchups, error } = await supabaseAdmin
    .from("slp_raw_smoke")
    .select("league_id, endpoint, payload")
    .like("endpoint", "matchups_w%");

  if (error) {
    return NextResponse.json({ ok: false, error: error.message }, { status: 500 });
  }

  let inserted = 0;
  for (const row of matchups ?? []) {
    const weekMatch = row.endpoint.match(/matchups_w(\d+)/);
    const week = weekMatch ? parseInt(weekMatch[1]) : null;
    const seasonMatch = row.league_id.match(/(\d{4})/); // crude guess from league_id
    const season = seasonMatch ? parseInt(seasonMatch[1]) : null;

    if (!Array.isArray(row.payload)) continue;

    for (const match of row.payload) {
      const { roster_id, starters, points } = match;

      const { error: insertErr } = await supabaseAdmin
        .from("slp_lineup_stats")
        .insert({
          league_id: row.league_id,
          season,
          week,
          roster_id,
          starters,
          points,
        });

      if (!insertErr) inserted += 1;
    }
  }

  return NextResponse.json({ ok: true, inserted });
}
