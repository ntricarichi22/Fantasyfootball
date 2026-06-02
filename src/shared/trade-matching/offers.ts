import { construct, type EngineContext } from "@/pro-personnel/engine";
import type { DealRequest, EngineOffer, ReturnAim, Bucket } from "@/pro-personnel/engine";
import type { Goal, ReturnSpec, Thesis } from "@/shared/team-narratives";
import type { Match, TeamSlate } from "./types";

// Offer generation = the bridge from goal-level matches to the deal
// constructor. A match already decided WHICH goal, WHICH partner, and the asset
// that fills our goal; construct.ts owns building the package, balancing,
// pricing both seats, safety, and ranking. This file points each thesis's
// spendable pool at each goal and emits the WAYS — one DealRequest per way, with
// the goal's returnSpec as the aim and the thesis fence as the currency rule.

// Per-goal variety: don't clone a received body across ways; cap the slate.
const MAX_OFFERS_PER_GOAL = 8;

// Brain returnSpec → engine ReturnAim. NeedBucket ⊂ engine Bucket, so the
// bucket arrays pass straight through; brain-only fields (impactBucket,
// winNowStarterUpgrade) are enforced here in offer-gen, not by the constructor.
function toReturnAim(rs: ReturnSpec): ReturnAim {
  return {
    requireBackfill: rs.requireBackfill as Bucket | undefined,
    preferPickTier: rs.preferPickTier,
    preferBuckets: rs.preferBuckets as Bucket[] | undefined,
    youthBuckets: rs.youthBuckets as Bucket[] | undefined,
    strength: rs.strength,
  };
}

function base(
  ourTeamId: string,
  partnerId: string,
): Omit<DealRequest, "anchors" | "leans"> {
  return {
    ourTeamId,
    offeringTeamId: ourTeamId,
    intent: "acquire",
    counterparty: { mode: "locked", teamIds: [partnerId] },
    aimAt: "us",
  };
}

// Our optimal-lineup starters and their values — for the win-now starter guard
// rail: shipping a starter is allowed only for a genuine upgrade back.
function optimalStarterValues(ec: EngineContext, rosterId: string): Map<string, number> {
  const profile = ec.profiles.find((p) => p.rosterId === rosterId);
  const m = new Map<string, number>();
  for (const s of profile?.strength.lineup ?? []) if (s.playerId) m.set(s.playerId, s.value);
  return m;
}

// Win-now starter guard rail: if we ship an optimal-lineup starter, the best
// player we get back must beat the worst starter we sent. No starter shipped →
// always fine.
function passesStarterUpgrade(offer: EngineOffer, ec: EngineContext, rosterId: string): boolean {
  const starters = optimalStarterValues(ec, rosterId);
  const sentStarterVals = offer.assets
    .filter((a) => a.side === "send" && a.type === "player" && starters.has(a.key))
    .map((a) => starters.get(a.key)!);
  if (sentStarterVals.length === 0) return true;
  const worstSent = Math.min(...sentStarterVals);
  const bestRecv = Math.max(
    0,
    ...offer.assets
      .filter((a) => a.side === "receive" && a.type === "player")
      .map((a) => ec.data.values.value.get(a.key) ?? 0),
  );
  return bestRecv > worstSent;
}

// The received players in an offer (for per-goal dedupe).
function receivedPlayerKeys(offer: EngineOffer): string[] {
  return offer.assets.filter((a) => a.side === "receive" && a.type === "player").map((a) => a.key);
}

export type GeneratedOffer = {
  thesisId: string;
  goalId: string;
  goalKind: Goal["kind"];
  partnerTeam: string;
  bothSidesSatisfied: boolean;
  offer: EngineOffer;
};

export type GoalOffers = {
  goal: Goal;
  offers: GeneratedOffer[];
};

export type ThesisOffers = {
  thesis: Thesis;
  goals: GoalOffers[];
};

// One match → one receive-anchored DealRequest: acquire the asset that fills our
// goal, fenced by the thesis's spendable pool, aimed by the goal's returnSpec.
function requestForMatch(match: Match, goal: Goal, thesis: Thesis): DealRequest {
  return {
    ...base(match.ourRosterId, match.partnerRosterId),
    anchors: [{ key: match.partnerAssetKey, side: "receive" }],
    leans: [],
    returnShape: toReturnAim(goal.returnSpec),
    spendable: thesis.spendable, // authoritative over posture pick-protection
    ...(goal.kind === "insurance" ? { dealKind: "insurance" as const } : {}),
  };
}

export function generateOffersForTeam(slate: TeamSlate, ec: EngineContext): ThesisOffers[] {
  const bundle = ec.bundles?.get(slate.rosterId);
  const theses = bundle?.theses ?? [];
  if (theses.length === 0) return [];

  const byThesisId = new Map<string, Thesis>(theses.map((t) => [t.id, t]));

  // Group matches by thesis → goal.
  const matchesByGoal = new Map<string, Match[]>(); // key = `${thesisId}|${goalId}`
  for (const m of slate.matches) {
    const k = `${m.ourThesisId}|${m.ourGoalId}`;
    const arr = matchesByGoal.get(k) ?? [];
    arr.push(m);
    matchesByGoal.set(k, arr);
  }

  const out: ThesisOffers[] = [];

  for (const thesis of theses) {
    const goalOffers: GoalOffers[] = [];

    for (const goal of thesis.goals) {
      const matches = matchesByGoal.get(`${thesis.id}|${goal.id}`) ?? [];
      if (matches.length === 0) continue;

      // Best-fit (and both-sides-satisfied) matches first, so the strongest ways
      // anchor the goal before the variety cap trims.
      const ordered = matches.slice().sort((a, b) => {
        if (a.rankReasons.bothSidesSatisfied !== b.rankReasons.bothSidesSatisfied) {
          return a.rankReasons.bothSidesSatisfied ? -1 : 1;
        }
        return b.rankReasons.fillValue - a.rankReasons.fillValue;
      });

      const collected: GeneratedOffer[] = [];
      const usedReceived = new Set<string>(); // per-goal received-player dedupe

      for (const match of ordered) {
        if (collected.length >= MAX_OFFERS_PER_GOAL) break;

        const req = requestForMatch(match, goal, thesis);
        const result = construct(req, ec);

        for (const offer of result.offers) {
          if (collected.length >= MAX_OFFERS_PER_GOAL) break;
          // Lock to the matched partner.
          if (offer.partnerTeamId !== match.partnerRosterId) continue;
          // Fence: no sacred asset may leave (defensive; construct already has it).
          if (offer.assets.some((a) => a.side === "send" && !thesis.spendable.has(a.key))) continue;
          // Win-now starter guard rail.
          if (goal.returnSpec.winNowStarterUpgrade && !passesStarterUpgrade(offer, ec, slate.rosterId)) {
            continue;
          }
          // Variety: don't surface the same received body twice within the goal.
          const recv = receivedPlayerKeys(offer);
          if (recv.some((k) => usedReceived.has(k))) continue;
          for (const k of recv) usedReceived.add(k);

          collected.push({
            thesisId: thesis.id,
            goalId: goal.id,
            goalKind: goal.kind,
            partnerTeam: match.partnerTeam,
            bothSidesSatisfied: match.rankReasons.bothSidesSatisfied,
            offer,
          });
        }
      }

      if (collected.length === 0) continue;

      // Rank within the goal: both-sides-satisfied float to the top (most likely
      // to land), then by the engine's own score.
      collected.sort((a, b) => {
        if (a.bothSidesSatisfied !== b.bothSidesSatisfied) return a.bothSidesSatisfied ? -1 : 1;
        return b.offer.score - a.offer.score;
      });

      goalOffers.push({ goal, offers: collected });
    }

    if (goalOffers.length > 0) out.push({ thesis, goals: goalOffers });
  }

  return out;
}