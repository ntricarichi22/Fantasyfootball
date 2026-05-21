import { NextResponse } from "next/server";
import { getLeagueData } from "@/shared/league-data";
import { buildTeamProfiles } from "@/shared/team-profiles";

export const dynamic = "force-dynamic";
export const maxDuration = 30;

export async function GET() {
  const data = await getLeagueData();
  if ("error" in data) {
    return NextResponse.json({ error: data.error }, { status: 500 });
  }

  const profiles = buildTeamProfiles(data);

  // Compact, eyeball-able summary for tuning the weights and tiers.
  const summary = profiles.map((p) => ({
    team: p.teamName,
    rosterId: p.rosterId,
    tier: p.tierLabel,
    baseTier: p.baseTierIndex,
    finalTier: p.tierIndex,
    nudge: p.trajectory.nudge,
    score: Number(p.currentState.score.toFixed(3)),
    starterValueNorm: Number(p.currentState.starterValueNorm.toFixed(3)),
    productionNorm: Number(p.currentState.productionNorm.toFixed(3)),
    starterValueRaw: Math.round(p.strength.starterValueRaw),
    points: Math.round(p.production.points),
    record: `${p.production.wins}-${p.production.losses}-${p.production.ties}`,
    avgAge: p.strength.avgStarterAge != null ? Number(p.strength.avgStarterAge.toFixed(1)) : null,
    ascending: p.trajectory.ascending,
    contendIntent: p.trajectory.contendIntent,
    direction: p.trajectory.direction,
    notes: p.trajectory.notes,
  }));

  return NextResponse.json({
    diagnostics: data.diagnostics,
    summary,
    profiles,
  });
}