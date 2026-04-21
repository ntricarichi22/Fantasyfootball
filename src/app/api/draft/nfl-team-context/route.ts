import { NextRequest, NextResponse } from "next/server";

import { LEAGUE_ID } from "@/lib/config";
import { getSupabaseAdminClient } from "@/lib/supabaseAdmin";

export const dynamic = "force-dynamic";

/**
 * Aggregates `cfc_team_trade_values_current` league-wide into a map of
 *   { [nfl_team]: { QB?: { name, value }, RB?: ..., WR?: ..., TE?: ... } }
 *
 * Each entry holds the highest-value rostered player at that position playing
 * for that NFL team. Used by the draft scouting card to pre-compute the
 * Situation and Opportunity letter grades without per-card API calls.
 */
export async function GET(request: NextRequest) {
  try {
  const leagueId =
    request.nextUrl.searchParams.get("leagueId")?.trim() || LEAGUE_ID;
  if (!leagueId) {
    return NextResponse.json({ error: "leagueId is required" }, { status: 400 });
  }

  const { client, error } = getSupabaseAdminClient();
  if (!client) {
    // Missing supabase config — return an empty map so the UI can show "TBD".
    return NextResponse.json({ data: {}, warning: error ?? "supabase unavailable" });
  }

  const { data, error: queryError } = await client
    .from("cfc_team_trade_values_current")
    .select("player_name, position, nfl_team, final_value")
    .eq("league_id", leagueId);

  if (queryError) {
    return NextResponse.json({ error: queryError.message }, { status: 500 });
  }

  const result: Record<string, Record<string, { name: string; value: number }>> = {};
  (data ?? []).forEach((row) => {
    const team = (row.nfl_team || "").toUpperCase();
    const position = (row.position || "").toUpperCase();
    const value = typeof row.final_value === "number" ? row.final_value : 0;
    if (!team || !position) return;
    if (!["QB", "RB", "WR", "TE"].includes(position)) return;
    const bucket = (result[team] ||= {});
    const current = bucket[position];
    if (!current || value > current.value) {
      bucket[position] = { name: row.player_name || "Unknown", value };
    }
  });

  return NextResponse.json({ data: result });
  } catch (err) {
    console.error('[API GET /api/draft/nfl-team-context]', err);
    return NextResponse.json(
      { error: 'Internal server error' },
      { status: 500 }
    );
  }
}
