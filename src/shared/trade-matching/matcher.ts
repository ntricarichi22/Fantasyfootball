import type { LeagueData, PlayerInfo } from "@/shared/league-data";
import type { NeedBucket, ImpactSets, ScrubSets } from "@/shared/team-profiles";
import { bucketOf, buildImpactSets, buildScrubSets } from "@/shared/team-profiles";
import { isYoung } from "@/shared/asset-values";
import {
  ACQUIRE_GOAL_KINDS,
  type Goal,
  type NarrativeBundle,
} from "@/shared/team-narratives";

import type { AnchorBucket, GoalRef, Match, MatchInput, RankReasons, TeamSlate } from "./types";

// Insurance wants a cheap proven backup — above legitimate backup arms, below
// franchise starters. The league-relative impact bar (top-N by value at a
// bucket) is the shared definition in team-profiles (buildImpactSets).
const INSURANCE_TARGET_CEILING = 200;

function bucketKey(bucket: NeedBucket): "qb" | "rb" | "passCatcher" {
  return bucket === "QB" ? "qb" : bucket === "RB" ? "rb" : "passCatcher";
}
function isPickKey(key: string): boolean {
  return key.startsWith("pick:");
}
function resolvePlayer(data: LeagueData, key: string): PlayerInfo | null {
  return data.players.get(key) ?? null;
}
function valueOf(data: LeagueData, key: string): number {
  return data.values.value.get(key) ?? 0;
}
function isStud(data: LeagueData, key: string): boolean {
  return data.values.isStud.get(key) ?? false;
}
function assetBucket(data: LeagueData, key: string): AnchorBucket | null {
  if (isPickKey(key)) return "PICK";
  const p = resolvePlayer(data, key);
  return p ? bucketOf(p.position) : null;
}
function assetLabel(data: LeagueData, key: string): string {
  return resolvePlayer(data, key)?.name ?? key;
}
function findPick(data: LeagueData, rosterId: string, key: string) {
  return (data.pickOwnership.get(rosterId) ?? []).find((p) => p.key === key);
}

// Does `assetKey` (owned by `ownerRosterId`) satisfy `goal`'s returnSpec? This
// is the single predicate used BOTH to find partner assets that fill our goal
// AND to check whether our payment fills one of their goals. `shed` is not an
// acquire goal, so it never matches here.
function assetFitsGoal(
  data: LeagueData,
  impactSets: ImpactSets,
  scrubSets: ScrubSets,
  assetKey: string,
  goal: Goal,
  ownerRosterId: string,
): boolean {
  switch (goal.kind) {
    case "accumulate_picks": {
      if (!isPickKey(assetKey)) return false;
      const pick = findPick(data, ownerRosterId, assetKey);
      if (!pick) return false;
      const tier = goal.pickTier ?? "any";
      if (tier === "premium") return pick.round === 1;
      if (tier === "future") return pick.kind === "future";
      return true;
    }
    case "add_youth":
    case "fill_need": {
      const p = resolvePlayer(data, assetKey);
      if (!p) return false;
      if (goal.bucket && bucketOf(p.position) !== goal.bucket) return false;
      // youth-aimed fills require a young, non-stud body
      if ((goal.returnSpec.youthBuckets?.length ?? 0) > 0) {
        return isYoung(p.position, p.age, p.exp) && !isStud(data, assetKey);
      }
      return true;
    }
    case "acquire_impact": {
      const p = resolvePlayer(data, assetKey);
      if (!p) return false;
      const b = bucketOf(p.position);
      if (!b) return false;
      if (goal.bucket && b !== goal.bucket) return false;
      return impactSets.get(b)?.has(assetKey) ?? false;
    }
    case "insurance": {
      const p = resolvePlayer(data, assetKey);
      if (!p) return false;
      const b = bucketOf(p.position);
      if (!b || (goal.bucket && b !== goal.bucket)) return false;
      // "A proven guy who'd step in and start" = a real backup-TIER body: NOT a
      // scrub (inside the league startable depth, so clipboard guys are out), not a
      // stud, not a young building block. Upper bound differs by position: QB depth
      // matters in superflex (QB2 is a starter), so a low-end starter (Murray/Darnold,
      // value <= ceiling) still counts; for RB/PC a backup is simply NON-impact
      // (outside the starting tier).
      if (scrubSets.get(b)?.has(assetKey)) return false;
      if (isStud(data, assetKey) || isYoung(p.position, p.age, p.exp)) return false;
      const v = valueOf(data, assetKey);
      if (v <= 0) return false;
      if (b === "QB") return v <= INSURANCE_TARGET_CEILING;
      return !(impactSets.get(b)?.has(assetKey) ?? false);
    }
    case "teardown": {
      // Cashing a stud for a haul: the bounty is partner PICKS, optionally a young
      // non-stud building block.
      if (isPickKey(assetKey)) return true;
      const p = resolvePlayer(data, assetKey);
      if (!p) return false;
      return isYoung(p.position, p.age, p.exp) && !isStud(data, assetKey);
    }
    default:
      return false;
  }
}

// Two-sided check: does any asset in OUR spendable pool (for this thesis)
// satisfy one of the PARTNER's acquire goals? Returns the first match — the
// reason they'd bite — or null (one-sided / long-shot).
function findPartnerGoalSatisfied(
  data: LeagueData,
  impactSets: ImpactSets,
  scrubSets: ScrubSets,
  ourSpendable: Set<string>,
  partner: NarrativeBundle,
  ourRosterId: string,
): GoalRef | null {
  for (const pThesis of partner.theses) {
    for (const pGoal of pThesis.goals) {
      if (!ACQUIRE_GOAL_KINDS.has(pGoal.kind)) continue;
      for (const ourAsset of ourSpendable) {
        if (assetFitsGoal(data, impactSets, scrubSets, ourAsset, pGoal, ourRosterId)) {
          return { rosterId: partner.rosterId, thesisId: pThesis.id, goalId: pGoal.id, kind: pGoal.kind };
        }
      }
    }
  }
  return null;
}

export function buildMatchSlates(input: MatchInput): Map<string, TeamSlate> {
  const { data, needs, bundles } = input;
  const impactSets = buildImpactSets(data);
  const scrubSets = buildScrubSets(data);
  const slates = new Map<string, TeamSlate>();

  for (const [rosterId, active] of bundles) {
    const matches: Match[] = [];
    const seen = new Set<string>(); // dedupe (goal|partner|asset)

    for (const ourThesis of active.theses) {
      const ourSpendable = ourThesis.spendable;

      for (const goal of ourThesis.goals) {
        if (!ACQUIRE_GOAL_KINDS.has(goal.kind)) continue;

        for (const [partnerId, partner] of bundles) {
          if (partnerId === rosterId) continue;

          // Partner assets their storyline is willing to move, deduped across
          // their theses (an asset spendable in two of their stories is one
          // asset). Record the first thesis it appeared in.
          const partnerAssets = new Map<string, string>(); // assetKey -> partnerThesisId
          for (const pThesis of partner.theses) {
            for (const a of pThesis.spendable) {
              if (!partnerAssets.has(a)) partnerAssets.set(a, pThesis.id);
            }
          }

          for (const [assetKey, partnerThesisId] of partnerAssets) {
            if (!assetFitsGoal(data, impactSets, scrubSets, assetKey, goal, partnerId)) continue;

            const dedupe = `${goal.id}|${partnerId}|${assetKey}`;
            if (seen.has(dedupe)) continue;
            seen.add(dedupe);

            const partnerGoalSatisfied = findPartnerGoalSatisfied(
              data,
              impactSets,
              scrubSets,
              ourSpendable,
              partner,
              rosterId,
            );

            const bk = assetBucket(data, assetKey);
            const partnerNeedSeverity =
              bk && bk !== "PICK" ? needs.get(partnerId)?.[bucketKey(bk)].score ?? null : null;
            const fillValue = valueOf(data, assetKey);

            const rankReasons: RankReasons = {
              bothSidesSatisfied: partnerGoalSatisfied !== null,
              partnerNeedSeverity,
              fillValue,
            };

            const label = assetLabel(data, assetKey);
            const why =
              partnerGoalSatisfied !== null
                ? `${partner.teamName} will move ${label} (fills our ${goal.kind}); we can pay into their ${partnerGoalSatisfied.kind}.`
                : `${partner.teamName} will move ${label} (fills our ${goal.kind}); great for us, but they have no clear reason to bite yet.`;

            matches.push({
              ourRosterId: rosterId,
              ourThesisId: ourThesis.id,
              ourGoalId: goal.id,
              ourGoalKind: goal.kind,
              ourBucket: goal.bucket ?? (goal.kind === "accumulate_picks" ? "PICK" : null),
              partnerRosterId: partnerId,
              partnerTeam: partner.teamName,
              partnerThesisId,
              partnerAssetKey: assetKey,
              partnerAssetLabel: label,
              fillsOurGoal: true,
              partnerGoalSatisfied,
              rankReasons,
              why,
            });
          }
        }
      }
    }

    slates.set(rosterId, { rosterId, team: active.teamName, matches });
  }

  return slates;
}