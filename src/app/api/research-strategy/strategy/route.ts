import { isCfcLeague } from "@/shared/league-data/capabilities";
import { NextRequest, NextResponse } from "next/server";

import {
  getTeamStrategyProfile,
  rebuildTeamTradeValuesForTeam,
  saveTeamStrategyProfile,
} from "@/research-strategy/api/service";
import type { TeamStrategyProfileInput } from "@/research-strategy/api/types";
import { currentAppSessionFromRequest, currentSessionCanActForRoster } from "@/infrastructure/auth/currentSession";

export const dynamic = "force-dynamic";


const normalizeTeamId = (value: string | null | undefined) => value?.trim() ?? "";

export async function GET(request: NextRequest) {
  const { session } = await currentAppSessionFromRequest(request);
  if (!session) return NextResponse.json({ error: "not_authenticated" }, { status: 401 });
  if (!isCfcLeague(session.leagueId)) return NextResponse.json({ error: "intelligence_not_configured_for_league" }, { status: 403 });
  try {
    const leagueId = session.leagueId;
    const teamId = normalizeTeamId(request.nextUrl.searchParams.get("teamId"));

    if (!teamId) {
      return NextResponse.json({ error: "teamId is required" }, { status: 400 });
    }
    if (!currentSessionCanActForRoster(session, leagueId, teamId)) return NextResponse.json({ error: "forbidden" }, { status: 403 });

    const data = await getTeamStrategyProfile(leagueId, teamId);
    return NextResponse.json({ data });
  } catch (error) {
    return NextResponse.json(
      { error: error instanceof Error ? error.message : "Failed to load strategy profile" },
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

    const body = (await request.json()) as {
      teamId?: string;
      profile?: TeamStrategyProfileInput;
    };

    const teamId = normalizeTeamId(body.teamId);
    if (!teamId) {
      return NextResponse.json({ error: "teamId is required" }, { status: 400 });
    }
    if (!currentSessionCanActForRoster(session, leagueId, teamId)) return NextResponse.json({ error: "forbidden" }, { status: 403 });

    const saved = await saveTeamStrategyProfile(leagueId, teamId, body.profile ?? {});
    const rebuild = await rebuildTeamTradeValuesForTeam(leagueId, teamId);

    return NextResponse.json({ ok: true, data: saved, rebuild });
  } catch (error) {
    return NextResponse.json(
      { error: error instanceof Error ? error.message : "Failed to save strategy profile" },
      { status: 500 },
    );
  }
}
