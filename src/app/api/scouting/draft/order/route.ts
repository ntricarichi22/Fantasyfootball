import { NextResponse } from "next/server";
import { currentAppSessionFromRequest } from "@/infrastructure/auth/currentSession";
import { getLeagueData } from "@/shared/league-data";

export const dynamic = "force-dynamic";
export async function GET(request: Request) {
  const { session } = await currentAppSessionFromRequest(request);
  if (!session) return NextResponse.json({ error: "not_authenticated" }, { status: 401 });
  const league = await getLeagueData();
  if ("error" in league) return NextResponse.json({ error: league.error }, { status: 503 });
  if (session.leagueId !== league.leagueId) return NextResponse.json({ error: "forbidden" }, { status: 403 });
  const names = new Map(league.teams.map(team => [team.rosterId, team.teamName]));
  const slots = [...league.pickOwnership.entries()].flatMap(([owner,picks]) => picks
    .filter(pick => pick.season === league.draftStatus.season && pick.round === 1 && pick.slot != null)
    .map(pick => ({ pickIndex: pick.slot!-1, pickNumber: `1.${String(pick.slot).padStart(2,"0")}`,
      round: 1, slot: pick.slot!, rosterId: owner, teamName: names.get(owner) ?? `Team ${owner}` })))
    .sort((a,b) => a.slot-b.slot);
  return NextResponse.json({ data: slots });
}
