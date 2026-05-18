import { NextRequest, NextResponse } from "next/server";

import { LEAGUE_ID } from "@/infrastructure/config";
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

const requireLeagueId = () => {
  if (!LEAGUE_ID) throw new Error("League ID not configured");
  return LEAGUE_ID;
};

const normalize = (value: string | null | undefined) => value?.trim() ?? "";

export async function POST(request: NextRequest) {
  try {
    const leagueId = requireLeagueId();
    const body = (await request.json()) as OverrideBody;

    const teamId = normalize(body.teamId);
    const sleeperPlayerId = normalize(body.sleeperPlayerId);

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
