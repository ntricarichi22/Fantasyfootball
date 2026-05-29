import { construct, type EngineContext } from "@/pro-personnel/engine";
import type { DealRequest, EngineOffer, Lean, Intent } from "@/pro-personnel/engine";
import type { ArchetypeName } from "@/shared/team-narratives";
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
function bestSellAnchorAtBucket(
  activeRosterId: string,
  bucket: string,
  ec: EngineContext
): string | null {
  const team = ec.data.teams.find((t) => t.rosterId === activeRosterId);
  if (!team) return null;
  const positions = positionsForBucket(bucket);
  if (positions.size === 0) return null;

  const profile = ec.profiles.find((p) => p.rosterId === activeRosterId) ?? null;
  const starterIds = new Set(
    (profile?.strength.lineup ?? []).map((s) => s.playerId).filter((id): id is string => !!id)
  );

  const candidates = team.players
    .filter((p) => positions.has(p.position.toUpperCase()))
    .filter((p) => !starterIds.has(p.id)) // don't ship a starter into a hole
    .map((p) => ({ id: p.id, value: ec.data.values.value.get(p.id) ?? 0 }))
    .sort((a, b) => b.value - a.value);

  return candidates[0]?.id ?? null;
}

function requestForMatch(
  activeRosterId: string,
  match: Match,
  ec: EngineContext
): DealRequest | null {
  // Pick-anchored sells aren't matched today (deferred to pick-for-pick logic).
  if (match.anchorBucket === "PICK") return null;

  // ── Tier 1: narrative-driven, anchored on a named player. ────────────────
  if (match.tier === 1) {
    if (match.side === "we_sell") {
      return {
        ourTeamId: activeRosterId,
        offeringTeamId: activeRosterId,
        intent: "shop" as Intent,
        anchors: [{ key: match.anchorKey, side: "send" }],
        counterparty: { mode: "locked", teamIds: [match.partnerRosterId] },
        leans: leansFor(match.narrativeArchetype),
        aimAt: "us",
      };
    }
    // we_buy: the anchor is the partner's piece we want.
    return {
      ourTeamId: activeRosterId,
      offeringTeamId: activeRosterId,
      intent: "acquire" as Intent,
      anchors: [{ key: match.anchorKey, side: "receive" }],
      counterparty: { mode: "locked", teamIds: [match.partnerRosterId] },
      leans: leansFor(match.narrativeArchetype),
      aimAt: "us",
    };
  }

  // ── Tier 2: stated-market floor, anchored on a BUCKET, not a player. ──────
  // The match says "we buy/sell this position with this partner" off the
  // owner's market toggle. There's no narrative and no named anchor, so we
  // translate the bucket into a concrete request the constructor can run.
  if (match.side === "we_buy") {
    // Acquire-with-no-anchor: the constructor discovers the best-fit target at
    // a position we have demand for, on this partner. Exactly the existing
    // buy-side discovery path — no new logic.
    return {
      ourTeamId: activeRosterId,
      offeringTeamId: activeRosterId,
      intent: "acquire" as Intent,
      anchors: [],
      counterparty: { mode: "locked", teamIds: [match.partnerRosterId] },
      leans: [],
      aimAt: "us",
    };
  }

  // we_sell floor: the constructor has no "discover what of OURS to ship" path,
  // so the adapter picks our best sheddable piece at the bucket and seeds it.
  const sellKey = bestSellAnchorAtBucket(activeRosterId, match.anchorBucket, ec);
  if (!sellKey) return null;
  return {
    ourTeamId: activeRosterId,
    offeringTeamId: activeRosterId,
    intent: "shop" as Intent,
    anchors: [{ key: sellKey, side: "send" }],
    counterparty: { mode: "locked", teamIds: [match.partnerRosterId] },
    leans: [],
    aimAt: "us",
  };
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
    const req = requestForMatch(slate.rosterId, match, ec);
    if (!req) return;
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
  };

  // Tier 1 first (narrative-driven), so a narrative offer wins the de-dupe over
  // an identical bucket-driven floor offer and keeps its storyline label.
  for (const match of slate.tier1) runMatch(match);
  for (const match of slate.tier2) runMatch(match);
  return out;
}