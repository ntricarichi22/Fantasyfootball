import type { LeagueData } from "@/shared/league-data";
import { computeStrength, computeProduction } from "./strength";
import {
  TIERS,
  TIER_LABELS,
  type Tier,
  type Trajectory,
  type TeamProfile,
} from "./types";

// ── tunable knobs (calibrate against real output, not blind) ────────────────
const STARTER_WEIGHT = 0.6; // current state = 60% starter value ...
const PRODUCTION_WEIGHT = 0.4; // ... + 40% last-season production
const POINTS_WEIGHT = 0.75; // production = 75% points ...
const RECORD_WEIGHT = 0.25; // ... + 25% record
const AGE_YOUNG = 25.5; // avg starter age at/below = ascending lean
const AGE_OLD = 28.0; // avg starter age at/above = closing-window lean
const GAP_THRESHOLD = 0.15; // value-vs-production gap that counts as a signal
const TIER_COUNT = 4;

function minMax(values: number[]): number[] {
  if (!values.length) return [];
  const min = Math.min(...values);
  const max = Math.max(...values);
  if (max === min) return values.map(() => 0.5);
  return values.map((v) => (v - min) / (max - min));
}

// Split the current-state curve at its natural gaps (same idea as the Big Board
// auto-tiering) rather than forcing rigid 3-per-tier bands.
function naturalBreakTiers(scores: number[], k: number): number[] {
  const n = scores.length;
  const result = new Array<number>(n).fill(0);
  if (n === 0) return result;
  const order = scores.map((s, i) => ({ s, i })).sort((a, b) => b.s - a.s);
  const gaps: Array<{ gap: number; at: number }> = [];
  for (let j = 1; j < order.length; j++) {
    gaps.push({ gap: order[j - 1].s - order[j].s, at: j });
  }
  const boundaries = new Set(
    gaps
      .slice()
      .sort((a, b) => b.gap - a.gap)
      .slice(0, Math.max(0, Math.min(k - 1, gaps.length)))
      .map((g) => g.at)
  );
  let tier = 0;
  for (let j = 0; j < order.length; j++) {
    if (boundaries.has(j)) tier = Math.min(tier + 1, k - 1);
    result[order[j].i] = tier;
  }
  return result;
}

function computeTrajectory(
  wantsMore: string[],
  picksMarket: string,
  avgStarterAge: number | null,
  starterValueNorm: number,
  productionNorm: number
): { ascending: number; contendIntent: number; direction: Trajectory["direction"]; gap: number } {
  let ascending = 0;
  if (avgStarterAge != null) {
    if (avgStarterAge <= AGE_YOUNG) ascending += 1;
    else if (avgStarterAge >= AGE_OLD) ascending -= 1;
  }
  const gap = starterValueNorm - productionNorm;
  if (gap >= GAP_THRESHOLD) ascending += 1;
  else if (gap <= -GAP_THRESHOLD) ascending -= 1;

  let contendIntent = 0;
  const wants = new Set(wantsMore);
  if (wants.has("elite_producers")) contendIntent += 1;
  if (wants.has("draft_picks")) contendIntent -= 1;
  if (wants.has("young_upside")) contendIntent -= 1;
  if (picksMarket === "sell") contendIntent += 1;
  else if (picksMarket === "buy") contendIntent -= 1;

  const direction: Trajectory["direction"] =
    ascending > 0 ? "ascending" : ascending < 0 ? "declining" : "steady";
  return { ascending, contendIntent, direction, gap };
}

export function buildTeamProfiles(data: LeagueData, ourRosterId?: string): TeamProfile[] {
  const teams = data.teams;
  const strengths = teams.map((t) => computeStrength(t, data.values, data.settings.rosterPositions));
  const productions = teams.map((t) => computeProduction(data.results.get(t.rosterId)));

  const svNorm = minMax(strengths.map((s) => s.starterValue));
  const ptsNorm = minMax(productions.map((p) => p.points));
  const recNorm = minMax(productions.map((p) => p.winPct ?? 0));

  const productionNorm = ptsNorm.map((p, i) => POINTS_WEIGHT * p + RECORD_WEIGHT * recNorm[i]);
  const scores = svNorm.map((sv, i) => STARTER_WEIGHT * sv + PRODUCTION_WEIGHT * productionNorm[i]);
  const baseTiers = naturalBreakTiers(scores, TIER_COUNT);

  const profiles: TeamProfile[] = teams.map((team, i) => {
    const strat = data.strategy.get(team.rosterId);
    const traj = computeTrajectory(
      strat?.wantsMore ?? [],
      strat?.picksMarket ?? "unknown",
      strengths[i].avgStarterAge,
      svNorm[i],
      productionNorm[i]
    );

    const baseTier = baseTiers[i];
    let finalTier = baseTier;
    let notes = "current-state tier held";

    if (baseTier <= 1) {
      // Strong on paper but young / value-heavy / not pushing to win now is not a
      // true current contender — slide down a step.
      if (traj.ascending >= 1 && traj.contendIntent <= 0) {
        finalTier = baseTier + 1;
        notes = "demoted: strong on paper but ascending/not win-now";
      }
    } else {
      // Bottom of the league: posture splits climbing vs tearing down.
      if (traj.contendIntent >= 1) {
        finalTier = 2;
        notes = "retooling: acquiring/win-now lean";
      } else if (traj.contendIntent <= -1) {
        finalTier = 3;
        notes = "rebuilding: accumulating picks/youth";
      }
    }
    finalTier = Math.max(0, Math.min(TIER_COUNT - 1, finalTier));
    const nudge = finalTier - baseTier;
    const tier: Tier = TIERS[finalTier];

    void ourRosterId; // reserved: caller can flag "us" downstream

    return {
      rosterId: team.rosterId,
      teamName: team.teamName,
      ownerId: team.ownerId,
      tierIndex: finalTier,
      tier,
      tierLabel: TIER_LABELS[tier],
      baseTierIndex: baseTier,
      strength: strengths[i],
      production: productions[i],
      currentState: {
        starterValueNorm: svNorm[i],
        pointsNorm: ptsNorm[i],
        recordNorm: recNorm[i],
        productionNorm: productionNorm[i],
        score: scores[i],
      },
      trajectory: {
        ascending: traj.ascending,
        contendIntent: traj.contendIntent,
        tradeLean: 0, // dormant until accepted trades exist
        direction: traj.direction,
        nudge,
        notes,
      },
    };
  });

  profiles.sort((a, b) => a.tierIndex - b.tierIndex || b.currentState.score - a.currentState.score);
  return profiles;
}