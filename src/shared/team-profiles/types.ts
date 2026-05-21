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
  avgStarterAge: number | null;
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
};