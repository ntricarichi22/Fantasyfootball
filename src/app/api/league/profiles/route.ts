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
  const summary = profiles.map((p) => {
    const strat = data.strategy.get(p.rosterId);
    return {
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
      // Intent echo — confirms whether the posture data is actually resolving.
      intentResolved: !!strat,
      wantsMore: strat?.wantsMore ?? null,
      picksMarket: strat?.picksMarket ?? null,
      markets: strat
        ? { qb: strat.qbMarket, rb: strat.rbMarket, wr: strat.wrMarket, te: strat.teMarket }
        : null,
      persona: strat?.persona ?? null,
    };
  });

  // Key-space check: do strategy keys line up with roster ids?
  const strategyKeys = [...data.strategy.keys()].sort();
  const rosterIds = data.teams.map((t) => t.rosterId).sort();

  return NextResponse.json({
    diagnostics: data.diagnostics,
    keyCheck: { strategyKeys, rosterIds },
    summary,
    profiles,
  });
}