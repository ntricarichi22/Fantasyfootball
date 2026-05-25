import { NextResponse } from "next/server";
import { LEAGUE_ID } from "@/infrastructure/config";
import { getSupabaseAdminClient } from "@/infrastructure/supabase/admin";
import { getLeagueData } from "@/shared/league-data";
import { rebuildPickValuesForTeam } from "@/research-strategy/api/pickService";

export const dynamic = "force-dynamic";
export const maxDuration = 60;

// One-off admin tool: set every team's owned picks to "core_piece" and rebuild
// their pick rows in cfc_team_trade_values_current. Hit once in the browser to
// populate the whole league's picks for trade purposes. Safe to re-run (all
// writes are idempotent upserts/rebuilds). Delete the route when done.
export async function GET() {
  try {
    const leagueId = LEAGUE_ID;
    if (!leagueId) {
      return NextResponse.json({ error: "League ID not configured" }, { status: 500 });
    }

    const { client, error: clientError } = getSupabaseAdminClient();
    if (!client) {
      return NextResponse.json({ error: clientError }, { status: 500 });
    }

    const league = await getLeagueData();
    if ("error" in league) {
      return NextResponse.json({ error: league.error }, { status: 500 });
    }

    const nowIso = new Date().toISOString();
    const summary: Array<{ teamId: string; teamName: string; picks: number }> = [];

    for (const team of league.teams) {
      const teamId = team.rosterId;
      const picks = league.pickOwnership.get(teamId) ?? [];

      if (picks.length) {
        const rows = picks.map((pick) => ({
          league_id: leagueId,
          team_id: teamId,
          sleeper_player_id: pick.key,
          attachment: "core_piece",
          updated_at: nowIso,
        }));

        const { error: upsertErr } = await client
          .from("cfc_team_player_attachment")
          .upsert(rows, { onConflict: "league_id,team_id,sleeper_player_id" });

        if (upsertErr) {
          return NextResponse.json({ error: upsertErr.message, failedTeam: teamId }, { status: 500 });
        }
      }

      // Recompute this team's pick rows from the freshly-set attachments.
      await rebuildPickValuesForTeam(leagueId, teamId);

      summary.push({ teamId, teamName: team.teamName, picks: picks.length });
    }

    const totalPicks = summary.reduce((sum, t) => sum + t.picks, 0);
    return NextResponse.json({ ok: true, teams: summary.length, totalPicks, summary });
  } catch (error) {
    return NextResponse.json(
      { error: error instanceof Error ? error.message : "Failed to rebuild all picks" },
      { status: 500 },
    );
  }
}