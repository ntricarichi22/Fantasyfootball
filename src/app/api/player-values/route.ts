import { NextResponse } from "next/server";
import { currentAppSessionFromRequest } from "@/infrastructure/auth/currentSession";
import { getLeagueData } from "@/shared/league-data";
import { buildValuationContext } from "@/shared/asset-values";
import { completeRosterValues } from "@/shared/asset-values/rosterValues";

export const dynamic = "force-dynamic";

export async function GET(request: Request) {
  const { session, error } = await currentAppSessionFromRequest(request);
  if (!session) return NextResponse.json({ error }, { status: error === "not_authenticated" ? 401 : 503 });
  const [league, ctx] = await Promise.all([getLeagueData(), buildValuationContext()]);
  if ("error" in league) return NextResponse.json(league, { status: 503 });
  const rosteredIds = new Set(league.teams.flatMap(team => team.playerIds));
  const data: Record<string, number> = {};
  const unpricedPlayerIds: string[] = [];
  for (const [playerId, priced] of completeRosterValues(rosteredIds, session.rosterId, ctx.adjusted, league.values.value)) {
    data[playerId] = priced.value;
    if (league.values.unpriced?.has(playerId) || priced.source === "unpriced") unpricedPlayerIds.push(playerId);
  }
  return NextResponse.json({
    data,
    meta: { source: "shared-league-values", unpricedPlayerIds },
  });
}
