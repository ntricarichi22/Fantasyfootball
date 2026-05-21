import { NextRequest, NextResponse } from "next/server";
import { LEAGUE_ID } from "@/infrastructure/config";
import { getSupabaseAdminClient } from "@/infrastructure/supabase/admin";
import { rebuildPickValuesForTeam } from "@/research-strategy/api/pickService";

export const dynamic = "force-dynamic";

// Returns this team's stored adjusted picks — the single source for the Set
// Availability PICKS tab: inventory (pick_key), adjusted price (final_value),
// and the owner tag (nfl_team, e.g. "(own)" / "(via Kush)").
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
      .select("sleeper_player_id, final_value, nfl_team, own_guys_modifier_pct, market_modifier_pct")
      .eq("league_id", leagueId)
      .eq("team_id", teamId)
      .eq("position", "PICK");

    if (error) {
      return NextResponse.json({ error: error.message }, { status: 500 });
    }

    // pick_key is the sleeper_player_id; owner tag rides in nfl_team for picks.
    const rows = (data ?? []).map((r) => ({
      pick_key: r.sleeper_player_id,
      final_value: r.final_value,
      owner_suffix: r.nfl_team ?? "(own)",
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

// Rebuild this team's adjusted pick rows. Called on first visit (or when the
// stored set is empty) so every owned pick has a row to read.
export async function POST(request: NextRequest) {
  try {
    const leagueId = LEAGUE_ID;
    if (!leagueId) {
      return NextResponse.json({ error: "League ID not configured" }, { status: 500 });
    }

    const body = (await request.json()) as { teamId?: string };
    const teamId = body.teamId?.trim();
    if (!teamId) {
      return NextResponse.json({ error: "teamId is required" }, { status: 400 });
    }

    await rebuildPickValuesForTeam(leagueId, teamId);
    return NextResponse.json({ ok: true });
  } catch (error) {
    return NextResponse.json(
      { error: error instanceof Error ? error.message : "Failed to rebuild pick values" },
      { status: 500 }
    );
  }
}