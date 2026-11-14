import { isCfcLeague } from "@/shared/league-data/capabilities";
import { currentAppSessionFromRequest } from "@/infrastructure/auth/currentSession";
import { NextRequest, NextResponse } from "next/server";

import {
  readTeamTradeChartAnchors,
  readTeamTradeChart,
  rebuildTeamTradeValuesForTeam,
} from "@/research-strategy/api/service";

export const dynamic = "force-dynamic";


const normalizeTeamId = (value: string | null | undefined) => value?.trim() ?? "";

export async function GET(request: NextRequest) {
  const { session } = await currentAppSessionFromRequest(request);
  if (!session) return NextResponse.json({ error: "not_authenticated" }, { status: 401 });
  if (!isCfcLeague(session.leagueId)) return NextResponse.json({ error: "intelligence_not_configured_for_league" }, { status: 403 });
  try {
    const leagueId = session.leagueId;
    const teamId = normalizeTeamId(request.nextUrl.searchParams.get("teamId"));

    if (teamId && teamId !== session.rosterId) return NextResponse.json({ error: "forbidden" }, { status: 403 });
    if (!teamId) {
      return NextResponse.json({ error: "teamId is required" }, { status: 400 });
    }

    const [data, anchors] = await Promise.all([
      readTeamTradeChart(leagueId, teamId),
      readTeamTradeChartAnchors(leagueId),
    ]);
    return NextResponse.json({ data, anchors });
  } catch (error) {
    return NextResponse.json(
      { error: error instanceof Error ? error.message : "Failed to load trade chart" },
      { status: 500 },
    );
  }
}

export async function POST(request: NextRequest) {
  const { session } = await currentAppSessionFromRequest(request);
  if (!session) return NextResponse.json({ error: "not_authenticated" }, { status: 401 });
  if (!isCfcLeague(session.leagueId)) return NextResponse.json({ error: "intelligence_not_configured_for_league" }, { status: 403 });
  try {
    const leagueId = session.leagueId;
    const body = (await request.json()) as { teamId?: string };

    const teamId = normalizeTeamId(body.teamId);
    if (teamId && teamId !== session.rosterId) return NextResponse.json({ error: "forbidden" }, { status: 403 });
    if (!teamId) {
      return NextResponse.json({ error: "teamId is required" }, { status: 400 });
    }

    const rebuild = await rebuildTeamTradeValuesForTeam(leagueId, teamId);
    const [data, anchors] = await Promise.all([
      readTeamTradeChart(leagueId, teamId),
      readTeamTradeChartAnchors(leagueId),
    ]);

    return NextResponse.json({ ok: true, rebuild, data, anchors });
  } catch (error) {
    return NextResponse.json(
      { error: error instanceof Error ? error.message : "Failed to rebuild trade chart" },
      { status: 500 },
    );
  }
}
