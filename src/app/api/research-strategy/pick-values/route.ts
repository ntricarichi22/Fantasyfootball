import { NextRequest, NextResponse } from "next/server";
import { LEAGUE_ID } from "@/infrastructure/config";
import { getSupabaseAdminClient } from "@/infrastructure/supabase/admin";

export const dynamic = "force-dynamic";

// Returns this team's stored adjusted pick values. Picks live in the same
// per-team table as players (position="PICK"), keyed by their canonical pick
// key. The Set Availability page reads these so the displayed pick price
// reflects availability + draft-class-strength adjustments.
export async function GET(request: NextRequest) {
  try {
    const leagueId = LEAGUE_ID;
    if (!leagueId) {
      return NextResponse.json({ error: "League ID not configured" }, { status: 500 });
    }

    const teamId = request.nextUrl.searchParams.get("teamId")?.trim();
    if (!teamId) {
      return NextResponse.json({ error: "teamId is required" }, { status: 400 });
    }

    const { client, error: clientError } = getSupabaseAdminClient();
    if (!client) {
      return NextResponse.json({ error: clientError }, { status: 500 });
    }

    const { data, error } = await client
      .from("cfc_team_trade_values_current")
      .select("sleeper_player_id, final_value, own_guys_modifier_pct, market_modifier_pct")
      .eq("league_id", leagueId)
      .eq("team_id", teamId)
      .eq("position", "PICK");

    if (error) {
      return NextResponse.json({ error: error.message }, { status: 500 });
    }

    // pick_key is the sleeper_player_id for pick rows.
    const rows = (data ?? []).map((r) => ({
      pick_key: r.sleeper_player_id,
      final_value: r.final_value,
      availability_pct: r.own_guys_modifier_pct,
      class_strength_pct: r.market_modifier_pct,
    }));

    return NextResponse.json({ data: rows });
  } catch (error) {
    return NextResponse.json(
      { error: error instanceof Error ? error.message : "Failed to load pick values" },
      { status: 500 }
    );
  }
}