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
function requestForMatch(activeRosterId: string, match: Match): DealRequest | null {
  // Pick-anchored sells aren't matched today (deferred to pick-for-pick logic),
  // and tier-2 floor rows carry a synthetic bucket anchor, not a real player
  // key — neither yields a constructor anchor, so skip.
  if (match.tier !== 1) return null;
  if (match.anchorBucket === "PICK") return null;

  if (match.side === "we_sell") {
    // We ship the anchor; shop it to the one matched partner.
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

  // we_buy: the anchor is the partner's piece we want; acquire it from them.
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
  for (const match of slate.tier1) {
    const req = requestForMatch(slate.rosterId, match);
    if (!req) continue;
    const result = construct(req, ec);
    for (const offer of result.offers) {
      // The constructor may return offers for several candidate targets; keep
      // only those actually with the matched partner (locked counterparty
      // should guarantee this, but be defensive).
      if (offer.partnerTeamId !== match.partnerRosterId) continue;
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
  return out;
}