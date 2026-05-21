import { NextResponse } from "next/server";
import { getLeagueData } from "@/shared/league-data";
import { buildTeamProfiles } from "@/shared/team-profiles";
import { computeDraftFit, type DraftFitCell } from "@/scouting/draft-fit";

export const dynamic = "force-dynamic";
export const maxDuration = 30;

function fmt(c: DraftFitCell) {
  return {
    player: c.name,
    pos: c.position,
    asset: c.asset,
    need: `${c.needLevel} (${c.needScore.toFixed(2)})`,
    upgrade: c.upgrade > 0 ? Math.round(c.upgrade) : 0,
  };
}

// GET /api/scouting/draft-fit — verification surface for Layer A. Per team:
// the position floors, the top startable upgrades, and the top raw assets
// (best-player-available). Eyeball this to tune the read before any POV prose.
export async function GET() {
  const data = await getLeagueData();
  if ("error" in data) {
    return NextResponse.json(data, { status: 500 });
  }

  const profiles = buildTeamProfiles(data);
  const grid = computeDraftFit(data, profiles);

  const teams = grid.teams.map((t) => ({
    rosterId: t.rosterId,
    teamName: t.teamName,
    tier: t.tier,
    floors: t.floors,
    topFits: t.cells.filter((c) => c.upgrade > 0).slice(0, 12).map(fmt),
    topAssets: [...t.cells].sort((a, b) => b.asset - a.asset).slice(0, 8).map(fmt),
  }));

  return NextResponse.json({ poolSize: grid.poolSize, count: teams.length, teams });
}