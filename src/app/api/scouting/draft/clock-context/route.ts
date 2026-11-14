import { NextResponse } from "next/server";
import { currentAppSessionFromRequest } from "@/infrastructure/auth/currentSession";
import { getLeagueData } from "@/shared/league-data";

export const dynamic = "force-dynamic";

export async function GET(request: Request) {
  const { session } = await currentAppSessionFromRequest(request);
  if (!session) return NextResponse.json({ error: "not_authenticated" }, { status: 401 });

  const league = await getLeagueData(session.leagueId);
  if ("error" in league) return NextResponse.json({ error: league.error }, { status: 503 });
  if (session.leagueId !== league.leagueId) return NextResponse.json({ error: "forbidden" }, { status: 403 });
  const nextPickIndex = league.draftClock?.currentPickIndex ?? 0;
  const current = league.draftSlots.find(slot => slot.pickIndex === nextPickIndex);
  const round = current?.round ?? Math.floor(nextPickIndex / league.teamCount) + 1;
  const slot = current?.slot ?? nextPickIndex % league.teamCount + 1;
  const owner = current?.rosterId ?? "";
  const teamName = league.teams.find(team => team.rosterId === owner)?.teamName ?? (owner ? `Team ${owner}` : "");
  return NextResponse.json({ data: { season: String(league.draftStatus.season), round, pick: slot,
    pickIndex: nextPickIndex, teamCount: league.teamCount, onClockRosterId: owner, onClockTeamName: teamName }, revision: league.runtimeRevision });
}
