import { NextRequest, NextResponse } from "next/server";

import { LEAGUE_ID } from "@/lib/config";
import {
  readTeamTradeChart,
  rebuildTeamTradeValuesForTeam,
} from "@/lib/team-hq/service";

export const dynamic = "force-dynamic";

const requireLeagueId = () => {
  if (!LEAGUE_ID) throw new Error("League ID not configured");
  return LEAGUE_ID;
};

const normalizeTeamId = (value: string | null | undefined) => value?.trim() ?? "";

export async function GET(request: NextRequest) {
  try {
    const leagueId = requireLeagueId();
    const teamId = normalizeTeamId(request.nextUrl.searchParams.get("teamId"));

    if (!teamId) {
      return NextResponse.json({ error: "teamId is required" }, { status: 400 });
    }

    const data = await readTeamTradeChart(leagueId, teamId);
    return NextResponse.json({ data });
  } catch (error) {
    return NextResponse.json(
      { error: error instanceof Error ? error.message : "Failed to load trade chart" },
      { status: 500 },
    );
  }
}

export async function POST(request: NextRequest) {
  try {
    const leagueId = requireLeagueId();
    const body = (await request.json()) as { teamId?: string };

    const teamId = normalizeTeamId(body.teamId);
    if (!teamId) {
      return NextResponse.json({ error: "teamId is required" }, { status: 400 });
    }

    const rebuild = await rebuildTeamTradeValuesForTeam(leagueId, teamId);
    const data = await readTeamTradeChart(leagueId, teamId);

    return NextResponse.json({ ok: true, rebuild, data });
  } catch (error) {
    return NextResponse.json(
      { error: error instanceof Error ? error.message : "Failed to rebuild trade chart" },
      { status: 500 },
    );
  }
}
