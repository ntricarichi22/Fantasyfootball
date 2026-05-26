// src/pro-personnel/engine/pricing.ts
//
// Two-scoreboard pricing, sourced entirely from the shared valuation brain
// (@/shared/asset-values). There is no universal price: each side prices its
// OWN assets at its team-specific value (valueAsset with that team's
// perspective → cfc_team_trade_values_current.final_value) and fills the OTHER
// side at the neutral CFC base (valueAsset with no perspective). The two
// unknowable squares — what we think their guys are worth, what they think ours
// are worth — are filled with base, never faked.
//
//   Our scoreboard:   our assets @ OUR perspective,    their assets @ base.
//   Their scoreboard: their assets @ THEIR perspective, our assets @ base.
//
// Crucially, valueAsset folds in everything the owner baked into final_value —
// own-guys/untouchable bumps, draft-class strength, manual overrides — so we
// NEVER re-apply those modifiers here. We just read the number. Picks inherit
// the shared future-pick logic (original owner's tier → slot → year discount)
// for free.
//
// Both reads still run through core/gap.computeGap so the ratio/verdict
// vocabulary the chip + persona bands expect is identical to before — we just
// stamp each asset's lens value onto a RosterAsset row first.

import { computeGap } from "@/pro-personnel/engine/core/gap";
import type { DealAsset, RosterAsset } from "@/pro-personnel/engine/core/types";
import { bandFor } from "@/pro-personnel/engine/core/personas";
import { valueAsset, type AssetRef, type ValuationContext } from "@/shared/asset-values";
import type {
  EngineOfferAsset,
  PartnerRead,
  PersonaKey,
  PricingLens,
  Scoreboard,
} from "./types";

// The full pricing input for a single deal. The route builds the shared
// ValuationContext once and hands it in; the engine never touches the DB.
export type PricingInput = {
  ourTeamId: string;
  partnerTeamId: string;
  assets: EngineOfferAsset[];
  ctx: ValuationContext;
};

// Engine asset → the shared AssetRef the valuation brain consumes. Player keys
// are sleeper ids; pick keys are canonical pick keys. Same key shape shared
// uses, so this is a straight tag, no translation.
function toRef(a: EngineOfferAsset): AssetRef {
  return a.type === "pick"
    ? { type: "pick", key: a.key }
    : { type: "player", sleeperPlayerId: a.key };
}

// Resolve one asset's value under one lens. The reader prices its OWN assets at
// its team-specific final_value (perspective); everything else at neutral base.
function valueFor(
  a: EngineOfferAsset,
  ownerIsReader: boolean,
  readerTeamId: string,
  ctx: ValuationContext,
): number {
  const ref = toRef(a);
  return ownerIsReader
    ? valueAsset(ref, ctx, { perspective: readerTeamId })
    : valueAsset(ref, ctx);
}

// Build the RosterAsset table computeGap expects, for ONE lens. computeGap sums
// asset.value off rosters[fromTeamId], so we stamp each asset's value as seen by
// the reader and bucket it under its owning team id.
function rostersForLens(
  input: PricingInput,
  lens: PricingLens,
): { rosters: Record<string, RosterAsset[]>; deal: DealAsset[]; myTeamId: string } {
  const { ourTeamId, partnerTeamId, assets, ctx } = input;
  const readerTeamId = lens === "ours" ? ourTeamId : partnerTeamId;

  // Asset owner: send-side assets are ours, receive-side are the partner's
  // (all from OUR perspective, which is how EngineOfferAsset.side is defined).
  const rosters: Record<string, RosterAsset[]> = { [ourTeamId]: [], [partnerTeamId]: [] };
  const deal: DealAsset[] = [];

  for (const a of assets) {
    const ownerTeamId = a.side === "send" ? ourTeamId : partnerTeamId;
    const ownerIsReader = ownerTeamId === readerTeamId;
    const value = valueFor(a, ownerIsReader, readerTeamId, ctx);

    rosters[ownerTeamId].push({
      key: a.key,
      name: a.name,
      position: "",
      posGroup: "",
      type: a.type,
      meta: "",
      rosterMeta: "",
      value,
      tier: "",
      isStud: false,
      isYouth: false,
    });

    // computeGap reads ratio from the READER's seat: an asset they own and are
    // giving up is a "send"; an asset coming to them is "receive".
    const fromTeamId = ownerTeamId;
    const toTeamId = ownerTeamId === ourTeamId ? partnerTeamId : ourTeamId;
    deal.push({ key: a.key, name: a.name, fromTeamId, toTeamId });
  }

  return { rosters, deal, myTeamId: readerTeamId };
}

// One lens → one Scoreboard. ratio/verdict come straight from core gap math.
export function scoreboardFor(input: PricingInput, lens: PricingLens): Scoreboard {
  const { rosters, deal, myTeamId } = rostersForLens(input, lens);
  const gap = computeGap(deal, rosters, myTeamId);
  return {
    lens,
    sendValue: gap.sendValue,
    receiveValue: gap.receiveValue,
    ratio: gap.ratio,
    verdict: gap.verdict,
  };
}

// Both scoreboards for a deal.
export function priceDeal(input: PricingInput): { ours: Scoreboard; theirs: Scoreboard } {
  return {
    ours: scoreboardFor(input, "ours"),
    theirs: scoreboardFor(input, "theirs"),
  };
}

// ─── Partner read (additive signal; chip still shows OUR view) ───────────────
//
// How the deal lands for the partner, judged against their persona band on
// THEIR scoreboard. "likely" inside band; "needs_selling" just outside (within
// ~10% of the band edge — a sell, not a fantasy); "long_shot" beyond that.

const NEAR_MISS_TOLERANCE = 0.1;

export function partnerReadFrom(theirs: Scoreboard, partnerPersona: PersonaKey): PartnerRead {
  const band = bandFor(partnerPersona);
  const r = theirs.ratio;
  if (r >= band.min && r <= band.max) return "likely";
  // Below the floor = the partner is overpaying past their tolerance — that's
  // the relevant near-miss direction when WE built an aggressive deal.
  const distanceBelow = band.min - r;
  if (distanceBelow > 0 && distanceBelow <= NEAR_MISS_TOLERANCE) return "needs_selling";
  // Above the ceiling rarely blocks (they're winning), but keep it honest.
  const distanceAbove = r - band.max;
  if (distanceAbove > 0 && distanceAbove <= NEAR_MISS_TOLERANCE) return "needs_selling";
  return "long_shot";
}

// Does the partner clear their band outright? (Used for EngineOffer.clears
// alongside our own grade.)
export function partnerClears(theirs: Scoreboard, partnerPersona: PersonaKey): boolean {
  const band = bandFor(partnerPersona);
  return theirs.ratio >= band.min && theirs.ratio <= band.max;
}