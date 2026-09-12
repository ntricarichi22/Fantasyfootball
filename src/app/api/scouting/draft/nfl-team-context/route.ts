import { NextRequest, NextResponse } from "next/server";
import { currentAppSessionFromRequest } from "@/infrastructure/auth/currentSession";
import { buildValuationContext, valueAsset } from "@/shared/asset-values";
import { getLeagueData } from "@/shared/league-data";

export const dynamic = "force-dynamic";

export async function GET(request: NextRequest) {
  const { session } = await currentAppSessionFromRequest(request);
  if (!session) return NextResponse.json({ error: "not_authenticated" }, { status: 401 });
  const league = await getLeagueData();
  if ("error" in league) return NextResponse.json({ error: league.error }, { status: 503 });
  if (session.leagueId !== league.leagueId) return NextResponse.json({ error: "forbidden" }, { status: 403 });
  const ctx = await buildValuationContext();
  const rows = league.teams.flatMap(team => team.players.map(player => ({
    player,
    value: valueAsset({ type: "player", sleeperPlayerId: player.id }, ctx, { perspective: session.rosterId }),
  })));
  const ordered = [...rows].sort((a, b) => a.value - b.value);
  const percentile = new Map(ordered.map((row, index) => [row.player.id,
    ordered.length <= 1 ? 100 : Math.round(index * 100 / (ordered.length - 1))]));
  const result: Record<string, Record<string, { name: string; value: number }>> = {};
  for (const { player } of rows) {
    const nflTeam = player.team?.toUpperCase();
    if (!nflTeam) continue;
    const bucket = (result[nflTeam] ||= {});
    const current = bucket[player.position];
    const pct = percentile.get(player.id) ?? 0;
    if (!current || pct > current.value) bucket[player.position] = { name: player.name, value: pct };
  }
  return NextResponse.json({ data: result, scale: "league_value_percentile" });
}
