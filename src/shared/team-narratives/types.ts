import type { Position } from "@/shared/league-data";
import type { NeedBucket } from "@/shared/team-profiles";

// ── Archetypes ────────────────────────────────────────────────────────────

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

export type Flavor =
  | "depth_cliff"
  | "surplus_of_quality"
  | "pick_trade_back"
  | "contender"
  | "rebuilder"
  | null;

export const ARCHETYPE_OPPOSITES: Record<ArchetypeName, ArchetypeName[]> = {
  consolidate: ["de_consolidate", "reset", "sell_high_star", "vet_liquidation"],
  de_consolidate: ["consolidate", "win_now_push", "insurance"],
  win_now_push: ["de_consolidate", "reset", "sell_high_star", "vet_liquidation"],
  reset: ["consolidate", "win_now_push"],
  sell_high_star: ["consolidate", "win_now_push"],
  vet_liquidation: ["consolidate", "win_now_push", "insurance"],
  insurance: ["de_consolidate", "vet_liquidation"],
  stand_pat: [],
};

// ── Wants clarity ─────────────────────────────────────────────────────────

export type WantsGrade = "clear" | "noise";
export type WantsDirection = "accumulate" | "convert" | null;

export type WantsClarity = {
  grade: WantsGrade;
  direction: WantsDirection;
  raw: string[];
};

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

export type NarrativeBundle = {
  rosterId: string;
  teamName: string;
  identitySentence: string;
  wantsClarity: WantsClarity;
  rosterRead: RosterRead;
  firedNarratives: FiredNarrative[];
  crossNotes: string[];
};