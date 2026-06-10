import { construct, type EngineContext } from "@/pro-personnel/engine";
import type { DealRequest, EngineOffer, ReturnAim, Bucket } from "@/pro-personnel/engine";
import { valueAsset, isYoung } from "@/shared/asset-values";
import type { Goal, GoalKind, ReturnSpec, SurplusPosition, Thesis, NarrativeBundle } from "@/shared/team-narratives";
import { ACQUIRE_GOAL_KINDS } from "@/shared/team-narratives";
import type { NeedBucket, ScrubSets, ImpactSets } from "@/shared/team-profiles";
import { bucketOf, buildScrubSets, buildImpactSets } from "@/shared/team-profiles";
import type { Match, TeamSlate, GoalRef } from "./types";
import { assetFitsGoal } from "./matcher";

// Offer generation = the bridge from goal-level matches to the deal
// constructor. A match already decided WHICH goal, WHICH partner, and the asset
// that fills our goal; construct.ts owns building the package, balancing,
// pricing both seats, safety, and ranking. This file points each thesis's
// spendable pool at each goal and emits the WAYS — one DealRequest per way, with
// the goal's returnSpec as the aim and the thesis fence as the currency rule.

// Per-goal variety: don't clone a received body across ways; cap the slate.
const MAX_OFFERS_PER_GOAL = 8;
// For a consolidation, how many distinct depth pieces to lead with per target, so
// the same upgrade surfaces several funding shapes (Tuten->X, Harvey->X, picks->X).
const MAX_ANCHORS_PER_TARGET = 3;
// A teardown cashes EVERY crown jewel, not just the most valuable one — so each
// stud gets its own independent slate (a few buyer options apiece) instead of the
// top stud eating the whole goal cap. Overall ceiling keeps a deep fire-sale legible.
const TEARDOWN_OFFERS_PER_STUD = 2;
const MAX_TEARDOWN_OFFERS = 30;

// Goals funded by LIQUIDATING our own pieces (cash vets for picks / young
// bodies). These are the ones whose SEND side we rotate across our vet currency
// so one chip doesn't anchor every offer.
const LIQUIDATION_FUNDED = new Set<Goal["kind"]>(["accumulate_picks", "add_youth"]);

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

// Our vet currency for a liquidation-funded goal: spendable PLAYERS at the
// buckets the storyline is buying youth at or shedding (the positions in play),
// highest value first. This is what we rotate across the send side so the menu
// spreads — DJ Moore, Shaheed, etc. each headline a deal — instead of the
// balancer shipping the same nearest-value RB every time. Seeding one of these
// as a send ANCHOR also bypasses construct's "don't ship a position you're
// buying" fill-pool gate, which otherwise filters out every pass-catcher when
// the PC market is buy — the reason an aging WR never surfaced as currency.
function liquidationCurrency(thesis: Thesis, ec: EngineContext, scrubSets: ScrubSets): string[] {
  const buckets = new Set<NeedBucket>();
  for (const g of thesis.goals) {
    if ((g.kind === "add_youth" || g.kind === "shed") && g.bucket) buckets.add(g.bucket);
  }
  if (buckets.size === 0) return [];
  const out: Array<{ key: string; value: number }> = [];
  for (const key of thesis.spendable) {
    const p = ec.data.players.get(key);
    if (!p) continue; // picks aren't currency for the vet flip
    const b = bucketOf(p.position);
    if (!b || !buckets.has(b)) continue;
    // Never headline a deal with a scrub (outside his position's startable depth) —
    // a dead-weight body has no market.
    if (scrubSets.get(b)?.has(key)) continue;
    out.push({ key, value: ec.data.values.value.get(key) ?? 0 });
  }
  out.sort((a, b) => b.value - a.value);
  return out.map((x) => x.key);
}


// Same-bucket spendable depth (non-scrub), best value first — the consolidation
// currency for an `acquire_impact` goal at a bucket we are DEEP in. Seeding one as
// a send anchor makes the package lead with our OWN depth (ship Tuten for a better
// RB; ship a spare QB for a better QB) instead of whatever nearest-value body the
// balancer would otherwise grab.
function consolidationDepth(
  bucket: NeedBucket,
  thesis: Thesis,
  ec: EngineContext,
  scrubSets: ScrubSets,
): string[] {
  const scrubs = scrubSets.get(bucket);
  const out: Array<{ key: string; value: number }> = [];
  for (const key of thesis.spendable) {
    const p = ec.data.players.get(key);
    if (!p || bucketOf(p.position) !== bucket) continue;
    if (scrubs?.has(key)) continue;
    out.push({ key, value: ec.data.values.value.get(key) ?? 0 });
  }
  out.sort((a, b) => b.value - a.value);
  return out.map((x) => x.key);
}

// Send-anchor candidates for an `acquire_impact` goal — the pieces we lead with to
// fund the upgrade, in priority order:
//   1. same-bucket depth, but only when we are DEEP there (a consolidation: ship a
//      position-mate up — Tuten for a better RB, a spare QB for a better QB);
//   2. our surplus at OTHER buckets (fuel — e.g. an RB-deep, QB-needy team spends
//      its RB surplus to land a QB).
// Picks fund the rest (the `null` job). Rotating these gives several funding shapes
// per target instead of one nearest-value guess.
function acquireSpendAnchors(
  bucket: NeedBucket,
  thesis: Thesis,
  ec: EngineContext,
  surpluses: SurplusPosition[],
  scrubSets: ScrubSets,
): string[] {
  const keys: string[] = [];
  const deepHere = surpluses.some((s) => s.bucket === bucket);
  if (deepHere) keys.push(...consolidationDepth(bucket, thesis, ec, scrubSets));
  for (const s of surpluses) {
    if (s.bucket === bucket) continue;
    for (const id of s.surplusPlayerIds) {
      if (thesis.spendable.has(id) && !(scrubSets.get(s.bucket)?.has(id))) keys.push(id);
    }
  }
  return [...new Set(keys)];
}

// Spendable PREMIUM pieces, best value first — the crown jewels a teardown cashes
// AND the premium an accumulate-picks rebuild consolidates into a haul of capital.
// Premium = an elite-flagged stud OR an impact-tier producer (top-N by value at
// his bucket); young building blocks are sacred, so an impact-tier player in the
// spendable pool is a vet worth liquidating (e.g. a rebuild's off-timeline stud
// QB). One per offer; the loop fans them across buyers.
function premiumSpendable(thesis: Thesis, ec: EngineContext): string[] {
  const impactSets = buildImpactSets(ec.data);
  const out: Array<{ key: string; value: number }> = [];
  for (const key of thesis.spendable) {
    const p = ec.data.players.get(key);
    if (!p) continue; // players only
    const isStud = ec.data.values.isStud.get(key) ?? false;
    const b = bucketOf(p.position);
    const isImpact = !!b && (impactSets.get(b)?.has(key) ?? false);
    if (!isStud && !isImpact) continue;
    out.push({ key, value: ec.data.values.value.get(key) ?? 0 });
  }
  out.sort((a, b) => b.value - a.value);
  return out.map((x) => x.key);
}

// EVERY sellable player in the teardown's spendable pool, best value first — a
// teardown liquidates the whole roster, not only the crown jewels. The bound is the
// scrub bar: a body outside his position's startable depth has no trade market, so
// he's not worth a teardown slate (young building blocks are already sacred, hence
// absent from spendable). This surfaces the aging stars whose value has slipped below
// the impact bar (Doylestown's Henry/Adams/Diggs) that premiumSpendable would miss.
function teardownSellable(thesis: Thesis, ec: EngineContext, scrubSets: ScrubSets): string[] {
  const out: Array<{ key: string; value: number }> = [];
  for (const key of thesis.spendable) {
    const p = ec.data.players.get(key);
    if (!p) continue; // players only
    const b = bucketOf(p.position);
    if (!b) continue;
    if (scrubSets.get(b)?.has(key)) continue; // no market for a scrub
    // A young building block is NEVER a teardown piece — you tear DOWN by cashing the
    // old guard FOR youth + picks, not by shipping youth. (Young spendable depth is
    // consolidation / add_youth currency, surfaced under those goals instead.)
    if (isYoung(p.position, p.age, p.exp)) continue;
    out.push({ key, value: ec.data.values.value.get(key) ?? 0 });
  }
  out.sort((a, b) => b.value - a.value);
  return out.map((x) => x.key);
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

// Total neutral pick value on one side of an offer.
function pickValueOnSide(offer: EngineOffer, side: "send" | "receive", ec: EngineContext): number {
  let sum = 0;
  for (const a of offer.assets) {
    if (a.side !== side || a.type !== "pick") continue;
    sum += valueAsset({ type: "pick", key: a.key }, ec.ctx);
  }
  return sum;
}

// Round number from a pick key ("pick:YYYY-R-..."), or null.
function pickRound(key: string): number | null {
  if (!key.startsWith("pick:")) return null;
  const r = parseInt(key.slice(5).split("-")[1] ?? "", 10);
  return Number.isNaN(r) ? null : r;
}

// The best (lowest) pick round on a side, or Infinity if none.
function bestPickRound(offer: EngineOffer, side: "send" | "receive"): number {
  let best = Infinity;
  for (const a of offer.assets) {
    if (a.side !== side || a.type !== "pick") continue;
    const r = pickRound(a.key);
    if (r != null) best = Math.min(best, r);
  }
  return best;
}

// A display-level signature: same pieces by NAME on each side reads as the same
// deal to the user even when the underlying keys differ (e.g. two distinct
// 2027 1sts both render "2027 1st"). Used to kill look-alike duplicates.
function displaySignature(offer: EngineOffer): string {
  const send = offer.assets.filter((a) => a.side === "send").map((a) => a.name).sort().join("+");
  const recv = offer.assets.filter((a) => a.side === "receive").map((a) => a.name).sort().join("+");
  return `${send}=>${recv}`;
}

export type GeneratedOffer = {
  thesisId: string;
  goalId: string;
  goalKind: Goal["kind"];
  partnerTeam: string;
  bothSidesSatisfied: boolean;
  offer: EngineOffer;
  // Partner-side reasoning, carried through so the Builder director can advocate
  // from the engine's actual logic (why THIS deal serves one of THEIR storylines)
  // instead of re-inferring it. partnerThesisId points into the partner's
  // narrative bundle; partnerGoalSatisfied is the specific goal of theirs the deal
  // closes; why is the matcher's one-line narration.
  partnerThesisId: string;
  partnerGoalSatisfied: GoalRef | null;
  why: string;
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
// For liquidation-funded goals we also seed a vet on the SEND side so a real
// piece of ours headlines the deal (and rotates across offers).
function requestForMatch(
  match: Match,
  goal: Goal,
  thesis: Thesis,
  sendAnchorKey: string | null,
  aimSpec?: ReturnSpec,
): DealRequest {
  const anchors: DealRequest["anchors"] = [{ key: match.partnerAssetKey, side: "receive" }];
  if (sendAnchorKey && sendAnchorKey !== match.partnerAssetKey) {
    anchors.push({ key: sendAnchorKey, side: "send" });
  }
  return {
    ...base(match.ourRosterId, match.partnerRosterId),
    anchors,
    leans: [],
    returnShape: toReturnAim(aimSpec ?? goal.returnSpec),
    spendable: thesis.spendable, // authoritative over posture pick-protection
    ...(goal.kind === "insurance" ? { dealKind: "insurance" as const } : {}),
    ...(goal.kind === "teardown" ? { dealKind: "teardown" as const } : {}),
  };
}

// The haul aim for CONSOLIDATING a premium spendable vet into future capital — the
// rebuild's accumulate move. Same shape as a teardown bounty (picks + young
// non-stud building blocks), because a single buyer never holds enough PICK capital
// alone to balance a premium QB; the young pieces fill the gap. Labeled
// accumulate_picks (a rebuild stockpiles), and still gated to NET pick capital.
const PREMIUM_ACCUMULATE_AIM: ReturnSpec = {
  preferBuckets: ["QB", "RB", "PASS_CATCHER"],
  preferPickTier: "any",
  youthBuckets: ["QB", "RB", "PASS_CATCHER"],
  strength: "hard",
};

// CONSOLIDATION: the single source of truth for "does this deal serve the
// partner?" is the CONSTRUCTED PACKAGE, not a pool-wide guess. We ask: does any
// asset the partner actually RECEIVES (our send side) satisfy one of their
// acquire goals? Returns that goal (the honest "why they'd do it") or null —
// null means the package hands them nothing they want, so it isn't a real
// two-sided deal and the Builder gate drops it. The matcher's pool-based flag is
// now only a pre-construction ranking heuristic, never the surfaced truth.
// Goals that ADD a body at a position. You don't take depth / insurance / youth /
// fill at a position while shipping OUT a player at that SAME position — that's a
// lateral, not a need filled; it must be paid from other positions and/or picks.
// (Consolidation — sending lesser pieces at a position to land one better — is an
// acquire_impact play, which is intentionally NOT in this set.)
const SAME_POSITION_ADD_GOALS = new Set<GoalKind>(["depth", "insurance", "fill_need", "add_youth"]);

function bucketOfKey(ec: EngineContext, key: string): NeedBucket | null {
  const p = ec.data.players.get(key);
  return p ? (bucketOf(p.position) as NeedBucket | null) : null; // picks resolve to null
}

function isPremiumPlayerKey(ec: EngineContext, impactSets: ImpactSets, key: string): boolean {
  const p = ec.data.players.get(key);
  if (!p) return false; // picks aren't players
  if (ec.data.values.isStud.get(key) ?? false) return true;
  const b = bucketOf(p.position);
  return !!b && (impactSets.get(b)?.has(key) ?? false);
}

function partnerGoalForPackage(
  offer: EngineOffer,
  partnerBundle: NarrativeBundle | undefined,
  ourRosterId: string,
  ec: EngineContext,
  impactSets: ImpactSets,
  scrubSets: ScrubSets,
): GoalRef | null {
  if (!partnerBundle) return null;
  const sendKeys = offer.assets.filter((a) => a.side === "send").map((a) => a.key);
  // What the partner SHIPS US (our receive side). A same-position add goal is
  // void if they're shipping out a player at that bucket.
  const partnerShipsBuckets = new Set(
    offer.assets
      .filter((a) => a.side === "receive")
      .map((a) => bucketOfKey(ec, a.key))
      .filter((b): b is NeedBucket => b !== null),
  );
  // Partner's NET pick value (picks they receive from us − picks they ship us).
  // A pick-accumulation goal is only served if they come out ahead on picks.
  const partnerPickNet = pickValueOnSide(offer, "send", ec) - pickValueOnSide(offer, "receive", ec);
  // Their teardown is only served if we're actually BUYING their stud (we
  // receive a premium player from them) — picks/young we send are the haul, not
  // the trigger. Without it, an incidental pick we send falsely credits teardown.
  const weBuyTheirStud = offer.assets.some((a) => a.side === "receive" && isPremiumPlayerKey(ec, impactSets, a.key));
  for (const t of partnerBundle.theses) {
    for (const g of t.goals) {
      if (!ACQUIRE_GOAL_KINDS.has(g.kind)) continue;
      // Don't "fill depth" at a position they're simultaneously selling.
      if (SAME_POSITION_ADD_GOALS.has(g.kind) && g.bucket && partnerShipsBuckets.has(g.bucket)) {
        continue;
      }
      // Don't credit pick accumulation when they net-LOSE pick capital.
      if (g.kind === "accumulate_picks" && partnerPickNet <= 0) continue;
      // Don't credit a teardown unless we're buying their stud.
      if (g.kind === "teardown" && !weBuyTheirStud) continue;
      for (const k of sendKeys) {
        if (assetFitsGoal(ec.data, impactSets, scrubSets, k, g, ourRosterId)) {
          return { rosterId: partnerBundle.rosterId, thesisId: t.id, goalId: g.id, kind: g.kind };
        }
      }
    }
  }
  return null;
}

export function generateOffersForTeam(slate: TeamSlate, ec: EngineContext): ThesisOffers[] {
  const bundle = ec.bundles?.get(slate.rosterId);
  const theses = bundle?.theses ?? [];
  if (theses.length === 0) return [];

  const scrubSets = buildScrubSets(ec.data);
  const impactSets = buildImpactSets(ec.data);

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

      // An acquire goal leads each offer with aimed send fuel — same-bucket depth
      // when we're deep there (a consolidation), else our other-bucket surplus —
      // and varies it across pieces so the send targets the goal, not a random
      // high-value body, and several funding shapes surface per target.
      const isAcquire = goal.kind === "acquire_impact";
      const liquidation = LIQUIDATION_FUNDED.has(goal.kind);
      const surpluses = bundle?.rosterRead.surpluses ?? [];
      const anchorPool = liquidation
        ? liquidationCurrency(thesis, ec, scrubSets)
        : isAcquire && goal.bucket
          ? acquireSpendAnchors(goal.bucket, thesis, ec, surpluses, scrubSets)
          : [];

      // One (match, sendAnchor) job per offer attempt. Liquidation rotates one vet
      // per match; an acquire tries several aimed anchors (+ a pick-funded variant)
      // per target for variety; a teardown ships ONE stud per buyer (the bounty is
      // assembled on the receive side); everything else lets construct fund freely.
      const jobs: Array<{ match: Match; anchorKey: string | null; aim?: ReturnSpec }> = [];
      let rot = 0;
      // Per-goal offer ceiling. A teardown scales with how many crown jewels it
      // cashes (each stud gets its own quota); everything else uses the flat cap.
      let goalCap = MAX_OFFERS_PER_GOAL;
      if (goal.kind === "teardown") {
        const studs = teardownSellable(thesis, ec, scrubSets);
        goalCap = Math.min(MAX_TEARDOWN_OFFERS, studs.length * TEARDOWN_OFFERS_PER_STUD);
        // Best (highest-value) pick/young anchor per partner, partners best-first.
        const byPartner = new Map<string, Match>();
        for (const m of ordered) {
          const cur = byPartner.get(m.partnerRosterId);
          if (!cur || m.rankReasons.fillValue > cur.rankReasons.fillValue) byPartner.set(m.partnerRosterId, m);
        }
        const partnerMatches = [...byPartner.values()].sort(
          (a, b) => b.rankReasons.fillValue - a.rankReasons.fillValue,
        );
        // Stud-major order: all of a stud's buyers before the next stud. The
        // per-stud quota in the collection loop then guarantees each stud surfaces
        // (a few buyers apiece) rather than the top stud taking every slot.
        for (const stud of studs) {
          for (const m of partnerMatches) jobs.push({ match: m, anchorKey: stud });
        }
      } else if (goal.kind === "accumulate_picks") {
        // TRUE accumulation: lead by CONSOLIDATING a premium spendable piece (a
        // rebuild's off-timeline stud — e.g. a vet QB) into a haul of picks, one
        // premium piece per buyer, fanned across buyers (construct assembles the
        // multi-pick return). Then the plain pick-ladder shape (anchorKey null:
        // trade lower picks UP a round, or shed cheap currency for capital) for the
        // smaller gains. Premium-anchored hauls come first so they survive the cap.
        const premium = premiumSpendable(thesis, ec);
        const byPartner = new Map<string, Match>();
        for (const m of ordered) {
          const cur = byPartner.get(m.partnerRosterId);
          if (!cur || m.rankReasons.fillValue > cur.rankReasons.fillValue) byPartner.set(m.partnerRosterId, m);
        }
        const partnerMatches = [...byPartner.values()].sort(
          (a, b) => b.rankReasons.fillValue - a.rankReasons.fillValue,
        );
        for (const piece of premium) {
          for (const m of partnerMatches) jobs.push({ match: m, anchorKey: piece, aim: PREMIUM_ACCUMULATE_AIM });
        }
        for (const match of ordered) jobs.push({ match, anchorKey: null });
      } else {
        for (const match of ordered) {
          if (isAcquire && anchorPool.length > 0) {
            for (const a of anchorPool.slice(0, MAX_ANCHORS_PER_TARGET)) jobs.push({ match, anchorKey: a });
            jobs.push({ match, anchorKey: null });
          } else if (liquidation && anchorPool.length > 0) {
            jobs.push({ match, anchorKey: anchorPool[rot++ % anchorPool.length] });
          } else {
            jobs.push({ match, anchorKey: null });
          }
        }
      }

      const collected: GeneratedOffer[] = [];
      const usedReceived = new Set<string>(); // per-goal received-player dedupe
      const seenSignature = new Set<string>(); // per-goal look-alike dedupe
      const perAnchorCount = new Map<string, number>(); // teardown: offers per stud

      for (const { match, anchorKey, aim } of jobs) {
        if (collected.length >= goalCap) break;
        // Teardown per-stud quota: once a stud has its allotment, skip its
        // remaining buyers so the next crown jewel gets the floor.
        if (goal.kind === "teardown" && anchorKey &&
            (perAnchorCount.get(anchorKey) ?? 0) >= TEARDOWN_OFFERS_PER_STUD) {
          continue;
        }

        const req = requestForMatch(match, goal, thesis, anchorKey, aim);
        const result = construct(req, ec);

        for (const offer of result.offers) {
          if (collected.length >= goalCap) break;
          // Lock to the matched partner.
          if (offer.partnerTeamId !== match.partnerRosterId) continue;
          // Fence: no sacred asset may leave (defensive; construct already has it).
          if (offer.assets.some((a) => a.side === "send" && !thesis.spendable.has(a.key))) continue;
          // A teardown offer MUST ship the seeded stud (the whole point of the deal).
          if (goal.kind === "teardown" && !offer.assets.some((a) => a.side === "send" && a.key === anchorKey)) {
            continue;
          }
          // A premium-anchored accumulate offer MUST ship the seeded piece (else it
          // collapses back into the cheap-currency shape we're trying to escape).
          if (goal.kind === "accumulate_picks" && anchorKey && !offer.assets.some((a) => a.side === "send" && a.key === anchorKey)) {
            continue;
          }
          // Win-now starter guard rail.
          if (goal.returnSpec.winNowStarterUpgrade && !passesStarterUpgrade(offer, ec, slate.rosterId)) {
            continue;
          }
          // Accumulate picks must NET pick capital — never ship a pick of equal/
          // greater value than what comes back. AND a PURE pick-for-pick deal must
          // trade UP a round (two 3rds -> a 2nd is good; two 3rds -> a 3rd, or a
          // 2nd -> a 2nd, is a pointless same-round shuffle).
          if (goal.kind === "accumulate_picks") {
            if (pickValueOnSide(offer, "receive", ec) <= pickValueOnSide(offer, "send", ec)) continue;
            const purePicks = !offer.assets.some((a) => a.type === "player");
            if (purePicks && bestPickRound(offer, "receive") >= bestPickRound(offer, "send")) continue;
          }
          // Variety dedupe is SCOPED PER STUD for a teardown: each crown jewel is an
          // independent sale, so two different studs may each come back for overlapping
          // young pieces (Burrow->Pearsall+picks AND Allen->Pearsall+picks are distinct
          // menu options). For every other goal the scope is the whole goal.
          const scope = goal.kind === "teardown" && anchorKey ? `${anchorKey}|` : "";
          const sig = scope + displaySignature(offer);
          if (seenSignature.has(sig)) continue;
          // Don't surface the same received body twice — EXCEPT for an acquire, where
          // showing several funding shapes for the same upgrade is the point.
          const recv = receivedPlayerKeys(offer);
          if (!isAcquire && recv.some((k) => usedReceived.has(scope + k))) continue;

          seenSignature.add(sig);
          for (const k of recv) usedReceived.add(scope + k);
          if (goal.kind === "teardown" && anchorKey) {
            perAnchorCount.set(anchorKey, (perAnchorCount.get(anchorKey) ?? 0) + 1);
          }

          // Asset-accurate partner fit, derived from the actual package (not the
          // matcher's pool guess). This is the consolidated single source of truth
          // for bothSidesSatisfied + the partner goal the deal serves.
          const pkgGoal = partnerGoalForPackage(
            offer,
            ec.bundles?.get(match.partnerRosterId),
            slate.rosterId,
            ec,
            impactSets,
            scrubSets,
          );
          collected.push({
            thesisId: thesis.id,
            goalId: goal.id,
            goalKind: goal.kind,
            partnerTeam: match.partnerTeam,
            bothSidesSatisfied: pkgGoal !== null,
            offer,
            partnerThesisId: pkgGoal?.thesisId ?? match.partnerThesisId,
            partnerGoalSatisfied: pkgGoal,
            why: match.why,
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