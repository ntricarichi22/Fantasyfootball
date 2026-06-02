import type { LeagueData } from "@/shared/league-data";
import type { NeedBucket, TeamProfile, TeamNeeds } from "@/shared/team-profiles";
import type { TeamDossier } from "@/shared/team-dossier";
import type { GoalKind, NarrativeBundle } from "@/shared/team-narratives";

// The bucket an asset belongs to; picks are their own thing.
export type AnchorBucket = NeedBucket | "PICK";

// A reference to a satisfied goal (used for the two-sided check).
export type GoalRef = {
  rosterId: string;
  thesisId: string;
  goalId: string;
  kind: GoalKind;
};

// Ranking inputs, kept separate (never summed) so the director can narrate.
export type RankReasons = {
  // Does the deal satisfy a goal on BOTH sides? The dominant ranking signal.
  bothSidesSatisfied: boolean;
  // The partner's need severity at the filling asset's bucket (0..1), if any.
  partnerNeedSeverity: number | null;
  // Value of the filling asset — best fit floats up within a goal.
  fillValue: number;
};

// A goal-level match: one of OUR goals against an asset sitting in another
// team's thesis spendable pool. The deal closes cleanly only when our payment
// also satisfies one of the partner's goals (partnerGoalSatisfied != null);
// otherwise it is surfaced but flagged one-sided. Realism lives in the
// narration, not in suppression.
export type Match = {
  ourRosterId: string;
  ourThesisId: string;
  ourGoalId: string;
  ourGoalKind: GoalKind;
  ourBucket: AnchorBucket | null;

  partnerRosterId: string;
  partnerTeam: string;
  partnerThesisId: string;
  partnerAssetKey: string;
  partnerAssetLabel: string;

  fillsOurGoal: true;
  partnerGoalSatisfied: GoalRef | null;

  rankReasons: RankReasons;
  why: string;
};

export type TeamSlate = {
  rosterId: string;
  team: string;
  matches: Match[];
};

// The matcher reads these already-built shared layers and recomputes nothing.
export type MatchInput = {
  data: LeagueData;
  profiles: TeamProfile[];
  needs: Map<string, TeamNeeds>;
  dossiers: TeamDossier[];
  bundles: Map<string, NarrativeBundle>;
};