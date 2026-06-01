import { construct, type EngineContext } from "@/pro-personnel/engine";
import type { DealRequest, EngineOffer, Lean, Intent } from "@/pro-personnel/engine";
import type { ArchetypeName } from "@/shared/team-narratives";
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
  // Which match produced this, so the director can narrate under the storyline.
  narrativeArchetype: ArchetypeName;
  tier: Match["tier"];
  side: Match["side"];
  anchor: string;
  partnerTeam: string;
  offer: EngineOffer;
};

// Run every tier-1 match on a team's slate through the constructor and collect
// the offers, tagged with the narrative that drove each one. De-duped by the
// constructor's own slate logic per call; we just gather across matches.
export function generateOffersForTeam(
  slate: TeamSlate,
  ec: EngineContext
): GeneratedOffer[] {
  const out: GeneratedOffer[] = [];
  // De-dupe identical packages: the same trade can arise from more than one
  // match (e.g. consolidate + win-now on the same anchor, or a tier-1 narrative
  // and a tier-2 floor row pointing at the same deal). Key on partner + the
  // sorted asset keys so a human never sees the same trade twice.
  const seen = new Set<string>();

  const runMatch = (match: TeamSlate["tier1"][number]) => {
    const reqs = requestForMatch(slate.rosterId, match, ec);
    for (const req of reqs) {
      const result = construct(req, ec);
      for (const offer of result.offers) {
        // Locked counterparty should guarantee this, but be defensive.
        if (offer.partnerTeamId !== match.partnerRosterId) continue;
        const sig =
          offer.partnerTeamId +
          "|" +
          offer.assets
            .map((a) => `${a.side}:${a.key}`)
            .sort()
            .join(",");
        if (seen.has(sig)) continue;
        seen.add(sig);
        out.push({
          narrativeArchetype: match.narrativeArchetype,
          tier: match.tier,
          side: match.side,
          anchor: match.anchor,
          partnerTeam: match.partnerTeam,
          offer,
        });
      }
    }
  };

  // Tier 1 first (narrative-driven), so a narrative offer wins the de-dupe over
  // an identical bucket-driven floor offer and keeps its storyline label.
  for (const match of slate.tier1) runMatch(match);
  for (const match of slate.tier2) runMatch(match);
  return out;
}