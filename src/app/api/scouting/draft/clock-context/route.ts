import { NextResponse } from "next/server";
import { currentAppSessionFromRequest } from "@/infrastructure/auth/currentSession";
import { getSupabaseAdminClient } from "@/infrastructure/supabase/admin";
import { getLeagueData } from "@/shared/league-data";

export const dynamic = "force-dynamic";

export async function GET(request: Request) {
  const { session } = await currentAppSessionFromRequest(request);
  if (!session) return NextResponse.json({ error: "not_authenticated" }, { status: 401 });
  const league = await getLeagueData();
  if ("error" in league) return NextResponse.json({ error: league.error }, { status: 503 });
  if (session.leagueId !== league.leagueId) return NextResponse.json({ error: "forbidden" }, { status: 403 });
  const { client } = getSupabaseAdminClient();
  let nextPickIndex = league.draftStatus.picks.length;
  if (client) {
    const { data } = await client.from("draft_state").select("current_pick_index")
      .eq("league_id", league.leagueId).maybeSingle();
    const cursor = Number((data as { current_pick_index?: unknown } | null)?.current_pick_index);
    if (Number.isInteger(cursor) && cursor >= 0) nextPickIndex = cursor;
  }
  const round = Math.floor(nextPickIndex / league.teamCount) + 1;
  const slot = nextPickIndex % league.teamCount + 1;
  let owner = "";
  for (const [rosterId,picks] of league.pickOwnership) {
    if (picks.some(pick => pick.season === league.draftStatus.season && pick.round === round && pick.slot === slot)) { owner=rosterId; break; }
  }
  const teamName = league.teams.find(team => team.rosterId === owner)?.teamName ?? (owner ? `Team ${owner}` : "");
  return NextResponse.json({ data: { season: String(league.draftStatus.season), round, pick: slot,
    pickIndex: nextPickIndex, teamCount: league.teamCount, onClockRosterId: owner, onClockTeamName: teamName } });
}
