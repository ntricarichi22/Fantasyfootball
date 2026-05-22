import type { Position } from "@/shared/league-data";

// Four tiers, best to worst. Index 0..3 maps to this order.
export type Tier = "championship" | "playoff" | "retooling" | "rebuilding";

export const TIERS: Tier[] = ["championship", "playoff", "retooling", "rebuilding"];

export const TIER_LABELS: Record<Tier, string> = {
  championship: "Championship contender",
  playoff: "Playoff team",
  retooling: "Retooling",
  rebuilding: "Rebuilding",
};

export type LineupSlot = {
  slot: string;
  playerId: string | null;
  name: string | null;
  position: Position | null;
  value: number;
};

export type StrengthBreakdown = {
  lineup: LineupSlot[];
  starterValueRaw: number; // sum of the optimal starting lineup's CFC value
  benchValue: number; // sum of everyone not starting
  depthBonus: number; // light credit for bench (benchValue * DEPTH_FACTOR)
  starterValue: number; // starterValueRaw + depthBonus
  avgStarterAge: number | null; // optimal-lineup average across all starters
  // Per-bucket starter age — the average age of the starters filling each
  // bucket's slots (QB / RB / pass-catcher), null if the bucket has no starter.
  // Same CLASS of fact as avgStarterAge, just disaggregated, so it lives beside
  // it in shared: the scouting sim reads it for successor pressure, and the
  // dossier can later sharpen its "closing window" read per position. It is a
  // raw NUMBER only — the old/young classification stays in the layers above.
  bucketAge: Record<NeedBucket, number | null>;
};

export type ProductionBreakdown = {
  points: number;
  wins: number;
  losses: number;
  ties: number;
  winPct: number | null;
};

export type CurrentState = {
  starterValueNorm: number; // 0..1 across the league
  pointsNorm: number;
  recordNorm: number;
  productionNorm: number; // 0.75*points + 0.25*record
  score: number; // 0.60*starterValue + 0.40*production
};

export type Trajectory = {
  ascending: number; // talent vs results: + young / value>production, - aging / producing
  contendIntent: number; // posture: + win-now, - building/picks
  tradeLean: number; // DORMANT — wired for accepted trades, always 0 until they exist
  direction: "ascending" | "steady" | "declining";
  nudge: number; // tier adjustment actually applied (-1..+1)
  notes: string;
};

// ── Team needs (league-relative, per bucket) ────────────────────────────────
// Pure ROSTER TRUTH — how a team's starting unit + depth at a position stack
// up against the other 11, and nothing else. Age is deliberately excluded
// (already priced into player value, so it would double-count). Market/posture
// is deliberately excluded (manipulable, and it belongs to the trade engine /
// scouting POV, not the raw need). Three buckets, not four: no dedicated TE
// slot, so WR + TE are one "pass catcher" bucket. Starter unit sizes: QB 2,
// RB 2, pass catcher 4; the depth man is the next one (QB3 / RB3 / PC5).
export type NeedBucket = "QB" | "RB" | "PASS_CATCHER";

export type NeedLevel = "low" | "med" | "high";

export type NeedDetail = {
  bucket: NeedBucket;
  starterNorm: number; // 0..1 league-relative strength of the starting unit
  depthNorm: number; // 0..1 league-relative strength of the depth man
  score: number; // 0..1 final need, 1 = league-worst unit, 0 = league-best
  level: NeedLevel;
};

export type TeamNeeds = {
  qb: NeedDetail;
  rb: NeedDetail;
  passCatcher: NeedDetail;
};

export type TeamProfile = {
  rosterId: string;
  teamName: string;
  ownerId: string | null;
  tierIndex: number; // 0..3 after the trajectory nudge
  tier: Tier;
  tierLabel: string;
  baseTierIndex: number; // from current-state natural breaks, before the nudge
  strength: StrengthBreakdown;
  production: ProductionBreakdown;
  currentState: CurrentState;
  trajectory: Trajectory;
  needs: TeamNeeds;
};