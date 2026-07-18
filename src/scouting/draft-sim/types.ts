import type { Position } from "@/shared/league-data";
import type { NeedBucket, NeedLevel, Tier } from "@/shared/team-profiles";

// One team's board as the sim reads it. order is best -> worst playerIds: the
// stored board when set, else consensus value order. curation (0..1) is how
// hard that board overrides the signals — 0 for an untouched (== consensus)
// board, climbing with reorder + stars near the pick.
export type TeamBoard = {
  rosterId: string;
  order: string[];
  starred: string[];
  hasStoredBoard: boolean;
  curation: number;
  // Stored-board tier per playerId (order 1 = top tier, label null when the
  // user never renamed it). Empty for consensus-fallback boards.
  tierByPlayer: Map<string, { order: number; label: string | null }>;
};

// Forward-looking age signal, per bucket, 0..1. High = old/placeholder starting
// unit with no young heir on the bench. Tilts a team toward drafting a successor
// even when the current NEED reads low.
export type SuccessorPressure = Record<NeedBucket, number>;

// One simulated selection in the projected draft.
export type SimPick = {
  overall: number;
  round: number;
  slot: number | null;
  rosterId: string;
  playerId: string | null;
  name: string | null;
  position: Position | null;
  reason: string; // "board-led" | "signal-led" | "qb-stash" | "no players left"
};

export type Recommendation = "stand_pat" | "trade_up" | "trade_back";

// What-if mood for a mock run. "standard" is the engine's straight read.
// The *-run scenarios add a scarcity premium so that position flies off the
// board (a positional run); "chalk" makes every team draft pure best-value.
export type DraftScenario = "standard" | "qb-run" | "rb-run" | "wr-run" | "chalk";

// A player still on the board when a team is on the clock, with the four signals
// exposed (never blended into one number for display) plus the team's overall
// want for that player — the margin that decides close calls.
export type SurvivorView = {
  playerId: string;
  name: string;
  position: Position;
  bucket: NeedBucket;
  asset: number;
  needLevel: NeedLevel;
  upgrade: number;
  starred: boolean;
  want: number;
};

export type PickRead = {
  overall: number;
  round: number;
  slot: number | null;
  recommendation: Recommendation;
  rationale: string;
  projectedPick: { playerId: string; name: string; position: Position } | null;
  topSurvivors: SurvivorView[];
  starGoneBeforeSlot: string[];
};

export type TeamSlotRead = {
  rosterId: string;
  teamName: string;
  tier: Tier;
  winNow: boolean;
  curation: number;
  successor: SuccessorPressure;
  picks: PickRead[];
};

export type DraftEngineResult = {
  poolSize: number;
  draftPicks: number;
  projection: SimPick[];
  reads: TeamSlotRead[];
};