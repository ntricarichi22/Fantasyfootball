import { isCfcLeague } from "@/shared/league-data/capabilities";
import { currentAppSessionFromRequest } from "@/infrastructure/auth/currentSession";
import { NextRequest, NextResponse } from "next/server";

import {
  readTeamTradeChart,
  saveManualPlayerOverride,
} from "@/research-strategy/api/service";

export const dynamic = "force-dynamic";

type OverrideBody = {
  teamId?: string;
  sleeperPlayerId?: string;
  manualOverrideValue?: number | null;
  overrideNote?: string;
};


const normalize = (value: string | null | undefined) => value?.trim() ?? "";

export async function POST(request: NextRequest) {
  const { session } = await currentAppSessionFromRequest(request);
  if (!session) return NextResponse.json({ error: "not_authenticated" }, { status: 401 });
  if (!isCfcLeague(session.leagueId)) return NextResponse.json({ error: "intelligence_not_configured_for_league" }, { status: 403 });
  try {
    const leagueId = session.leagueId;
    const body = (await request.json()) as OverrideBody;

    const teamId = normalize(body.teamId);
    const sleeperPlayerId = normalize(body.sleeperPlayerId);
    if (teamId !== session.rosterId) return NextResponse.json({ error: "forbidden" }, { status: 403 });

    if (!teamId || !sleeperPlayerId) {
      return NextResponse.json(
        { error: "teamId and sleeperPlayerId are required" },
        { status: 400 },
      );
    }

    const value =
      body.manualOverrideValue == null
        ? null
        : Number.isFinite(Number(body.manualOverrideValue))
          ? Number(body.manualOverrideValue)
          : NaN;

    if (Number.isNaN(value)) {
      return NextResponse.json(
        { error: "manualOverrideValue must be a number or null" },
        { status: 400 },
      );
    }

    const rebuild = await saveManualPlayerOverride(
      leagueId,
      teamId,
      sleeperPlayerId,
      value,
      body.overrideNote,
    );

    const data = await readTeamTradeChart(leagueId, teamId);

    return NextResponse.json({ ok: true, rebuild, data });
  } catch (error) {
    return NextResponse.json(
      { error: error instanceof Error ? error.message : "Failed to save manual override" },
      { status: 500 },
    );
  }
}
