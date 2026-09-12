import { NextResponse } from "next/server";
import { currentAppSessionFromRequest } from "@/infrastructure/auth/currentSession";
import { getSupabaseAdminClient } from "@/infrastructure/supabase/admin";
import { getLeagueData } from "@/shared/league-data";

export const dynamic = "force-dynamic";

export async function GET(request: Request) {
  const auth = await currentAppSessionFromRequest(request);
  if (!auth.session) return NextResponse.json({ error: auth.error }, { status: 401 });
  const league = await getLeagueData();
  if ("error" in league) return NextResponse.json({ error: league.error }, { status: 503 });
  if (auth.session.leagueId !== league.leagueId) return NextResponse.json({ error: "forbidden" }, { status: 403 });

  const status = league.draftStatus;
  const phase = !status.dayOneComplete ? "pre-day-one" : !status.dayTwoComplete ? "between" : "complete";
  let upcomingDraftAt: string | null = null;
  const { client } = getSupabaseAdminClient();
  if (client) {
    const { data } = await client.from("draft_state").select("starts_at").eq("league_id", league.leagueId).limit(1);
    upcomingDraftAt = (data?.[0] as { starts_at?: string | null } | undefined)?.starts_at ?? null;
  }
  return NextResponse.json({
    phase,
    dayOneComplete: status.dayOneComplete,
    dayTwoComplete: status.dayTwoComplete,
    season: status.season,
    teamCount: league.teamCount,
    upcomingDraftAt,
    teams: league.teams.map(team => ({ rosterId: team.rosterId, name: team.teamName })),
  });
}
