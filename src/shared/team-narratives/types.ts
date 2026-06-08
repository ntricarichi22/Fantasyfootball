import type { Position, PlayoffHistory } from "@/shared/league-data";
import type { NeedBucket, NeedLevel } from "@/shared/team-profiles";
import type { IntentSignals } from "./intent";

// ── Timeline + source ──────────────────────────────────────────────────────
//
// Two timelines only — there is NO retool. A good-but-aging or fringe team is
// expressed as a TWO-thesis team (a win_now AND a build_future), each its own
// story with its own goals and fence. See the trade brain.
export type Timeline = "win_now" | "build_future";
export type ThesisSource = "intent" | "engine";

// ── Return spec — what a valid FILL for a goal looks like ────────────────────
//
// Mirrors the engine's ReturnAim so offer-gen hands it straight to the
// constructor's balance step. A goal AIMS its return; it is not merely a fair
// value match. This is what makes a build's stud sale come back as youth + the
// pick tier asked for, not the highest-value vet the math allows.
export type PickTier = "premium" | "future" | "any";

export type ReturnSpec = {
  // HARD: the return must include a competent same-bucket starter (start-for
  // test). Used when shipping a stud would otherwise drop a started slot.
  requireBackfill?: NeedBucket;
  // Bias the fill toward picks of this tier.
  preferPickTier?: PickTier;
  // Player buckets the fill may pull from. [] = picks-only; undefined = any.
  preferBuckets?: NeedBucket[];
  // Buckets whose RETURNED players must be young + non-stud to count.
  youthBuckets?: NeedBucket[];
  // The acquire target at this bucket must clear the league top-N impact bar.
  impactBucket?: NeedBucket;
  // If an optimal-lineup starter is shipped to fund this goal, the return MUST
  // be a genuine win-now upgrade (never a lateral/downgrade). win_now only.
  winNowStarterUpgrade?: boolean;
  // "hard" filters the fill pool to aim-matching pieces only; "soft" prefers
  // aim matches but keeps the full pool.
  strength?: "hard" | "soft";
};

// ── Goal — a single objective inside a thesis ────────────────────────────────
export type GoalKind =
  | "accumulate_picks"
  | "add_youth"
  | "fill_need"
  | "acquire_impact"
  | "insurance"
  | "teardown"
  | "shed";

export type Goal = {
  id: string;                 // stable within a bundle
  kind: GoalKind;
  sourceThesisId: string;
  bucket?: NeedBucket;        // the position this goal concerns (omit for picks)
  pickTier?: PickTier;        // for accumulate_picks
  impact?: boolean;           // acquire target must clear league top-N
  returnSpec: ReturnSpec;
  evidence: string;           // director-facing "why this goal exists"
};

// Acquire-side kinds the matcher pairs against partner spendable pools. `shed`
// is intentionally NOT here — it feeds OUR spendable pool (a means), not an
// acquire target, so the matcher iterates only these.
export const ACQUIRE_GOAL_KINDS: ReadonlySet<GoalKind> = new Set<GoalKind>([
  "accumulate_picks",
  "add_youth",
  "fill_need",
  "acquire_impact",
  "insurance",
  "teardown",
]);

// ── Thesis — a storyline (source × timeline) ─────────────────────────────────
//
// Intent and engine theses are fully independent: own goals, own fence, own
// offers. They never share assets or logic. An engine move that points the same
// direction as the owner's plan does NOT fold into the intent thesis.
export type Thesis = {
  id: string;                 // `${source}:${timeline}`
  source: ThesisSource;
  timeline: Timeline;
  headline: string;
  pitch: string;
  goals: Goal[];
  sacred: Set<string>;        // asset keys this story will NOT trade away
  spendable: Set<string>;     // asset keys this story may spend as currency
};

// ── Roster read — the evidence theses + goals are built from ─────────────────
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
export type NeedPosition = {
  bucket: NeedBucket;
  severity: NeedLevel; // "med" | "high" (low buckets are not needs)
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
export type ContenderUpgrade = {
  bucket: NeedBucket;
  tierJump: "playoff" | "championship";
  studValueUsed: number;
  currentLineupValue: number;
  hypotheticalValue: number;
  cutCrossed: number;
  reason: string;
};

// The two axes the engine-thesis decision turns on, computed once per team.
// Competitiveness is league-relative (starter value vs the playoff/championship
// cuts); core age reads the nucleus.
export type Competitiveness = {
  starterValue: number;
  playoffCut: number;          // 6th-highest starter value (6 of 12 make it)
  championshipCut: number;     // 2nd-highest starter value
  weakFloor: number;           // playoffCut * weak-roster fraction
  isContender: boolean;        // starterValue >= playoffCut
  isEliteContender: boolean;   // starterValue >= championshipCut
  isWeakRoster: boolean;       // starterValue < weakFloor
};
export type CoreAge = {
  avgStarterAge: number | null;
  agingCore: boolean;          // avg >= aging floor, or relies on aging stars
  youngCore: boolean;          // avg <= young ceiling
};

export type RosterRead = {
  surpluses: SurplusPosition[];
  scarcities: ScarcityPosition[];        // already validated as REAL holes
  needBuckets: NeedPosition[];           // dial reads MED or HIGH — the positions
                                         // a win-now thesis should upgrade, funded
                                         // from the whole spend pool
  insuranceBuckets: NeedBucket[];        // positions lacking a competent backup
                                         // behind the starters (QB3 / RB3 / PC5) —
                                         // thin depth, an injury would crater it
  starterSetBuckets: NeedBucket[];       // positions where the team already has
                                         // enough impact starters (QB2/RB2/PC4) —
                                         // an extra impact body has no slot, so it
                                         // won't chase an acquire there w/o surplus
  worstOptimalStarter: WorstOptimalStarter;
  agingStarsAtPeak: AgingStarAtPeak[];
  offTimelineVets: OffTimelineVet[];
  buriedYoungPlayers: BuriedYoungPlayer[];
  contenderUpgrades: ContenderUpgrade[];
  competitiveness: Competitiveness;
  coreAge: CoreAge;
  playoffHistory: PlayoffHistory | null; // last-two-seasons tiebreaker signal
};

// ── The bundle ───────────────────────────────────────────────────────────────
export type NarrativeBundle = {
  rosterId: string;
  teamName: string;
  identitySentence: string;
  intentSignals: IntentSignals;
  rosterRead: RosterRead;
  theses: Thesis[];
};

// Re-exported so the narrative layer stays the one stop for its types.
export type { PositionIntent, PicksIntent } from "./intent";
export type { IntentSignals };