import type { LeagueData } from "@/shared/league-data";
import type { NeedBucket, TeamProfile, TeamNeeds } from "@/shared/team-profiles";
import type { TeamDossier } from "@/shared/team-dossier";
import type { ArchetypeName, Flavor, NarrativeBundle } from "@/shared/team-narratives";

// The bucket a headline piece belongs to. Players resolve to a need bucket;
// draft picks are their own thing.
export type AnchorBucket = NeedBucket | "PICK";

// Every match is described from the ACTIVE team's seat: are we the one
// shipping the headline piece, or the one acquiring it.
export type Side = "we_sell" | "we_buy";

export type CurrencyMatch = "strong" | "partial" | "weak";
export type WindowComplement = "clean" | "same_window";
export type MatchTier = 1 | 2;

// The three ranking dimensions, kept as a tuple (never summed into one score)
// so the director can narrate the WHY — "most desperate buyer, but pick-poor."
export type RankReasons = {
  // The partner's need score at the anchor's bucket. Higher = more desperate.
  // null on buy-side matches (desperation is ours, constant across partners)
  // and on pick anchors (no positional need score applies).
  needSeverity: number | null;
  // Does the partner hold the kind of currency this trade wants to move.
  currencyMatch: CurrencyMatch;
  // Contender <-> rebuilder is the cleanest pair; same-window is a small downbump.
  windowComplement: WindowComplement;
};

export type Match = {
  tier: MatchTier;
  side: Side;
  // The active team's fired narrative that drives this match.
  narrativeArchetype: ArchetypeName;
  narrativeFlavor: Flavor;
  // The thesis (story) this match belongs to, carried from the driving
  // narrative. Lets offer-gen group offers by thesis and apply that thesis's
  // currency fence. Tier-2 floor rows aren't narrative-driven; they carry the
  // active owner's intent thesis id (the market floor is the owner's plan).
  thesisId?: string;
  // The headline piece changing hands — a player name or a pick label.
  anchor: string;
  // The raw asset key for the anchor (player id or pick key), for offer-gen to
  // seed the constructor. Empty for tier-2 floor rows (no concrete piece yet).
  anchorKey: string;
  anchorBucket: AnchorBucket;
  partnerRosterId: string;
  partnerTeam: string;
  // The opposite narrative actually firing on the partner. null for tier-2
  // floor matches, which are intent/need-driven rather than narrative-driven.
  partnerArchetype: ArchetypeName | null;
  reasons: RankReasons;
  why: string;
};

export type TeamSlate = {
  rosterId: string;
  team: string;
  // Count of narrative-driven matches across all fired narratives. Stand-pat
  // is a fired narrative but contributes zero (it's the null action).
  tier1Count: number;
  tier1: Match[];
  // Value-fit floor. Only populated when tier1Count < TIER2_THRESHOLD.
  tier2: Match[];
};

// The matcher reads these already-built shared layers and never recomputes
// the underlying facts.
export type MatchInput = {
  data: LeagueData;
  profiles: TeamProfile[];
  needs: Map<string, TeamNeeds>;
  dossiers: TeamDossier[];
  bundles: Map<string, NarrativeBundle>;
};