// Trade Studio engine — main entry.
//
// Pipeline:
//   1. Dispatch to per-persona candidate generator (candidates.ts).
//   2. Score every candidate with WORKS FOR YOU and WORKS FOR THEM.
//   3. Apply the persona's color-signature gates (yourFit / theirFit ranges).
//   4. Rank passing candidates by:
//        (a) WANTS_MORE matches (count of want-buckets the receive bundle hits)
//        (b) complementarity (count of inverted BUY/SELL signals with partner)
//        (c) sum of fit scores as a tiebreaker
//   5. Build slate (5 offers), preferring partner variety.
//   6. If slate < 5, run fallback candidate set with looser bounds and ship
//      whatever fills the remaining slots, marked isFallback.
//
// Component scoring is recipient-perspective (asymmetric fair value via sigmoid)
// and combines fair value, position-need fit, WANTS_MORE fit, post-trade roster
// shape, and source-side attachment penalty.

import { computePostTradeWarnings, type RosterAsset, type DealAsset } from "../advisor/engine";
import { getPersona, type PersonaKey } from "./persona";
import { generateCandidates, generateFallbackCandidates, type CandidateOffer } from "./candidates";
import { countWantsMoreMatches, countComplementarity, sumValue } from "./classification";
import type {
  StudioAsset,
  StudioStrategyProfile,
  StudioOffer,
  StudioEngineContext,
  StudioPartner,
  FitScore,
  OfferAssetSimple,
  GenerationResult,
} from "./types";

// ─── Constants ───────────────────────────────────────────────────────────

const SLATE_SIZE = 5;
const FIT_WEIGHTS = {
  fairValue: 0.40,
  positionNeed: 0.15,
  wantsMore: 0.15,
  rosterShape: 0.20,
  attachment: 0.10,
};
const ATTACHMENT_PENALTY: Record<string, number> = {
  moveable: 0,
  listening: 12,
  core: 25,
  core_piece: 25,
  untouchable: 50,
};
const SHAPE_PENALTY_BY_SEVERITY: Record<string, number> = {
  alarm: 35,
  warning: 15,
  info: 5,
};

// ─── Asymmetric fair value ───────────────────────────────────────────────
// Recipient-perspective sigmoid:
//   ratio = received / sent
//   1.0 → ~80, 1.2 → ~89, 0.8 → ~67, 0.5 → ~36

function scoreFairValueAsymmetric(receivedValue: number, sentValue: number): number {
  if (sentValue <= 0 && receivedValue <= 0) return 50;
  if (sentValue <= 0) return 100;
  if (receivedValue <= 0) return 0;
  const logR = Math.log(receivedValue / sentValue);
  const score = 100 / (1 + Math.exp(-3 * (logR + 0.5)));
  return Math.max(0, Math.min(100, score));
}

// ─── Component scorers ──────────────────────────────────────────────────

function scorePositionNeed(
  received: StudioAsset[],
  sent: StudioAsset[],
  profile: StudioStrategyProfile | null,
): number {
  if (!profile) return 70;
  const marketFor = (pos: string): string => {
    if (pos === "QB") return profile.qb_market;
    if (pos === "RB") return profile.rb_market;
    if (pos === "WR" || pos === "TE") return profile.wr_market;
    if (pos === "PICK") return profile.picks_market;
    return "hold";
  };
  let score = 70;
  for (const a of received) {
    const m = marketFor(a.position === "PICK" ? "PICK" : a.position);
    if (m === "buy") score += 8;
    else if (m === "sell") score -= 5;
  }
  for (const a of sent) {
    const m = marketFor(a.position === "PICK" ? "PICK" : a.position);
    if (m === "buy") score -= 8;
    else if (m === "sell") score += 5;
  }
  return Math.max(0, Math.min(100, score));
}

function scoreWantsMore(
  received: StudioAsset[],
  sent: StudioAsset[],
  profile: StudioStrategyProfile | null,
): number {
  if (!profile) return 70;
  const wants = new Set(profile.wants_more ?? []);
  if (wants.size === 0) return 70;
  let score = 70;
  for (const a of received) {
    if (wants.has("elite_producers") && a.isStud) score += 12;
    if (wants.has("young_upside") && a.isYouth) score += 8;
    if (wants.has("draft_picks") && a.type === "pick") score += 10;
    if (wants.has("roster_depth") && a.type === "player" && !a.isStud) score += 4;
  }
  for (const a of sent) {
    if (wants.has("elite_producers") && a.isStud) score -= 8;
    if (wants.has("young_upside") && a.isYouth) score -= 6;
    if (wants.has("draft_picks") && a.type === "pick") score -= 8;
  }
  return Math.max(0, Math.min(100, score));
}

function studioToRoster(a: StudioAsset): RosterAsset {
  return {
    key: a.key, name: a.name, position: a.position, posGroup: a.posGroup,
    value: a.value, tier: a.tier, type: a.type,
    isStud: a.isStud, isYouth: a.isYouth, meta: a.meta, rosterMeta: a.rosterMeta,
  };
}

function scoreRosterShape(
  myRoster: StudioAsset[],
  send: StudioAsset[],
  receive: StudioAsset[],
  myTeamId: string,
  partnerTeamId: string,
): number {
  const dealAssets: DealAsset[] = [
    ...send.map(a => ({ key: a.key, name: a.name, fromTeamId: myTeamId, toTeamId: partnerTeamId })),
    ...receive.map(a => ({ key: a.key, name: a.name, fromTeamId: partnerTeamId, toTeamId: myTeamId })),
  ];
  const rosters: Record<string, RosterAsset[]> = {
    [myTeamId]: myRoster.map(studioToRoster),
    [partnerTeamId]: receive.map(studioToRoster),
  };
  const warnings = computePostTradeWarnings(dealAssets, rosters, myTeamId);
  let score = 100;
  for (const w of warnings) score -= SHAPE_PENALTY_BY_SEVERITY[w.severity] ?? 5;
  return Math.max(0, Math.min(100, score));
}

function scoreAttachment(send: StudioAsset[]): number {
  let score = 100;
  for (const a of send) score -= ATTACHMENT_PENALTY[a.tier] ?? 0;
  return Math.max(0, Math.min(100, score));
}

// ─── Composite fit ──────────────────────────────────────────────────────

function computeFit(
  receivedValue: number,
  sentValue: number,
  received: StudioAsset[],
  sent: StudioAsset[],
  profile: StudioStrategyProfile | null,
  rosterForShape: StudioAsset[],
  myId: string,
  partnerId: string,
): FitScore {
  const fairValue = scoreFairValueAsymmetric(receivedValue, sentValue);
  const positionNeed = scorePositionNeed(received, sent, profile);
  const wantsMore = scoreWantsMore(received, sent, profile);
  const rosterShape = scoreRosterShape(rosterForShape, sent, received, myId, partnerId);
  const attachment = scoreAttachment(sent);
  const total =
    fairValue * FIT_WEIGHTS.fairValue +
    positionNeed * FIT_WEIGHTS.positionNeed +
    wantsMore * FIT_WEIGHTS.wantsMore +
    rosterShape * FIT_WEIGHTS.rosterShape +
    attachment * FIT_WEIGHTS.attachment;
  return {
    total: Math.round(total),
    fairValue: Math.round(fairValue),
    positionNeed: Math.round(positionNeed),
    wantsMore: Math.round(wantsMore),
    rosterShape: Math.round(rosterShape),
    attachment: Math.round(attachment),
  };
}

// ─── Asset conversion ────────────────────────────────────────────────────

function toOfferAsset(a: StudioAsset): OfferAssetSimple {
  const parts = (a.meta ?? "").split(" \u00b7 ");
  return {
    key: a.key,
    name: a.name,
    type: a.type,
    position: a.type === "player" ? parts[0] : undefined,
    team: a.type === "player" ? parts[1] : undefined,
    ageLabel: a.type === "player" ? parts[2] : undefined,
    value: a.value,
  };
}

// ─── Scoring & ranking ───────────────────────────────────────────────────

type ScoredCandidate = {
  offer: StudioOffer;
  wantsMatches: number;
  complementarity: number;
  fitTotal: number;
  raw: CandidateOffer;
};

function scoreCandidate(
  c: CandidateOffer,
  ctx: StudioEngineContext,
  partnersById: Map<string, StudioPartner>,
  personaKey: PersonaKey,
): ScoredCandidate | null {
  const partner = partnersById.get(c.partnerId);
  if (!partner) return null;

  const sendV = sumValue(c.send);
  const receiveV = sumValue(c.receive);

  const worksForYou = computeFit(
    receiveV, sendV,
    c.receive, c.send,
    ctx.myProfile, ctx.myRoster, ctx.myTeamId, partner.teamId,
  );
  const worksForThem = computeFit(
    sendV, receiveV,
    c.send, c.receive,
    partner.profile, partner.roster, partner.teamId, ctx.myTeamId,
  );

  const wantsMatches = ctx.myProfile
    ? countWantsMoreMatches(c.receive, ctx.myProfile.wants_more)
    : 0;
  const complementarity = countComplementarity(ctx.myProfile, partner.profile);

  const offer: StudioOffer = {
    id: `studio-${partner.teamId}-${c.receive.map(a => a.key).join("-")}-${Date.now()}-${Math.random().toString(36).slice(2, 7)}`,
    partnerTeamId: partner.teamId,
    partnerTeamName: partner.teamName,
    persona: personaKey,
    send: c.send.map(toOfferAsset),
    receive: c.receive.map(toOfferAsset),
    worksForYou,
    worksForThem,
    sendValue: sendV,
    receiveValue: receiveV,
  };

  return {
    offer,
    wantsMatches,
    complementarity,
    fitTotal: worksForYou.total + worksForThem.total,
    raw: c,
  };
}

function applyShapeSignature(
  scored: ScoredCandidate[],
  sig?: GenerateOptions["shapeSignature"],
): ScoredCandidate[] {
  if (!sig) return scored;
  return scored.filter(s =>
    s.raw.send.length === sig.sendCount &&
    s.raw.receive.length === sig.receiveCount &&
    sumValue(s.raw.receive) >= sig.receiveValueMin &&
    sumValue(s.raw.receive) <= sig.receiveValueMax,
  );
}

function rank(a: ScoredCandidate, b: ScoredCandidate): number {
  if (a.wantsMatches !== b.wantsMatches) return b.wantsMatches - a.wantsMatches;
  if (a.complementarity !== b.complementarity) return b.complementarity - a.complementarity;
  return b.fitTotal - a.fitTotal;
}

function buildSlate(
  primary: ScoredCandidate[],
  fallback: ScoredCandidate[],
): { offers: StudioOffer[]; isFallback: boolean } {
  const slate: StudioOffer[] = [];
  const seenIds = new Set<string>();
  const seenPartners = new Set<string>();

  // Pass 1: primary, partner-unique
  for (const s of primary) {
    if (slate.length >= SLATE_SIZE) break;
    if (seenPartners.has(s.offer.partnerTeamId)) continue;
    slate.push(s.offer);
    seenIds.add(s.offer.id);
    seenPartners.add(s.offer.partnerTeamId);
  }
  // Pass 2: primary, allow partner repeats
  if (slate.length < SLATE_SIZE) {
    for (const s of primary) {
      if (slate.length >= SLATE_SIZE) break;
      if (seenIds.has(s.offer.id)) continue;
      slate.push(s.offer);
      seenIds.add(s.offer.id);
    }
  }

  // Pass 3: fallback, marked isFallback
  let usedFallback = false;
  if (slate.length < SLATE_SIZE) {
    for (const s of fallback) {
      if (slate.length >= SLATE_SIZE) break;
      if (seenIds.has(s.offer.id)) continue;
      slate.push({ ...s.offer, isFallback: true });
      seenIds.add(s.offer.id);
      usedFallback = true;
    }
  }
  return { offers: slate, isFallback: usedFallback };
}

// ─── Public entry ────────────────────────────────────────────────────────

export type GenerateOptions = {
  personaOverride?: PersonaKey;
  anchorPartnerId?: string;
  shapeSignature?: { sendCount: number; receiveCount: number; receiveValueMin: number; receiveValueMax: number };
};

export function generateStudioOffers(
  ctx: StudioEngineContext,
  options?: GenerateOptions,
): GenerationResult {
  if (ctx.shopList.length === 0) {
    return { offers: [], totalCandidatesEvaluated: 0, isFallback: false };
  }
  if (sumValue(ctx.shopList) <= 0) {
    return { offers: [], totalCandidatesEvaluated: 0, isFallback: false };
  }

  const persona = getPersona(options?.personaOverride ?? ctx.myPersona);

  // Optionally restrict to a single partner (used for "more like this" anchor)
  const partnerList = options?.anchorPartnerId
    ? ctx.partners.filter(p => p.teamId === options.anchorPartnerId)
    : ctx.partners;
  const ctxFiltered: StudioEngineContext = { ...ctx, partners: partnerList };
  const partnersById = new Map(partnerList.map(p => [p.teamId, p]));

  // Step 1: candidates
  const candidates = generateCandidates(ctxFiltered, persona.key);

  // Step 2: score
  let scored: ScoredCandidate[] = [];
  for (const c of candidates) {
    const s = scoreCandidate(c, ctxFiltered, partnersById, persona.key);
    if (s) scored.push(s);
  }
  scored = applyShapeSignature(scored, options?.shapeSignature);

  // Step 3: persona color-signature gates
  const passing = scored.filter(s =>
    s.offer.worksForYou.total >= persona.yourFitMin &&
    s.offer.worksForYou.total <= persona.yourFitMax &&
    s.offer.worksForThem.total >= persona.theirFitMin &&
    s.offer.worksForThem.total <= persona.theirFitMax,
  );

  // Step 4: rank
  passing.sort(rank);

  // Step 5/6: build slate, fall back if short
  let fallbackScored: ScoredCandidate[] = [];
  if (passing.length < SLATE_SIZE) {
    const fb = generateFallbackCandidates(ctxFiltered);
    for (const c of fb) {
      const s = scoreCandidate(c, ctxFiltered, partnersById, persona.key);
      if (s) fallbackScored.push(s);
    }
    fallbackScored = applyShapeSignature(fallbackScored, options?.shapeSignature);
    fallbackScored.sort(rank);
  }

  const { offers, isFallback } = buildSlate(passing, fallbackScored);

  return {
    offers,
    totalCandidatesEvaluated: candidates.length + fallbackScored.length,
    isFallback,
  };
}
