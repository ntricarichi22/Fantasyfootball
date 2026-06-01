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

// ── Per-position intent readers ──────────────────────────────────────────
// The menu is built FROM these — the whole reason markets/intents are
// position-specific. A bucket is a "young-acquire" bucket if the owner's buy
// intent there is `young`; a "proven-acquire" bucket if they're chasing a
// difference-maker OR consolidating depth into a better starter there.

type ABucket = Exclude<Bucket, "PICK">;
const PLAYER_BUCKETS: ABucket[] = ["QB", "RB", "PASS_CATCHER"];

function buyIntentsAt(strat: StrategyProfile | null, b: ABucket): BuyIntent[] {
  if (!strat) return [];
  return (b === "QB" ? strat.qbBuyIntent : b === "RB" ? strat.rbBuyIntent : strat.pcBuyIntent) ?? [];
}
function marketAt(strat: StrategyProfile | null, b: ABucket): string {
  if (!strat) return "hold";
  return b === "QB" ? strat.qbMarket : b === "RB" ? strat.rbMarket : strat.pcMarket;
}
function sellMovesAt(strat: StrategyProfile | null, b: ABucket): string[] {
  if (!strat) return [];
  return (b === "QB" ? strat.qbSellMove : b === "RB" ? strat.rbSellMove : strat.pcSellMove) ?? [];
}

// Buckets whose RETURNS must be young (PC = buy_young).
function youthBucketsFor(strat: StrategyProfile | null): ABucket[] {
  return PLAYER_BUCKETS.filter((b) => buyIntentsAt(strat, b).includes("young"));
}
// Buckets where the owner wants a PROVEN better starter back — a difference-
// maker buy, OR a sell→consolidate (ship depth, land one better). Youth N/A.
function provenAcquireBucketsFor(strat: StrategyProfile | null): ABucket[] {
  return PLAYER_BUCKETS.filter((b) => {
    const buys = buyIntentsAt(strat, b);
    if (buys.includes("difference_maker")) return true;
    return marketAt(strat, b) === "sell" && sellMovesAt(strat, b).includes("consolidate");
  });
}
// The pick tier the owner is collecting (premium > future), else a build's
// default of future capital.
function pickTierFor(strat: StrategyProfile | null): "premium" | "future" {
  const kinds = strat?.picksBuyKind ?? [];
  if (kinds.includes("premium")) return "premium";
  return "future";
}

function bucketOf(position: string): ABucket {
  const p = position.toUpperCase();
  if (p === "QB") return "QB";
  if (p === "RB") return "RB";
  return "PASS_CATCHER";
}
function isYoungPlayer(ec: EngineContext, id: string): boolean {
  const p = ec.data.players.get(id);
  return p ? isYoung(p.position, p.age) : false;
}
function isStudPlayer(ec: EngineContext, id: string): boolean {
  return ec.data.values.isStud.get(id) ?? false;
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

// A request plus the SHAPE label that produced it, so the slate can cap per
// (anchor × shape) — letting Mahomes show a picks shape AND a young-WR shape
// AND an RB-room shape, instead of two clones of whatever balanced first.
type ShapedRequest = { req: DealRequest; mode: string };

function base(
  activeRosterId: string,
  partnerId: string,
  intent: Intent,
): Omit<DealRequest, "anchors" | "leans"> {
  return {
    ourTeamId: activeRosterId,
    offeringTeamId: activeRosterId,
    intent,
    counterparty: { mode: "locked", teamIds: [partnerId] },
    aimAt: "us",
  };
}

// The menu of return SHAPES for selling a headline asset on a BUILD. Each shape
// is a tightly-scoped ReturnAim, all keeping the same-position backfill when one
// is required. Driven entirely by per-position intent:
//   • picks            — the future-capital shape (no players, just the right tier)
//   • young_<bucket>   — one per buy_young position (PC) — young bodies only
//   • room_<bucket>    — one per proven-acquire position (RB consolidate) — a
//                        proven starter to complete that room
function sellMenu(
  activeRosterId: string,
  match: Match,
  ec: EngineContext,
  withBackfill: boolean,
): ShapedRequest[] {
  const strat = ec.data.strategy.get(activeRosterId) ?? null;
  const bucket = match.anchorBucket as Bucket;
  const requireBackfill = withBackfill && bucket !== "PICK" ? bucket : undefined;
  const tier = pickTierFor(strat);
  const send = [{ key: match.anchorKey, side: "send" as const }];
  const out: ShapedRequest[] = [];

  // 1) picks shape — future capital, no players.
  out.push({
    mode: "picks",
    req: {
      ...base(activeRosterId, match.partnerRosterId, "shop"),
      anchors: send,
      leans: [],
      returnShape: {
        requireBackfill,
        preferPickTier: tier,
        preferBuckets: [],
        youthBuckets: [],
        strength: "hard",
      },
    },
  });

  // 2) a young-bodies shape per buy_young bucket.
  for (const y of youthBucketsFor(strat)) {
    out.push({
      mode: `young_${y}`,
      req: {
        ...base(activeRosterId, match.partnerRosterId, "shop"),
        anchors: send,
        leans: [],
        returnShape: {
          requireBackfill,
          preferBuckets: [y],
          youthBuckets: [y],
          strength: "hard",
        },
      },
    });
  }

  // 3) a complete-the-room shape per proven-acquire bucket (RB consolidate).
  for (const p of provenAcquireBucketsFor(strat)) {
    if (p === bucket) continue; // don't "complete" the room you're selling from
    out.push({
      mode: `room_${p}`,
      req: {
        ...base(activeRosterId, match.partnerRosterId, "shop"),
        anchors: send,
        leans: [],
        returnShape: {
          requireBackfill,
          preferBuckets: [p],
          youthBuckets: [],
          strength: "hard",
        },
      },
    });
  }

  return out;
}

function requestForMatch(
  activeRosterId: string,
  match: Match,
  ec: EngineContext,
  timeline: Thesis["timeline"],
): ShapedRequest[] {
  // Pick-anchored sells aren't matched today (deferred to pick-for-pick logic).
  if (match.anchorBucket === "PICK") return [];

  const strat = ec.data.strategy.get(activeRosterId) ?? null;

  // ── Tier 1: narrative-driven, anchored on a named player. ────────────────
  if (match.tier === 1) {
    if (match.side === "we_sell") {
      const arch = match.narrativeArchetype;
      const build = timeline === "build_future";
      const needsBackfill = arch === "harvest_surplus" || arch === "sell_high_star";

      // On a build, a headline sell gets the full MENU of aimed shapes.
      if (build && (needsBackfill || arch === "vet_liquidation")) {
        return sellMenu(activeRosterId, match, ec, needsBackfill);
      }

      // Off-build (or reset / de-consolidate): a single request, backfill-only
      // when the move can't open a hole; existing leans otherwise.
      const bucket = match.anchorBucket as Bucket;
      return [{
        mode: "single",
        req: {
          ...base(activeRosterId, match.partnerRosterId, "shop"),
          anchors: [{ key: match.anchorKey, side: "send" }],
          leans: leansFor(arch),
          ...(needsBackfill ? { returnShape: { requireBackfill: bucket } } : {}),
        },
      }];
    }

    // we_buy: the anchor is the partner's piece we want. PER-POSITION GATE —
    // if this bucket carries a buy_young intent, the target itself MUST be
    // young (kills an aging WR like McLaurin surfacing under a buy_young PC
    // plan). Proven-acquire buckets (RB consolidate) accept any starter.
    const buyBucket = bucketOf(
      ec.data.players.get(match.anchorKey)?.position ?? match.anchorBucket,
    );
    const youthGate = youthBucketsFor(strat).includes(buyBucket);
    if (youthGate && !(isYoungPlayer(ec, match.anchorKey) && !isStudPlayer(ec, match.anchorKey))) {
      return []; // off-intent target — don't surface it
    }
    return [{
      mode: "buy",
      req: {
        ...base(activeRosterId, match.partnerRosterId, "acquire"),
        anchors: [{ key: match.anchorKey, side: "receive" }],
        leans: leansFor(match.narrativeArchetype),
        ...(youthGate ? { returnShape: { youthBuckets: [buyBucket], strength: "soft" } } : {}),
        ...(match.narrativeArchetype === "insurance" ? { dealKind: "insurance" as const } : {}),
      },
    }];
  }

  // ── Tier 2: stated-market floor, anchored on a BUCKET, not a player. ──────
  if (match.side === "we_buy") {
    const intents = buyIntentForBucket(strat, match.anchorBucket);
    if (intents.length > 0) {
      const targets = buyTargetsForIntent(
        activeRosterId,
        match.partnerRosterId,
        match.anchorBucket,
        intents,
        ec
      );
      return targets.map((t) => ({
        mode: "floor_buy",
        req: {
          ...base(activeRosterId, match.partnerRosterId, "acquire"),
          anchors: [{ key: t.key, side: "receive" as const }],
          leans: [],
          ...(t.insurance ? { dealKind: "insurance" as const } : {}),
        },
      }));
    }
    return [{
      mode: "floor_buy",
      req: {
        ...base(activeRosterId, match.partnerRosterId, "acquire"),
        anchors: [],
        leans: [],
      },
    }];
  }

  // we_sell floor: seed our sheddable depth at the bucket.
  const sellKeys = sheddableAtBucket(activeRosterId, match.anchorBucket, ec).slice(
    0,
    TIER2_SELL_PIECES
  );
  return sellKeys.map((sellKey) => ({
    mode: "floor_sell",
    req: {
      ...base(activeRosterId, match.partnerRosterId, "shop"),
      anchors: [{ key: sellKey, side: "send" }],
      leans: [],
    },
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

// Variety caps. One offer per distinct SHAPE of an anchor (so a shape doesn't
// clone across partners), and a ceiling on how many shapes one headline anchor
// may show — enough for the menu (picks / young / room) without flooding.
const MAX_OFFERS_PER_SHAPE = 1;
const MAX_OFFERS_PER_ANCHOR = 4;

// The send-side anchor of an offer (the headline piece WE ship), used for the
// per-anchor cap. Falls back to a sorted send signature when no single anchor.
function sendAnchorKey(offer: EngineOffer): string {
  const sends = offer.assets.filter((a) => a.side === "send");
  if (sends.length === 0) return "none";
  return sends[0].key;
}

// Generate a team's offers, GROUPED BY THESIS, each constrained to its thesis's
// spendable fence. Per match the adapter now emits a MENU of aimed shapes
// (picks / young-<pos> / room-<pos>), each a tightly-scoped ReturnAim the
// constructor honors in its balance step. We route each to its thesis, drop any
// send that breaks the fence, and cap per (anchor × shape).
export function generateOffersForTeam(
  slate: TeamSlate,
  ec: EngineContext
): ThesisOffers[] {
  const bundle = ec.bundles?.get(slate.rosterId);
  const theses = bundle?.theses ?? [];
  if (theses.length === 0) return [];

  const intentThesis = theses.find((t) => t.source === "intent") ?? theses[0];
  const byId = new Map<string, Thesis>(theses.map((t) => [t.id, t]));
  const spendableOf = (id: string): Set<string> => new Set(byId.get(id)?.spendable ?? []);

  const collected = new Map<string, GeneratedOffer[]>();
  const seen = new Set<string>();                // dedupe identical packages
  const shapeCount = new Map<string, number>();  // `${thesis}|${anchor}|${mode}`
  const anchorCount = new Map<string, number>(); // `${thesis}|${anchor}`

  const resolveThesisId = (match: Match): string =>
    match.thesisId && byId.has(match.thesisId) ? match.thesisId : intentThesis.id;

  // Build + collect one offer set for a request, tagging it with its shape mode
  // and the storyline it belongs to. expectedPartner locks the partner for a
  // matched (locked-counterparty) request; null lets an open request (the
  // packaging pass) keep whatever partner the constructor found.
  const runRequest = (
    thesisId: string,
    req: DealRequest,
    mode: string,
    meta: { archetype: ArchetypeName; tier: Match["tier"]; side: Match["side"]; anchor: string },
    expectedPartner: string | null,
  ) => {
    const spendable = spendableOf(thesisId);
    const result = construct(req, ec);
    for (const offer of result.offers) {
      if (expectedPartner && offer.partnerTeamId !== expectedPartner) continue;

      // Fence: no sacred asset may leave under this thesis.
      const sends = offer.assets.filter((a) => a.side === "send");
      if (sends.some((a) => !spendable.has(a.key))) continue;

      const sig =
        thesisId + "|" + offer.partnerTeamId + "|" +
        offer.assets.map((a) => `${a.side}:${a.key}`).sort().join(",");
      if (seen.has(sig)) continue;

      const anchorK = thesisId + "|" + sendAnchorKey(offer);
      const shapeK = anchorK + "|" + mode;
      if ((shapeCount.get(shapeK) ?? 0) >= MAX_OFFERS_PER_SHAPE) continue;
      if ((anchorCount.get(anchorK) ?? 0) >= MAX_OFFERS_PER_ANCHOR) continue;

      seen.add(sig);
      shapeCount.set(shapeK, (shapeCount.get(shapeK) ?? 0) + 1);
      anchorCount.set(anchorK, (anchorCount.get(anchorK) ?? 0) + 1);
      const arr = collected.get(thesisId) ?? [];
      arr.push({
        narrativeArchetype: meta.archetype,
        thesisId,
        tier: meta.tier,
        side: meta.side,
        anchor: meta.anchor,
        partnerTeam: offer.partnerTeamName,
        offer,
      });
      collected.set(thesisId, arr);
    }
  };

  const runMatch = (match: Match) => {
    const thesisId = resolveThesisId(match);
    const timeline = byId.get(thesisId)?.timeline ?? "build_future";
    for (const { req, mode } of requestForMatch(slate.rosterId, match, ec, timeline)) {
      runRequest(
        thesisId,
        req,
        mode,
        { archetype: match.narrativeArchetype, tier: match.tier, side: match.side, anchor: match.anchor },
        match.partnerRosterId,
      );
    }
  };

  // Tier 1 first (narrative wins the dedupe), then the floor.
  for (const match of slate.tier1) runMatch(match);
  for (const match of slate.tier2) runMatch(match);

  // ── Vet-liquidation packaging pass ────────────────────────────────────────
  // Low-value vets fetch little solo. On a build, also offer them PACKAGED one-
  // per-position (Mason RB + Shaheed WR) into a single pick return, in OPEN
  // counterparty mode so the constructor finds whatever pick-rich team bites.
  const buildThesis = theses.find((t) => t.source === "intent" && t.timeline === "build_future");
  if (buildThesis) {
    const spendable = spendableOf(buildThesis.id);
    // One vet-liq anchor per bucket (highest value), only fence-spendable ones.
    const byBucket = new Map<ABucket, { key: string; value: number; name: string }>();
    for (const m of slate.tier1) {
      if (m.side !== "we_sell" || m.narrativeArchetype !== "vet_liquidation") continue;
      if (m.anchorBucket === "PICK" || !spendable.has(m.anchorKey)) continue;
      const b = m.anchorBucket as ABucket;
      const value = ec.data.values.value.get(m.anchorKey) ?? 0;
      const cur = byBucket.get(b);
      if (!cur || value > cur.value) {
        byBucket.set(b, { key: m.anchorKey, value, name: ec.data.players.get(m.anchorKey)?.name ?? m.anchorKey });
      }
    }
    const anchors = [...byBucket.values()];
    const tier = pickTierFor(ec.data.strategy.get(slate.rosterId) ?? null);
    for (let i = 0; i < anchors.length; i++) {
      for (let j = i + 1; j < anchors.length; j++) {
        const a = anchors[i], b = anchors[j];
        runRequest(
          buildThesis.id,
          {
            ourTeamId: slate.rosterId,
            offeringTeamId: slate.rosterId,
            intent: "shop",
            anchors: [{ key: a.key, side: "send" }, { key: b.key, side: "send" }],
            counterparty: { mode: "open" },
            leans: [],
            aimAt: "us",
            returnShape: { preferPickTier: tier, preferBuckets: [], youthBuckets: [], strength: "hard" },
          },
          `pkg_${a.key}_${b.key}`,
          { archetype: "vet_liquidation", tier: 1, side: "we_sell", anchor: `${a.name} + ${b.name}` },
          null,
        );
      }
    }
  }

  return theses
    .map((t) => ({ thesis: t, offers: collected.get(t.id) ?? [] }))
    .filter((to) => to.offers.length > 0);
}