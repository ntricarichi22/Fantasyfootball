import { construct, type EngineContext } from "@/pro-personnel/engine";
import type { DealRequest, EngineOffer, Lean, Intent, ReturnAim, Bucket } from "@/pro-personnel/engine";
import type { ArchetypeName, Thesis } from "@/shared/team-narratives";
import { isYoung } from "@/shared/asset-values";
import type { BuyIntent, StrategyProfile } from "@/shared/league-data";
import type { Match, TeamSlate } from "./types";

// Offer generation = the bridge from the matching layer to the existing deal
// constructor. A match already decided WHO trades with WHOM and the headline
// PIECE; construct.ts owns the rest (build the package, balance, price both
// seats, safety, rank). This file is the thin adapter the 4.2 design calls for
// — it does NOT re-implement any deal logic, it only translates each match
// into the DealRequest the constructor already understands.

// The seller archetype's return preference, expressed as the engine's existing
// Lean knob. NOTE: construct.ts does not consume leans yet (the knob is wired
// through DealRequest but unused), so this is currently a documented no-op —
// it captures the intent and is ready for when the lean layer is implemented
// (the "Option A twist": reset/vet-liq should pull youth/picks into the return).
// For now the smoke test runs pure Option B.
function leansFor(archetype: ArchetypeName): Lean[] {
  switch (archetype) {
    case "reset":
    case "vet_liquidation":
      return ["prefer_picks"];
    case "de_consolidate":
      return ["prefer_players"]; // splitting a star wants bodies back, not just paper
    default:
      return [];
  }
}

// The storyline's demand on the RETURN composition, pushed into construct's
// balance step (see ReturnAim). Two independent parts:
//
//  1. Backfill (timeline-independent). A move that ships a needed starter must
//     get a competent starter back at that bucket, or it's a teardown, not the
//     owner's plan. Applies to harvest_surplus and the sell-high-of-a-starter —
//     the canonical "sell one of two stud QBs, get a QB2 back" case.
//  2. Youth / pick-tier aim (timeline-driven). On a BUILD, the return should be
//     young players and picks of the tier the owner asked for — not the
//     highest-value vet the math allows. HARD for outright sells (harvest /
//     sell-high / vet-liq / reset: the package IS youth+picks); SOFT for
//     consolidate (the incoming player is the point, just tilt him young). A
//     WIN-NOW thesis wants the best proven piece, so no youth/pick aim there.
function returnShapeFor(
  match: Match,
  thesis: Thesis | undefined,
  strat: StrategyProfile | null,
): ReturnAim | undefined {
  const arch = match.narrativeArchetype;
  const selling = match.side === "we_sell";
  const bucket = match.anchorBucket as Bucket;

  let requireBackfill: Bucket | undefined;
  if (
    selling &&
    bucket !== "PICK" &&
    (arch === "harvest_surplus" || arch === "sell_high_star")
  ) {
    requireBackfill = bucket;
  }

  let preferYouth: boolean | undefined;
  let preferPickTier: ReturnAim["preferPickTier"];
  let strength: ReturnAim["strength"];

  const tl = thesis?.timeline;
  const youthAimArch =
    arch === "harvest_surplus" ||
    arch === "sell_high_star" ||
    arch === "vet_liquidation" ||
    arch === "reset" ||
    arch === "consolidate";

  if (tl === "build_future" && youthAimArch) {
    preferYouth = true;
    const kinds = strat?.picksBuyKind ?? [];
    preferPickTier = kinds.includes("premium")
      ? "premium"
      : kinds.includes("future")
        ? "future"
        : "future"; // a build banks future capital by default
    strength = arch === "consolidate" ? "soft" : "hard";
  }

  if (!requireBackfill && !preferYouth && !preferPickTier) return undefined;
  return { requireBackfill, preferYouth, preferPickTier, strength };
}

// One match → one DealRequest, locked to the single matched partner and aimed
// at our seat (we're evaluating the deal from the active team's view).
// Map a need bucket to the positions that fill it (PASS_CATCHER = WR + TE).
function positionsForBucket(bucket: string): Set<string> {
  if (bucket === "QB") return new Set(["QB"]);
  if (bucket === "RB") return new Set(["RB"]);
  if (bucket === "PASS_CATCHER") return new Set(["WR", "TE"]);
  return new Set();
}

// For a tier-2 SELL floor match, the match names a bucket, not a player — so
// the adapter must pick WHICH of our pieces at that bucket to ship. We seed the
// single best-fit sell anchor: our highest-value player at the bucket who is
// NOT in our optimal starting lineup (shipping a starter would open a hole the
// safety filter rejects anyway). Returns null if we have nothing sheddable.
// Our sheddable non-starter players at a bucket, highest value first. A tier-2
// SELL floor match names only a position; the owner flagged it as a sell, so we
// shop our depth there — but never a player in the optimal lineup (shipping a
// starter opens a hole the safety filter rejects anyway). Returns a ranked list
// so the floor can spread across the pieces we'd actually move (different RBs to
// different teams), not clone one player into every deal. Bounded by the caller.
function sheddableAtBucket(
  activeRosterId: string,
  bucket: string,
  ec: EngineContext
): string[] {
  const team = ec.data.teams.find((t) => t.rosterId === activeRosterId);
  if (!team) return [];
  const positions = positionsForBucket(bucket);
  if (positions.size === 0) return [];

  const profile = ec.profiles.find((p) => p.rosterId === activeRosterId) ?? null;
  const starterIds = new Set(
    (profile?.strength.lineup ?? []).map((s) => s.playerId).filter((id): id is string => !!id)
  );

  return team.players
    .filter((p) => positions.has(p.position.toUpperCase()))
    .filter((p) => !starterIds.has(p.id)) // don't ship a starter into a hole
    .map((p) => ({ id: p.id, value: ec.data.values.value.get(p.id) ?? 0 }))
    .sort((a, b) => b.value - a.value)
    .map((x) => x.id);
}

// How many distinct sell pieces one tier-2 floor bucket may shop per partner.
// Keeps the slate from exploding (a deep position × 11 partners) while letting
// the floor spread beyond a single player.
const TIER2_SELL_PIECES = 2;

// ── buy intent ─────────────────────────────────────────────────────────────
//
// A tier-2 BUY floor names only a position (the owner flagged it "thin"). When
// the owner ALSO stated WHAT they're after at that position — the buy intent —
// we honor it by picking the matching target(s) off the partner's roster and
// anchoring them, instead of letting the constructor grab the best raw fit. No
// intent set → unchanged (the constructor discovers, exactly like before).
//
//   difference_maker → a stud, or a clear upgrade over what we start there
//   young            → a young building block (age-gated, value-ranked)
//   insurance        → a proven, affordable backup (not a stud, not a kid),
//                      built with the existing insurance currency rules
//
// Intent is per position; gate the slate so a deep market × 11 partners can't
// explode. Realistic-only: if a partner has nothing matching the intent, we
// emit NOTHING for them rather than fall back to a generic grab that ignores
// what the owner asked for. The roster-read (tier 1) still fills the slate.
const TIER2_BUY_TARGETS = 2;

// Mirrors matcher.ts INSURANCE_TARGET_CEILING: above legitimate backup arms,
// below franchise starters — so "insurance" can't pull in a plain starter.
const INSURANCE_TARGET_CEILING = 200;

function buyIntentForBucket(strat: StrategyProfile | null, bucket: string): BuyIntent[] {
  if (!strat) return [];
  if (bucket === "QB") return strat.qbBuyIntent ?? [];
  if (bucket === "RB") return strat.rbBuyIntent ?? [];
  if (bucket === "PASS_CATCHER") return strat.pcBuyIntent ?? [];
  return [];
}

// Lowest value among the players we actually START at this bucket. A target
// worth more than this is a genuine upgrade. No starter there (a real hole) →
// 0, so any decent piece reads as an upgrade.
function ourWorstStarterValueAt(activeRosterId: string, bucket: string, ec: EngineContext): number {
  const positions = positionsForBucket(bucket);
  if (positions.size === 0) return 0;
  const team = ec.data.teams.find((t) => t.rosterId === activeRosterId);
  if (!team) return 0;
  const profile = ec.profiles.find((p) => p.rosterId === activeRosterId) ?? null;
  const starterIds = new Set(
    (profile?.strength.lineup ?? []).map((s) => s.playerId).filter((id): id is string => !!id)
  );
  const vals = team.players
    .filter((p) => positions.has(p.position.toUpperCase()) && starterIds.has(p.id))
    .map((p) => ec.data.values.value.get(p.id) ?? 0);
  return vals.length ? Math.min(...vals) : 0;
}

// Pick the partner's pieces at a bucket that match the stated buy intent(s).
// Round-robins across the selected intents so a multi-select (e.g. "studs AND
// young guys") returns a mix, deduped and capped. Each entry remembers whether
// it's an insurance buy, so the request can carry the insurance currency rule.
function buyTargetsForIntent(
  activeRosterId: string,
  partnerId: string,
  bucket: string,
  intents: BuyIntent[],
  ec: EngineContext
): Array<{ key: string; insurance: boolean }> {
  const positions = positionsForBucket(bucket);
  if (positions.size === 0) return [];
  const partner = ec.data.teams.find((t) => t.rosterId === partnerId);
  if (!partner) return [];

  const worstStarter = ourWorstStarterValueAt(activeRosterId, bucket, ec);

  const cands = partner.players
    .filter((p) => positions.has(p.position.toUpperCase()))
    .map((p) => ({
      id: p.id,
      value: ec.data.values.value.get(p.id) ?? 0,
      isStud: ec.data.values.isStud.get(p.id) ?? false,
      young: isYoung(p.position, p.age),
    }));

  const byVal = (a: { value: number }, b: { value: number }) => b.value - a.value;
  const lists: Array<{ insurance: boolean; ids: string[] }> = [];

  if (intents.includes("difference_maker")) {
    lists.push({
      insurance: false,
      ids: cands.filter((c) => c.isStud || c.value >= worstStarter).sort(byVal).map((c) => c.id),
    });
  }
  if (intents.includes("young")) {
    lists.push({
      insurance: false,
      ids: cands.filter((c) => c.young).sort(byVal).map((c) => c.id),
    });
  }
  if (intents.includes("insurance")) {
    lists.push({
      insurance: true,
      ids: cands
        .filter((c) => !c.isStud && !c.young && c.value > 0 && c.value <= INSURANCE_TARGET_CEILING)
        .sort(byVal)
        .map((c) => c.id),
    });
  }

  const out: Array<{ key: string; insurance: boolean }> = [];
  const seen = new Set<string>();
  for (let i = 0; out.length < TIER2_BUY_TARGETS; i++) {
    let advanced = false;
    for (const lst of lists) {
      if (i >= lst.ids.length) continue;
      advanced = true;
      const id = lst.ids[i];
      if (!seen.has(id)) {
        seen.add(id);
        out.push({ key: id, insurance: lst.insurance });
        if (out.length >= TIER2_BUY_TARGETS) break;
      }
    }
    if (!advanced) break;
  }
  return out;
}

function requestForMatch(
  activeRosterId: string,
  match: Match,
  ec: EngineContext
): DealRequest[] {
  // Pick-anchored sells aren't matched today (deferred to pick-for-pick logic).
  if (match.anchorBucket === "PICK") return [];

  // ── Tier 1: narrative-driven, anchored on a named player. ────────────────
  if (match.tier === 1) {
    if (match.side === "we_sell") {
      return [{
        ourTeamId: activeRosterId,
        offeringTeamId: activeRosterId,
        intent: "shop" as Intent,
        anchors: [{ key: match.anchorKey, side: "send" }],
        counterparty: { mode: "locked", teamIds: [match.partnerRosterId] },
        leans: leansFor(match.narrativeArchetype),
        aimAt: "us",
      }];
    }
    // we_buy: the anchor is the partner's piece we want.
    return [{
      ourTeamId: activeRosterId,
      offeringTeamId: activeRosterId,
      intent: "acquire" as Intent,
      anchors: [{ key: match.anchorKey, side: "receive" }],
      counterparty: { mode: "locked", teamIds: [match.partnerRosterId] },
      leans: leansFor(match.narrativeArchetype),
      aimAt: "us",
      ...(match.narrativeArchetype === "insurance" ? { dealKind: "insurance" as const } : {}),
    }];
  }

  // ── Tier 2: stated-market floor, anchored on a BUCKET, not a player. ──────
  // The match says "we buy/sell this position with this partner" off the
  // owner's market toggle. There's no narrative and no named anchor, so we
  // translate the bucket into a concrete request the constructor can run.
  if (match.side === "we_buy") {
    const strat = ec.data.strategy.get(activeRosterId) ?? null;
    const intents = buyIntentForBucket(strat, match.anchorBucket);

    // Intent stated → honor it: anchor the matching target(s) off this partner.
    // Realistic-only: a partner with nothing matching yields no offer (rather
    // than a generic grab that ignores what the owner asked for).
    if (intents.length > 0) {
      const targets = buyTargetsForIntent(
        activeRosterId,
        match.partnerRosterId,
        match.anchorBucket,
        intents,
        ec
      );
      return targets.map((t) => ({
        ourTeamId: activeRosterId,
        offeringTeamId: activeRosterId,
        intent: "acquire" as Intent,
        anchors: [{ key: t.key, side: "receive" as const }],
        counterparty: { mode: "locked" as const, teamIds: [match.partnerRosterId] },
        leans: [],
        aimAt: "us" as const,
        ...(t.insurance ? { dealKind: "insurance" as const } : {}),
      }));
    }

    // No intent set → the constructor discovers the best-fit target at a
    // position we have demand for, on this partner. Exactly the existing
    // buy-side discovery path — unchanged behavior when no intent is stated.
    return [{
      ourTeamId: activeRosterId,
      offeringTeamId: activeRosterId,
      intent: "acquire" as Intent,
      anchors: [],
      counterparty: { mode: "locked", teamIds: [match.partnerRosterId] },
      leans: [],
      aimAt: "us",
    }];
  }

  // we_sell floor: the constructor has no "discover what of OURS to ship" path,
  // so the adapter seeds the anchor. We spread across our sheddable depth at the
  // bucket (up to TIER2_SELL_PIECES) so the floor shops different players to a
  // partner instead of cloning one piece into every deal.
  const sellKeys = sheddableAtBucket(activeRosterId, match.anchorBucket, ec).slice(
    0,
    TIER2_SELL_PIECES
  );
  return sellKeys.map((sellKey) => ({
    ourTeamId: activeRosterId,
    offeringTeamId: activeRosterId,
    intent: "shop" as Intent,
    anchors: [{ key: sellKey, side: "send" }],
    counterparty: { mode: "locked", teamIds: [match.partnerRosterId] },
    leans: [],
    aimAt: "us",
  }));
}

export type GeneratedOffer = {
  // Which narrative produced this, so the director can narrate under the story.
  narrativeArchetype: ArchetypeName;
  // Which thesis (story) this offer belongs to. Offers are grouped by this.
  thesisId: string;
  tier: Match["tier"];
  side: Match["side"];
  anchor: string;
  partnerTeam: string;
  offer: EngineOffer;
};

// A thesis with its generated, fence-respecting offers.
export type ThesisOffers = {
  thesis: Thesis;
  offers: GeneratedOffer[];
};

// Per-anchor variety cap: no single asset may headline more than this many
// offers within one thesis, so the slate samples breadth (many anchors, many
// shapes) instead of five flavors of the same marquee name. Ordering is
// value-tilted — higher-value anchors surface first, so each anchor's best
// realistic deal lands before the cap bites.
const MAX_OFFERS_PER_ANCHOR = 2;

// The send-side anchor of an offer (the headline piece WE ship), used for the
// per-anchor cap. Falls back to a sorted send signature when no single anchor.
function sendAnchorKey(offer: EngineOffer): string {
  const sends = offer.assets.filter((a) => a.side === "send");
  if (sends.length === 0) return "none";
  // Highest-value send is the de-facto headline; approximate by first listed
  // (construct lists the anchor first). Stable enough for capping.
  return sends[0].key;
}

// Generate a team's offers, GROUPED BY THESIS, each offer constrained to its
// thesis's spendable fence. The pipeline still runs narrative-by-narrative
// through the constructor (unchanged deal logic); the new work is (1) routing
// each match's offers to its thesis, (2) dropping any offer whose SEND side
// touches an asset that thesis holds sacred (post-filter — no constructor
// surgery), and (3) the per-anchor variety cap. Two theses → two independent
// offer lists, each playing by its own currency rule.
export function generateOffersForTeam(
  slate: TeamSlate,
  ec: EngineContext
): ThesisOffers[] {
  const bundle = ec.bundles?.get(slate.rosterId);
  const theses = bundle?.theses ?? [];
  if (theses.length === 0) return [];

  // The owner's intent thesis — where tier-2 floor matches (not narrative-
  // driven) and any match missing a thesisId are routed.
  const intentThesis = theses.find((t) => t.source === "intent") ?? theses[0];
  const byId = new Map<string, Thesis>(theses.map((t) => [t.id, t]));
  const spendableOf = (id: string): Set<string> =>
    new Set(byId.get(id)?.spendable ?? []);

  // Accumulators per thesis.
  const collected = new Map<string, GeneratedOffer[]>();
  const seen = new Set<string>();              // global dedupe within a thesis
  const anchorCount = new Map<string, number>(); // `${thesisId}|${anchor}` → n

  const resolveThesisId = (match: Match): string =>
    match.thesisId && byId.has(match.thesisId) ? match.thesisId : intentThesis.id;

  const strat = ec.data.strategy.get(slate.rosterId) ?? null;

  const runMatch = (match: Match) => {
    const thesisId = resolveThesisId(match);
    const spendable = spendableOf(thesisId);

    const reqs = requestForMatch(slate.rosterId, match, ec);
    const shape = returnShapeFor(match, byId.get(thesisId), strat);
    for (const req of reqs) {
      if (shape) req.returnShape = shape;
      const result = construct(req, ec);
      for (const offer of result.offers) {
        if (offer.partnerTeamId !== match.partnerRosterId) continue;

        // FENCE: drop any offer that ships an asset this thesis holds sacred.
        // The spendable set is the budget; a send outside it breaks the story.
        const sends = offer.assets.filter((a) => a.side === "send");
        if (sends.some((a) => !spendable.has(a.key))) continue;

        // Dedupe identical packages within the thesis.
        const sig =
          thesisId + "|" + offer.partnerTeamId + "|" +
          offer.assets.map((a) => `${a.side}:${a.key}`).sort().join(",");
        if (seen.has(sig)) continue;

        // Per-anchor variety cap.
        const anchorK = thesisId + "|" + sendAnchorKey(offer);
        if ((anchorCount.get(anchorK) ?? 0) >= MAX_OFFERS_PER_ANCHOR) continue;

        seen.add(sig);
        anchorCount.set(anchorK, (anchorCount.get(anchorK) ?? 0) + 1);
        const arr = collected.get(thesisId) ?? [];
        arr.push({
          narrativeArchetype: match.narrativeArchetype,
          thesisId,
          tier: match.tier,
          side: match.side,
          anchor: match.anchor,
          partnerTeam: match.partnerTeam,
          offer,
        });
        collected.set(thesisId, arr);
      }
    }
  };

  // Tier 1 first (narrative-driven) so a narrative offer wins the dedupe over an
  // identical floor offer; floor fills in behind.
  for (const match of slate.tier1) runMatch(match);
  for (const match of slate.tier2) runMatch(match);

  // Assemble in thesis order (intent stories first, per buildTheses ordering).
  return theses
    .map((t) => ({ thesis: t, offers: collected.get(t.id) ?? [] }))
    .filter((to) => to.offers.length > 0);
}