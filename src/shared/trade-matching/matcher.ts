import type { LeagueData, PlayerInfo } from "@/shared/league-data";
import type { NeedBucket } from "@/shared/team-profiles";
import { bucketOf } from "@/shared/team-profiles";
import { isYoung } from "@/shared/asset-values";
import {
  ACQUIRE_GOAL_KINDS,
  type Goal,
  type NarrativeBundle,
} from "@/shared/team-narratives";

import type { AnchorBucket, GoalRef, Match, MatchInput, RankReasons, TeamSlate } from "./types";

// Insurance wants a cheap proven backup — above legitimate backup arms, below
// franchise starters. League-relative impact bars (top-N by value at a bucket).
const INSURANCE_TARGET_CEILING = 200;
const IMPACT_TOPN: Record<NeedBucket, number> = { QB: 20, RB: 20, PASS_CATCHER: 40 };

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

// Precompute the league top-N impact set per bucket once (avoids an O(players)
// scan per candidate). A player is "impact" if he's top-N by value at his bucket.
function buildImpactSets(data: LeagueData): Map<NeedBucket, Set<string>> {
  const byBucket = new Map<NeedBucket, Array<{ id: string; v: number }>>();
  for (const t of data.teams) {
    for (const pid of t.playerIds) {
      const p = data.players.get(pid);
      if (!p) continue;
      const b = bucketOf(p.position);
      if (!b) continue;
      const arr = byBucket.get(b) ?? [];
      arr.push({ id: pid, v: data.values.value.get(pid) ?? 0 });
      byBucket.set(b, arr);
    }
  }
  const out = new Map<NeedBucket, Set<string>>();
  for (const [b, arr] of byBucket) {
    arr.sort((x, y) => y.v - x.v);
    out.set(b, new Set(arr.slice(0, IMPACT_TOPN[b]).map((x) => x.id)));
  }
  return out;
}

// Does `assetKey` (owned by `ownerRosterId`) satisfy `goal`'s returnSpec? This
// is the single predicate used BOTH to find partner assets that fill our goal
// AND to check whether our payment fills one of their goals. `shed` is not an
// acquire goal, so it never matches here.
function assetFitsGoal(
  data: LeagueData,
  impactSets: Map<NeedBucket, Set<string>>,
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
        return isYoung(p.position, p.age) && !isStud(data, assetKey);
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
      if (!p || p.position !== "QB") return false;
      const v = valueOf(data, assetKey);
      return !isStud(data, assetKey) && !isYoung(p.position, p.age) && v > 0 && v <= INSURANCE_TARGET_CEILING;
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
  impactSets: Map<NeedBucket, Set<string>>,
  ourSpendable: Set<string>,
  partner: NarrativeBundle,
  ourRosterId: string,
): GoalRef | null {
  for (const pThesis of partner.theses) {
    for (const pGoal of pThesis.goals) {
      if (!ACQUIRE_GOAL_KINDS.has(pGoal.kind)) continue;
      for (const ourAsset of ourSpendable) {
        if (assetFitsGoal(data, impactSets, ourAsset, pGoal, ourRosterId)) {
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
            if (!assetFitsGoal(data, impactSets, assetKey, goal, partnerId)) continue;

            const dedupe = `${goal.id}|${partnerId}|${assetKey}`;
            if (seen.has(dedupe)) continue;
            seen.add(dedupe);

            const partnerGoalSatisfied = findPartnerGoalSatisfied(
              data,
              impactSets,
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