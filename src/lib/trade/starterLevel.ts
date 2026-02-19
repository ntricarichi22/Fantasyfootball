/**
 * Starter-level thresholds, core team strength, and team classification.
 *
 * "Starter-level" players are the top N players at each key position
 * based on adjusted value. Core team strength drives rebuild/contend
 * classification used by the offer engine.
 */

/** Counts that define "starter-level" per position (superflex league). */
export const STARTER_COUNTS = { QB: 2, RB: 2, WR: 2 } as const;

/** Number of best bench players included in core team strength. */
export const CORE_BENCH_SIZE = 3;

/** Teams in the bottom N core strength are "rebuild-leaning". */
export const BOTTOM_TIER_SIZE = 4;

/** Teams in the top N core strength are "contend-leaning". */
export const TOP_TIER_SIZE = 4;

export type CoreStrengthTier = "rebuild-leaning" | "middle" | "contend-leaning";

export interface StarterAsset {
  id: string;
  position?: string;
  adjustedValue: number;
  age?: number | null;
}

export interface StarterLevels {
  QB: StarterAsset[];
  RB: StarterAsset[];
  WR: StarterAsset[];
}

/**
 * Return the starter-level players for QB, RB, and WR.
 * TE is excluded because it is never a "must replace" starter position.
 */
export const computeStarterLevels = (players: StarterAsset[]): StarterLevels => {
  const topN = (pos: keyof typeof STARTER_COUNTS) =>
    players
      .filter((p) => p.position === pos && p.adjustedValue > 0)
      .sort((a, b) => b.adjustedValue - a.adjustedValue)
      .slice(0, STARTER_COUNTS[pos]);

  return { QB: topN("QB"), RB: topN("RB"), WR: topN("WR") };
};

/**
 * Core team strength = sum of starter-level adjusted values + best 3 bench.
 */
export const computeCoreTeamStrength = (players: StarterAsset[]): number => {
  const starters = computeStarterLevels(players);
  const starterIds = new Set(
    [...starters.QB, ...starters.RB, ...starters.WR].map((p) => p.id),
  );
  const starterValue = [...starterIds].reduce((sum, id) => {
    const p = players.find((pl) => pl.id === id);
    return sum + (p?.adjustedValue ?? 0);
  }, 0);
  const benchValue = players
    .filter((p) => !starterIds.has(p.id) && p.adjustedValue > 0)
    .sort((a, b) => b.adjustedValue - a.adjustedValue)
    .slice(0, CORE_BENCH_SIZE)
    .reduce((sum, p) => sum + p.adjustedValue, 0);
  return starterValue + benchValue;
};

/**
 * Classify a team's core-strength tier relative to the league.
 */
export const classifyTeamTier = (
  rank: number,
  teamCount: number,
): CoreStrengthTier => {
  if (rank <= TOP_TIER_SIZE) return "contend-leaning";
  if (rank > teamCount - BOTTOM_TIER_SIZE) return "rebuild-leaning";
  return "middle";
};
