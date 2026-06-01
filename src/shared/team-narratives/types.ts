import type { Position } from "@/shared/league-data";
import type { NeedBucket } from "@/shared/team-profiles";
import type { IntentSignals } from "./intent";

// ── Archetypes ────────────────────────────────────────────────────────────

export type ArchetypeName =
  | "consolidate"
  | "de_consolidate"
  | "win_now_push"
  | "reset"
  | "sell_high_star"
  | "vet_liquidation"
  | "harvest_surplus"
  | "insurance"
  | "stand_pat";

export const ARCHETYPES: ArchetypeName[] = [
  "consolidate",
  "de_consolidate",
  "win_now_push",
  "reset",
  "sell_high_star",
  "vet_liquidation",
  "harvest_surplus",
  "insurance",
  "stand_pat",
];

export type NarrativeRole = "seller" | "buyer" | "null_action";

export const ARCHETYPE_ROLE: Record<ArchetypeName, NarrativeRole> = {
  consolidate: "buyer",
  de_consolidate: "seller",
  win_now_push: "buyer",
  reset: "seller",
  sell_high_star: "seller",
  vet_liquidation: "seller",
  harvest_surplus: "seller",
  insurance: "buyer",
  stand_pat: "null_action",
};

export type Flavor =
  | "depth_cliff"
  | "surplus_of_quality"
  | "pick_trade_back"
  | "contender"
  | "rebuilder"
  | null;

export const ARCHETYPE_OPPOSITES: Record<ArchetypeName, ArchetypeName[]> = {
  consolidate: ["de_consolidate", "reset", "sell_high_star", "vet_liquidation", "harvest_surplus"],
  de_consolidate: ["consolidate", "win_now_push", "insurance"],
  win_now_push: ["de_consolidate", "reset", "sell_high_star", "vet_liquidation", "harvest_surplus"],
  reset: ["consolidate", "win_now_push"],
  sell_high_star: ["consolidate", "win_now_push"],
  vet_liquidation: ["consolidate", "win_now_push", "insurance"],
  harvest_surplus: ["consolidate", "win_now_push", "insurance"],
  insurance: ["de_consolidate", "vet_liquidation", "harvest_surplus"],
  stand_pat: [],
};

// ── Intent signals ────────────────────────────────────────────────────────
//
// The per-position intent read replaces the old global WantsClarity posture.
// Defined in ./intent (alongside readIntent + the predicate helpers); re-exported
// here so types.ts stays the one stop for narrative-layer types.

export type { PositionIntent, PicksIntent } from "./intent";
export type { IntentSignals };

// ── Timeline frame ────────────────────────────────────────────────────────
//
// The clock a fired move serves. Phase B's thesis layer groups narratives by
// this axis into coherent stories (build_future / win_now / retool). Stamped on
// every FiredNarrative at trigger time. null = frame-agnostic (e.g. stand_pat
// can attach to whatever story is dominant).

export type Timeline = "win_now" | "build_future" | "retool" | null;

// Who drove this move: the owner's stated intent, or the engine's own
// roster-vs-league read. Phase B groups narratives into theses by (source ×
// timeline), so the owner's "finish the room" and the engine's "go all in"
// stay separate stories even when they touch the same position.
export type NarrativeSource = "intent" | "engine";

// ── Roster read ───────────────────────────────────────────────────────────

export type SurplusPosition = {
  bucket: NeedBucket;
  surplusPlayerIds: string[];
  reason: string;
};

export type ScarcityPosition = {
  bucket: NeedBucket;
  severity: "med" | "high";
  currentStarterIds: string[];
  reason: string;
};

export type WorstOptimalStarter = {
  playerId: string;
  name: string;
  position: Position;
  slot: string;
  value: number;
} | null;

export type AgingStarAtPeak = {
  playerId: string;
  name: string;
  position: Position;
  age: number;
  value: number;
};

export type OffTimelineVet = {
  playerId: string;
  name: string;
  position: Position;
  age: number;
  value: number;
};

export type BuriedYoungPlayer = {
  playerId: string;
  name: string;
  position: Position;
  age: number;
  value: number;
};

export type PhantomCorrection = {
  rule:
    | "depth_dial_behind_two_studs"
    | "need_dial_in_front_of_aging_roster"
    | "high_value_is_not_surplus";
  description: string;
};

// ── Contender upgrade thesis ──────────────────────────────────────────────
//
// The brain simulates: if this team replaced their weakest bucket-eligible
// starter with a league-median stud at the bucket, would their optimal lineup
// value cross a tier cut? Tier cuts come from sorting all 12 teams'
// starterValues: rank 6 = playoff cut (6 make playoffs), rank 2 = championship
// cut (top 2 are championship contenders).
//
// A team gets one ContenderUpgrade per scarcity bucket whose upgrade would
// tier-jump them. Empty array = no thesis fires (either no scarcities, the
// upgrade math doesn't get them across, or they're already at championship).

export type ContenderUpgrade = {
  bucket: NeedBucket;
  tierJump: "playoff" | "championship";
  studValueUsed: number;            // league-median stud value at this bucket
  currentLineupValue: number;
  hypotheticalValue: number;
  cutCrossed: number;
  reason: string;
};

export type RosterRead = {
  surpluses: SurplusPosition[];
  scarcities: ScarcityPosition[];
  worstOptimalStarter: WorstOptimalStarter;
  agingStarsAtPeak: AgingStarAtPeak[];
  offTimelineVets: OffTimelineVet[];
  buriedYoungPlayers: BuriedYoungPlayer[];
  contenderUpgrades: ContenderUpgrade[];
  phantomCorrections: PhantomCorrection[];
};

// ── Fired narratives ──────────────────────────────────────────────────────

export type FiredNarrative = {
  archetype: ArchetypeName;
  role: NarrativeRole;
  flavor: Flavor;
  // The clock this move serves, for Phase B story grouping. Stamped at trigger
  // time from the team's tier/trajectory + the intent signal that fired it.
  timeline: Timeline;
  // Who drove this move — owner intent vs engine roster read. Phase B groups by
  // (source × timeline) into theses.
  source: NarrativeSource;
  // The thesis this narrative was grouped into (set by buildTheses). Lets the
  // matcher stamp matches, so offers can be grouped back to their story.
  thesisId?: string;
  // For BUYER narratives: which bucket this narrative is shopping. Insurance
  // stamps the position it fired on (QB in superflex today) rather than relying
  // on a scarcity entry, since a depth/fragility need is not a listed scarcity.
  // Seller / null narratives leave this undefined.
  targetBucket?: NeedBucket;
  triggerScenario: string;
  evidence: string;
  assets: string[];
  returnShape: string;
};

// ── The bundle ────────────────────────────────────────────────────────────

// ── Thesis (Phase B) ──────────────────────────────────────────────────────
//
// A coherent team STORY: a set of fired narratives that share a source and a
// timeline, plus the currency fence that story plays by. Intent-sourced theses
// connect the dots the owner drew; engine-sourced theses surface directions the
// owner did NOT state (read from roster-vs-league). One thesis per (source ×
// timeline) that has at least one narrative; a team can have several.
//
// sacred / spendable are asset keys (player IDs + pick keys). They are the
// per-story currency rule — the SAME asset can be sacred in one thesis (the
// owner's build protects future firsts) and spendable in another (the engine's
// win-now story cashes them). Phase B computes and attaches these; wiring the
// matcher/offer path to honor them is the next step.

export type ThesisSource = "intent" | "engine";

export type Thesis = {
  id: string;                  // `${source}:${timeline}` — stable within a bundle
  source: ThesisSource;
  timeline: "win_now" | "build_future" | "retool";
  headline: string;            // director-facing one-liner (placeholder copy for now)
  pitch: string;               // the longer director pitch (placeholder copy for now)
  narratives: FiredNarrative[];
  sacred: string[];            // asset keys this story will NOT trade away
  spendable: string[];         // asset keys this story may package as currency
};

export type NarrativeBundle = {
  rosterId: string;
  teamName: string;
  identitySentence: string;
  intentSignals: IntentSignals;
  rosterRead: RosterRead;
  firedNarratives: FiredNarrative[];
  theses: Thesis[];
  crossNotes: string[];
};