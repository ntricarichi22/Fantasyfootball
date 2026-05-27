import type { Position } from "@/shared/league-data";
import type { NeedBucket } from "@/shared/team-profiles";

// ── Archetypes ────────────────────────────────────────────────────────────
//
// The finite labeled library the narrative engine picks from. Eight active
// archetypes; the brain never improvises outside this set at runtime. New
// structural shapes are added deliberately, not generated. See
// trade_brain.docx Section 4.2 and CFC_Trade_Brain_Matrix_v2 for the full
// trigger detail.

export type ArchetypeName =
  | "consolidate"
  | "de_consolidate"
  | "win_now_push"
  | "reset"
  | "sell_high_star"
  | "vet_liquidation"
  | "insurance"
  | "stand_pat";

export const ARCHETYPES: ArchetypeName[] = [
  "consolidate",
  "de_consolidate",
  "win_now_push",
  "reset",
  "sell_high_star",
  "vet_liquidation",
  "insurance",
  "stand_pat",
];

// Whether the team is the one shipping the anchor (seller) or the one funding
// it (buyer). Stand-pat is the null action — no role because no trade.
export type NarrativeRole = "seller" | "buyer" | "null_action";

export const ARCHETYPE_ROLE: Record<ArchetypeName, NarrativeRole> = {
  consolidate: "buyer",
  de_consolidate: "seller",
  win_now_push: "buyer",
  reset: "seller",
  sell_high_star: "seller",
  vet_liquidation: "seller",
  insurance: "buyer",
  stand_pat: "null_action",
};

// Sub-flavor on archetypes that have multiple trigger-defined variants.
// De-consolidate has three flavors (depth-cliff, surplus-of-quality, pick
// trade-back). Sell-high-star has two (contender / rebuilder). Other
// archetypes leave this null. Pinning the flavor at fire-time lets downstream
// layers (matching, offer generation) apply the right per-flavor rules
// without re-deriving the trigger.
export type Flavor =
  | "depth_cliff"          // de-consolidate
  | "surplus_of_quality"   // de-consolidate
  | "pick_trade_back"      // de-consolidate
  | "contender"            // sell-high-star (replacement required)
  | "rebuilder"            // sell-high-star (void acceptable)
  | null;

// Opposite archetype mapping for narrative-to-narrative matching. Win-now-push
// is the shared buyer-side opposite for several sell-side archetypes (reset,
// sell-high, vet-liquidation) — that asymmetry is real (a league has few
// contenders and many sellers competing for their capital). Stand-pat has no
// opposite because it's the absence of a trade. See trade_brain.docx
// Section 4.1.
//
// This is a COARSE filter. It says "these buyer/seller archetypes could
// currency-match." The matching layer does the actual fit check (need
// severity, currency availability, window complementarity).
export const ARCHETYPE_OPPOSITES: Record<ArchetypeName, ArchetypeName[]> = {
  consolidate: ["de_consolidate", "reset", "sell_high_star", "vet_liquidation"],
  de_consolidate: ["consolidate", "win_now_push", "insurance"],
  win_now_push: ["de_consolidate", "reset", "sell_high_star", "vet_liquidation"],
  reset: ["consolidate", "win_now_push"],
  sell_high_star: ["consolidate", "win_now_push"],
  vet_liquidation: ["consolidate", "win_now_push"],
  insurance: ["de_consolidate"],
  stand_pat: [],
};

// ── Wants clarity ─────────────────────────────────────────────────────────
//
// The very first interpretive read on every team. The owner's wantsMore
// array is graded for clarity BEFORE any archetype is considered. CLEAR
// signals (1-2 internally coherent wants) establish a direction; NOISE
// signals (3+ wants OR contradictory pairs like picks+studs) are dropped
// and the brain reasons from the roster alone. See trade_brain.docx
// Section 3.2.

export type WantsGrade = "clear" | "noise";

export type WantsDirection = "accumulate" | "convert" | null;

export type WantsClarity = {
  grade: WantsGrade;
  direction: WantsDirection;
  // The raw wantsMore array that produced this read — preserved for audit
  // and for the director.
  raw: string[];
};

// ── Roster read (team-level facts the brain extracts) ─────────────────────
//
// The structured findings the brain produces from the bodies, INDEPENDENT of
// what the owner said via wants. These power both archetype triggers and
// downstream offer-generation pool composition. Phantom-signal corrections
// (Section 3.5) have already been applied — anything that survives this read
// is real, not a dial artifact.

// A position where the team has more startable-grade quality than it can
// use. Computed against the team's own optimal lineup: surplus = startable-
// grade pieces NOT currently in the optimal lineup at this position.
export type SurplusPosition = {
  bucket: NeedBucket;
  surplusPlayerIds: string[]; // sleeper IDs, ordered by descending value
  reason: string;             // brief explanation for the director
};

// A position where the team has a real hole. May or may not match what the
// raw need dials suggest — phantom-signal corrections suppress false alarms
// (e.g. a depth dial behind two studs is not a real scarcity).
export type ScarcityPosition = {
  bucket: NeedBucket;
  severity: "med" | "high";   // low needs are not "scarcities"
  currentStarterIds: string[];
  reason: string;
};

// The team's weakest piece in its OWN optimal starting lineup — the slot a
// 1-for-2 de-consolidate variant would target as the upgrade. Read directly
// from StrengthBreakdown.lineup.
export type WorstOptimalStarter = {
  playerId: string;
  name: string;
  position: Position;
  slot: string;   // e.g. "WR3", "FLEX"
  value: number;
} | null;

// Aging stars whose value is at/near peak — candidates for sell-high-star.
// Position aging thresholds: QB >= 33, RB >= 27, WR/TE >= 30 (from
// asset-values/age.ts).
export type AgingStarAtPeak = {
  playerId: string;
  name: string;
  position: Position;
  age: number;
  value: number;
};

// Vets whose age doesn't fit the team's trajectory — candidates for
// vet-liquidation. Off-timeline = aging or fading-value on a young/rebuilding
// team. Daniel Jones on the Freaks is the canonical example.
export type OffTimelineVet = {
  playerId: string;
  name: string;
  position: Position;
  age: number;
  value: number;
};

// Young players the team can't fit in its optimal lineup — TRADEABLE
// CURRENCY in buyer recipes that pay in picks (consolidate, win-now-push).
// Definition: young (per the isYoung helper in asset-values/age.ts) AND
// value sits below the team's worst optimal starter at the young player's
// position. See trade_brain.docx Section 4.2.3 (buried-young-as-currency).
export type BuriedYoungPlayer = {
  playerId: string;
  name: string;
  position: Position;
  age: number;
  value: number;
};

// Phantom-signal corrections that were applied while building this read.
// Surfaced so the director can explain "we ignored what looks like a QB
// cliff because you have two studs starting there" — and so the engine's
// behavior is auditable.
export type PhantomCorrection = {
  rule:
    | "depth_dial_behind_two_studs"
    | "need_dial_in_front_of_aging_roster"
    | "high_value_is_not_surplus";
  description: string;
};

export type RosterRead = {
  surpluses: SurplusPosition[];
  scarcities: ScarcityPosition[];
  worstOptimalStarter: WorstOptimalStarter;
  agingStarsAtPeak: AgingStarAtPeak[];
  offTimelineVets: OffTimelineVet[];
  buriedYoungPlayers: BuriedYoungPlayer[];
  phantomCorrections: PhantomCorrection[];
};

// ── Fired narratives ──────────────────────────────────────────────────────
//
// One entry per archetype that genuinely triggered for this team. Multiple
// can fire (Matzo fires several). Stand-pat fires alone for teams whose only
// honest answer is patience. The brain never forces an archetype to fire
// and never suppresses one that legitimately fires. See trade_brain.docx
// Sections 3.4 and 4.2.

export type FiredNarrative = {
  archetype: ArchetypeName;
  role: NarrativeRole;
  flavor: Flavor;
  // Human-readable label, cites the matrix row that fired
  // (e.g. "de_consolidate / depth-cliff: Burrow on superflex roster").
  triggerScenario: string;
  // Why this fired — the data points that triggered it, in plain English
  // for the director and for audit.
  evidence: string;
  // Anchor candidates / eligibility list. Sleeper IDs for players and
  // pick-key strings for picks (e.g. "pick:2027-1-2"). Same key shape the
  // engine uses everywhere.
  assets: string[];
  // Brief description of the expected return shape for the director
  // (e.g. "replacement QB at anchor position + picks/young at our need").
  returnShape: string;
};

// ── The bundle ────────────────────────────────────────────────────────────
//
// The output of the team-narratives module — one bundle per team in the
// league. Every downstream tool (Builder, Studio, Scouting) reads these;
// they do not redo the reasoning. See trade_brain.docx Section 3.6.

export type NarrativeBundle = {
  rosterId: string;
  teamName: string;
  identitySentence: string;   // one-sentence GM-style summary
  wantsClarity: WantsClarity;
  rosterRead: RosterRead;
  firedNarratives: FiredNarrative[];
  // Cross-narrative interactions and guardrails
  // (e.g. "the QB depth-cliff argues against the reset narrative; treat as
  // a guardrail rather than an active insurance buy").
  crossNotes: string[];
};