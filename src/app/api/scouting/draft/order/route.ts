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
  const names = new Map(league.teams.map(team => [team.rosterId, team.teamName]));
  const slots = league.draftSlots.map((slot) => ({
    pickIndex: slot.pickIndex, pickNumber: `${slot.round}.${String(slot.slot).padStart(2, "0")}`,
    round: slot.round, slot: slot.slot, rosterId: slot.rosterId ?? "",
    teamName: slot.rosterId ? names.get(slot.rosterId) ?? `Team ${slot.rosterId}` : "Unknown team",
  }));
  return NextResponse.json({ data: slots, revision: league.runtimeRevision });

}
