// src/lib/trade/studio/engine.ts
//
// Trade Studio engine — main entry.
//
// Pipeline:
//   1. Dispatch to per-persona candidate generator (candidates.ts)
//   2. Filter dealbreakers (AGING BENCH GUY, partner untouchables in receive,
//      alarm-severity post-trade warnings)
//   3. Score each candidate's gap (computeGap from core)
//   4. Filter by persona's ratio bounds (PersonaConfig.ratioMin/Max)
//   5. Rank by:
//        (a) WANTS_MORE matches (count-based with caps in core/ranking)
//        (b) market complementarity
//        (c) ratio closeness to 1.0 (final tiebreaker)
//   6. Build slate up to 5, preferring partner variety
//
// v3.4 changes from v3.3:
//   - FitScore math is gone. Single source of fairness = computeGap.
//   - No fallback Pass-3. Empty slate → empty slate. UI shows the message.
//   - StudioOffer carries valueGap + gradeLabel + gradeColor (computed here,
//     consumed by OfferCard's TradeBalanceChip).
//   - Drops applyShapeSignature (More Like This feature removed).

import { computeGap, gradeFromVerdict } from "../core/gap";
import { computePostTradeWarnings } from "../core/warnings";
import { scoreWantsMatch, countComplementarity } from "../core/ranking";
import { sumValue, isAgingBenchGuy } from "../core/classification";
import type { RosterAsset, DealAsset, PersonaKey } from "../core/types";
import { getPersona } from "./persona";
import { generateCandidates, type CandidateOffer } from "./candidates";
import type {
  StudioOffer,
  StudioEngineContext,
  StudioPartner,
  OfferAssetSimple,
  GenerationResult,
} from "./types";

const SLATE_SIZE = 5;

// ─── Asset conversion ────────────────────────────────────────────────────

function toOfferAsset(a: RosterAsset): OfferAssetSimple {
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

function toDealAssets(c: CandidateOffer, myTeamId: string, partnerTeamId: string): DealAsset[] {
  return [
    ...c.send.map(a => ({ key: a.key, name: a.name, fromTeamId: myTeamId, toTeamId: partnerTeamId })),
    ...c.receive.map(a => ({ key: a.key, name: a.name, fromTeamId: partnerTeamId, toTeamId: myTeamId })),
  ];
}

// ─── Dealbreaker filter ──────────────────────────────────────────────────

function violatesDealbreakers(
  c: CandidateOffer,
  ctx: StudioEngineContext,
  partner: StudioPartner,
): boolean {
  // AGING BENCH GUY in any deal asset (currently no-op — client doesn't
  // ship isAging flags. Wired up for when the dealbreaker is enforced.)
  for (const a of [...c.send, ...c.receive]) {
    if (isAgingBenchGuy(a)) return true;
  }
  // Partner untouchables on receive side
  for (const a of c.receive) {
    if (a.tier === "untouchable") return true;
  }
  // Alarm-severity post-trade warnings
  const dealAssets = toDealAssets(c, ctx.myTeamId, partner.teamId);
  const rosters: Record<string, RosterAsset[]> = {
    [ctx.myTeamId]: ctx.myRoster,
    [partner.teamId]: partner.roster,
  };
  const warnings = computePostTradeWarnings(dealAssets, rosters, ctx.myTeamId);
  if (warnings.some(w => w.severity === "alarm")) return true;
  return false;
}

// ─── Scoring ─────────────────────────────────────────────────────────────

type ScoredCandidate = {
  offer: StudioOffer;
  wantsMatches: number;
  complementarity: number;
  raw: CandidateOffer;
};

function scoreCandidate(
  c: CandidateOffer,
  ctx: StudioEngineContext,
  partner: StudioPartner,
  personaKey: PersonaKey,
): ScoredCandidate {
  const dealAssets = toDealAssets(c, ctx.myTeamId, partner.teamId);
  const rosters: Record<string, RosterAsset[]> = {
    [ctx.myTeamId]: ctx.myRoster,
    [partner.teamId]: partner.roster,
  };

  const valueGap = computeGap(dealAssets, rosters, ctx.myTeamId);
  const grade = gradeFromVerdict(valueGap.verdict);

  const wantsMatches = ctx.myProfile
    ? scoreWantsMatch(c.receive, ctx.myProfile.wants_more)
    : 0;
  const complementarity = countComplementarity(ctx.myProfile, partner.profile);

  const offer: StudioOffer = {
    id: `studio-${partner.teamId}-${c.receive.map(a => a.key).join("-")}-${Date.now()}-${Math.random().toString(36).slice(2, 7)}`,
    partnerTeamId: partner.teamId,
    partnerTeamName: partner.teamName,
    persona: personaKey,
    send: c.send.map(toOfferAsset),
    receive: c.receive.map(toOfferAsset),
    sendValue: valueGap.sendValue,
    receiveValue: valueGap.receiveValue,
    valueGap,
    gradeLabel: grade.label,
    gradeColor: grade.color,
  };

  return { offer, wantsMatches, complementarity, raw: c };
}

// ─── Ranking ─────────────────────────────────────────────────────────────

function rank(a: ScoredCandidate, b: ScoredCandidate): number {
  if (a.wantsMatches !== b.wantsMatches) return b.wantsMatches - a.wantsMatches;
  if (a.complementarity !== b.complementarity) return b.complementarity - a.complementarity;
  const distA = Math.abs(a.offer.valueGap.ratio - 1.0);
  const distB = Math.abs(b.offer.valueGap.ratio - 1.0);
  return distA - distB;
}

function buildSlate(passing: ScoredCandidate[]): StudioOffer[] {
  const slate: StudioOffer[] = [];
  const seenIds = new Set<string>();
  const seenPartners = new Set<string>();

  // Pass 1: partner-unique (one offer per partner first)
  for (const s of passing) {
    if (slate.length >= SLATE_SIZE) break;
    if (seenPartners.has(s.offer.partnerTeamId)) continue;
    slate.push(s.offer);
    seenIds.add(s.offer.id);
    seenPartners.add(s.offer.partnerTeamId);
  }
  // Pass 2: allow partner repeats to fill remaining slots
  if (slate.length < SLATE_SIZE) {
    for (const s of passing) {
      if (slate.length >= SLATE_SIZE) break;
      if (seenIds.has(s.offer.id)) continue;
      slate.push(s.offer);
      seenIds.add(s.offer.id);
    }
  }
  return slate;
}

// ─── Public entry ────────────────────────────────────────────────────────

export type GenerateOptions = {
  personaOverride?: PersonaKey;
  anchorPartnerId?: string;
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

  // Optionally restrict to a single partner (used by persona toggle)
  const partnerList = options?.anchorPartnerId
    ? ctx.partners.filter(p => p.teamId === options.anchorPartnerId)
    : ctx.partners;
  const ctxFiltered: StudioEngineContext = { ...ctx, partners: partnerList };
  const partnersById = new Map(partnerList.map(p => [p.teamId, p]));

  // Step 1: candidates
  const candidates = generateCandidates(ctxFiltered, persona.key);

  // Step 2 + 3: filter dealbreakers, score
  const scored: ScoredCandidate[] = [];
  for (const c of candidates) {
    const partner = partnersById.get(c.partnerId);
    if (!partner) continue;
    if (violatesDealbreakers(c, ctxFiltered, partner)) continue;
    scored.push(scoreCandidate(c, ctxFiltered, partner, persona.key));
  }

  // Step 4: persona ratio gate
  const passing = scored.filter(s => {
    const r = s.offer.valueGap.ratio;
    return r >= persona.ratioMin && r <= persona.ratioMax;
  });

  // Step 5: rank
  passing.sort(rank);

  // Step 6: build slate (no fallback in v3.4)
  const offers = buildSlate(passing);

  return {
    offers,
    totalCandidatesEvaluated: candidates.length,
    isFallback: false,
  };
}
