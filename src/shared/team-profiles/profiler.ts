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
const AGE_YOUNG = 25.5; // avg starter age at/below = ascending (informational)
const AGE_OLD = 28.0; // avg starter age at/above = closing window (informational)
const GAP_THRESHOLD = 0.15; // value-vs-production gap that counts as a signal
const TIER_COUNT = 4;
const FIRE_SALE_LEAN = -1; // tradeLean at/below this = sell-off (dormant for now)

// Onboarding stores short labels; the trade engine uses long ones. Accept both.
const PICKS_LABELS = new Set(["picks", "draft_picks"]);
const STUD_LABELS = new Set(["studs", "elite_producers"]);
const YOUTH_LABELS = new Set(["youth", "young_upside"]);

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

// Informational only — describes which way a team is trending. Does NOT move
// tiers anymore; strength sets the tier and only a sell signal nudges it.
function computeTrajectory(
  wantsMore: string[],
  picksMarket: string,
  avgStarterAge: number | null,
  starterValueNorm: number,
  productionNorm: number
): { ascending: number; contendIntent: number; direction: Trajectory["direction"] } {
  let ascending = 0;
  if (avgStarterAge != null) {
    if (avgStarterAge <= AGE_YOUNG) ascending += 1;
    else if (avgStarterAge >= AGE_OLD) ascending -= 1;
  }
  const gap = starterValueNorm - productionNorm;
  if (gap >= GAP_THRESHOLD) ascending += 1;
  else if (gap <= -GAP_THRESHOLD) ascending -= 1;

  let contendIntent = 0;
  for (const w of wantsMore) {
    if (STUD_LABELS.has(w)) contendIntent += 1;
    else if (PICKS_LABELS.has(w) || YOUTH_LABELS.has(w)) contendIntent -= 1;
  }
  if (picksMarket === "sell") contendIntent += 1;
  else if (picksMarket === "buy") contendIntent -= 1;

  const direction: Trajectory["direction"] =
    ascending > 0 ? "ascending" : ascending < 0 ? "declining" : "steady";
  return { ascending, contendIntent, direction };
}

// The lone demote trigger: a team whose only stated want is picks, or whose
// trade history reads as a sell-off (the latter is dormant until trades exist).
function isSellSignal(wantsMore: string[], tradeLean: number): boolean {
  const onlyWantsPicks = wantsMore.length === 1 && PICKS_LABELS.has(wantsMore[0]);
  const fireSale = tradeLean <= FIRE_SALE_LEAN;
  return onlyWantsPicks || fireSale;
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
    const wantsMore = strat?.wantsMore ?? [];
    const traj = computeTrajectory(
      wantsMore,
      strat?.picksMarket ?? "unknown",
      strengths[i].avgStarterAge,
      svNorm[i],
      productionNorm[i]
    );

    const tradeLean = 0; // dormant until accepted trades exist
    const baseTier = baseTiers[i];
    let finalTier = baseTier;
    let notes = "tier set by current-state strength";
    if (isSellSignal(wantsMore, tradeLean)) {
      finalTier = Math.min(TIER_COUNT - 1, baseTier + 1);
      notes =
        tradeLean <= FIRE_SALE_LEAN
          ? "demoted: trade history reads as a sell-off"
          : "demoted: only seeking picks (sell signal)";
    }
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
        tradeLean,
        direction: traj.direction,
        nudge,
        notes,
      },
    };
  });

  profiles.sort((a, b) => a.tierIndex - b.tierIndex || b.currentState.score - a.currentState.score);
  return profiles;
}