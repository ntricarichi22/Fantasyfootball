import type { Position } from "@/shared/league-data";
import type { NeedBucket, NeedLevel, Tier } from "@/shared/team-profiles";
import type { Window } from "@/shared/team-dossier";

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
  window: Window;
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