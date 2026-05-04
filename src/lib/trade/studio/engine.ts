// Trade Studio engine — partner search, offer generation, fit scoring.
//
// Architecture:
//   1. For a given shop list (assets user has toggled Y), search across all
//      partners for candidate receive-side bundles that satisfy the persona's
//      target fit signature.
//   2. For each candidate, compute Works For You + Works For Them as weighted
//      averages of 5 components: fair value (40%), position needs (15%),
//      wants_more (15%), roster shape (20%), attachment (10%).
//   3. Rank, dedupe partners across the 5-offer slate, return.
//
// Reuses computePostTradeWarnings from advisor/engine.ts as the input to the
// roster-shape penalty, and the same gap math.

import { computeGap, computePostTradeWarnings, type RosterAsset, type DealAsset } from "../advisor/engine";
import type { PersonaKey, PersonaConfig } from "./persona";
import { getPersona } from "./persona";
import type {
  StudioAsset,
  StudioStrategyProfile,
  StudioOffer,
  StudioEngineContext,
  FitScore,
  OfferAssetSimple,
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
  listening: 15,
  core: 30,
  core_piece: 30,
  untouchable: 60,
};
const SHAPE_PENALTY_BY_SEVERITY: Record<string, number> = {
  alarm: 35,
  warning: 15,
  info: 5,
};
const MAX_CANDIDATES_PER_PARTNER = 6; // generate this many candidates, pick the best one

// ─── Helpers ─────────────────────────────────────────────────────────────

function studioAssetToRosterAsset(a: StudioAsset): RosterAsset {
  return {
    key: a.key,
    name: a.name,
    position: a.position,
    posGroup: a.posGroup,
    value: a.value,
    tier: a.tier,
    type: a.type,
    isStud: a.isStud,
    isYouth: a.isYouth,
    meta: a.meta,
    rosterMeta: a.rosterMeta,
  };
}

function toOfferAsset(a: StudioAsset): OfferAssetSimple {
  // Parse "QB · DEN · 25" → {position: "QB", team: "DEN", ageLabel: "25"}
  const parts = a.meta.split(" · ");
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

// ─── Component scorers ───────────────────────────────────────────────────
// Each returns 0-100. The 5 components are then weighted and summed.

/**
 * Fair value share — how close is the trade to even-up?
 * 100 = exact match. Drops as ratio diverges.
 *
 * Direction matters: "Works for you" wants me to receive ≥ what I send.
 * "Works for them" wants partner to receive ≥ what they send.
 *
 * Symmetric scoring: a 1.10 ratio in your favor = 90/100 for you, 80/100 for them.
 */
function scoreFairValue(receivedValue: number, sentValue: number): number {
  if (sentValue <= 0 && receivedValue <= 0) return 0;
  if (sentValue <= 0) return 100;
  if (receivedValue <= 0) return 0;

  const ratio = receivedValue / sentValue;
  // ratio of 1.0 = perfect match = 100
  // ratio of 0.8 or 1.25 = 70
  // ratio of 0.5 or 2.0 = 30
  // ratio of 0.25 or 4.0 = 0
  const deviation = Math.abs(Math.log(ratio));  // log so 0.5 and 2.0 are symmetric
  const score = 100 * Math.exp(-2.0 * deviation);
  return Math.max(0, Math.min(100, score));
}

/**
 * Position-need fit — does the receive side match positions I'm buying?
 * Each player I receive at a buy position adds points; receiving at sell position
 * subtracts. Picks score against picks_market.
 */
function scorePositionNeed(
  received: StudioAsset[],
  sent: StudioAsset[],
  profile: StudioStrategyProfile | null
): number {
  if (!profile) return 70; // neutral when we have no data

  const marketFor = (pos: string): string => {
    if (pos === "QB") return profile.qb_market;
    if (pos === "RB") return profile.rb_market;
    if (pos === "WR" || pos === "TE") return profile.wr_market;
    if (pos === "PICK") return profile.picks_market;
    return "hold";
  };

  let score = 70; // start neutral
  for (const a of received) {
    const m = marketFor(a.position === "PICK" ? "PICK" : a.position);
    if (m === "buy") score += 8;
    else if (m === "sell") score -= 5;
  }
  for (const a of sent) {
    const m = marketFor(a.position === "PICK" ? "PICK" : a.position);
    if (m === "buy") score -= 8;     // sending what you said you want is bad
    else if (m === "sell") score += 5; // sending what you said you'd move is good
  }
  return Math.max(0, Math.min(100, score));
}

/**
 * Wants_more fit — does the deal align with stud/youth/picks/depth flags?
 */
function scoreWantsMore(
  received: StudioAsset[],
  sent: StudioAsset[],
  profile: StudioStrategyProfile | null
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

/**
 * Roster shape — reuses computePostTradeWarnings from advisor/engine.ts.
 * Each warning translates to a penalty against a 100-point baseline.
 */
function scoreRosterShape(
  myRoster: StudioAsset[],
  send: StudioAsset[],
  receive: StudioAsset[],
  myTeamId: string,
  partnerTeamId: string
): number {
  // Reuse the existing post-trade warning logic
  const dealAssets: DealAsset[] = [
    ...send.map(a => ({ key: a.key, name: a.name, fromTeamId: myTeamId, toTeamId: partnerTeamId })),
    ...receive.map(a => ({ key: a.key, name: a.name, fromTeamId: partnerTeamId, toTeamId: myTeamId })),
  ];
  const rosters: Record<string, RosterAsset[]> = {
    [myTeamId]: myRoster.map(studioAssetToRosterAsset),
    // Partner roster only needs the assets being received (so warning fn can find them by key)
    [partnerTeamId]: receive.map(studioAssetToRosterAsset),
  };
  const warnings = computePostTradeWarnings(dealAssets, rosters, myTeamId);
  let score = 100;
  for (const w of warnings) {
    score -= SHAPE_PENALTY_BY_SEVERITY[w.severity] ?? 5;
  }
  return Math.max(0, Math.min(100, score));
}

/**
 * Attachment respect — penalty for shipping out tagged players.
 * User opted in by toggling Y, so this is a soft penalty, not a block.
 */
function scoreAttachment(send: StudioAsset[]): number {
  let score = 100;
  for (const a of send) {
    score -= ATTACHMENT_PENALTY[a.tier] ?? 0;
  }
  return Math.max(0, Math.min(100, score));
}

// ─── Composite fit calculation ───────────────────────────────────────────

function computeWorksForYou(
  send: StudioAsset[],
  receive: StudioAsset[],
  ctx: StudioEngineContext,
  partnerTeamId: string
): FitScore {
  const sendValue = send.reduce((s, a) => s + a.value, 0);
  const receiveValue = receive.reduce((s, a) => s + a.value, 0);

  const fairValue = scoreFairValue(receiveValue, sendValue);
  const positionNeed = scorePositionNeed(receive, send, ctx.myProfile);
  const wantsMore = scoreWantsMore(receive, send, ctx.myProfile);
  const rosterShape = scoreRosterShape(ctx.myRoster, send, receive, ctx.myTeamId, partnerTeamId);
  const attachment = scoreAttachment(send);

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

function computeWorksForThem(
  send: StudioAsset[],         // what I send (they receive)
  receive: StudioAsset[],      // what I receive (they send)
  partnerProfile: StudioStrategyProfile | null,
  partnerRoster: StudioAsset[],
  partnerTeamId: string,
  myTeamId: string
): FitScore {
  // Invert the perspective: from the partner's POV, "send" is what they're sending out (= my receive)
  // and "receive" is what they're getting in (= my send).
  const partnerSends = receive;   // they send these to me
  const partnerReceives = send;   // they receive these from me

  const sendValue = partnerSends.reduce((s, a) => s + a.value, 0);
  const receiveValue = partnerReceives.reduce((s, a) => s + a.value, 0);

  const fairValue = scoreFairValue(receiveValue, sendValue);
  const positionNeed = scorePositionNeed(partnerReceives, partnerSends, partnerProfile);
  const wantsMore = scoreWantsMore(partnerReceives, partnerSends, partnerProfile);
  const rosterShape = scoreRosterShape(partnerRoster, partnerSends, partnerReceives, partnerTeamId, myTeamId);
  const attachment = scoreAttachment(partnerSends); // do they respect their own attachments?

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

// ─── Candidate generation ───────────────────────────────────────────────

/**
 * For a partner, generate candidate receive-side bundles that target the
 * persona's fit signature.
 *
 * Strategy: build candidates at multiple target ratios and structure shapes,
 * score them all, return the top N.
 */
function generateCandidatesForPartner(
  shopList: StudioAsset[],
  partnerRoster: StudioAsset[],
  persona: PersonaConfig
): StudioAsset[][] {
  const sendValue = shopList.reduce((s, a) => s + a.value, 0);
  if (sendValue <= 0) return [];

  // Available pool from partner: exclude their untouchables (they wouldn't move them)
  // unless persona is Architect (creative deals can include "what if" stuff)
  const tierAllowed = persona.key === "architect"
    ? new Set(["moveable", "listening", "core", "core_piece"])
    : new Set(["moveable", "listening", "core", "core_piece"]); // exclude untouchable always
  const pool = partnerRoster
    .filter(a => a.value > 0 && tierAllowed.has(a.tier))
    .sort((a, b) => b.value - a.value);

  if (pool.length === 0) return [];

  // Target ratios per persona — Hustler aims low, Closer aims slightly above fair, etc.
  const targetRatios: number[] = (() => {
    switch (persona.key) {
      case "hustler":
        return [0.65, 0.72, 0.80];   // user receives ~65-80% of what they send → user-favored
      case "closer":
        return [1.00, 1.08, 1.15];   // sweetener allowed → partner-favored slightly
      case "architect":
        return [0.85, 1.00, 1.15];   // wide range, structure matters more than ratio
      case "straight_shooter":
      default:
        return [0.92, 1.00, 1.08];   // tight band around fair
    }
  })();

  const candidates: StudioAsset[][] = [];
  const seen = new Set<string>();
  const addIfNew = (combo: StudioAsset[]) => {
    if (combo.length === 0) return;
    const key = combo.map(c => c.key).sort().join("|");
    if (seen.has(key)) return;
    seen.add(key);
    candidates.push(combo);
  };

  for (const ratio of targetRatios) {
    const target = sendValue * ratio;

    // Single-asset candidates within ±15% of target
    for (const a of pool) {
      if (a.value >= target * 0.85 && a.value <= target * 1.15) {
        addIfNew([a]);
      }
    }

    // 2-asset candidates within ±10% of target
    const top = pool.slice(0, Math.min(20, pool.length));
    for (let i = 0; i < top.length && candidates.length < 30; i++) {
      for (let j = i + 1; j < top.length; j++) {
        const sum = top[i].value + top[j].value;
        if (sum >= target * 0.90 && sum <= target * 1.10) {
          // Architect prefers combos that include picks or asymmetric value
          if (persona.preferSimple && top.length >= 2) {
            // Skip 2-asset combos when we already have a clean 1-asset closer
            if (candidates.some(c => c.length === 1 && Math.abs(c[0].value - target) < target * 0.10)) {
              continue;
            }
          }
          addIfNew([top[i], top[j]]);
        }
      }
    }

    // 3-asset candidates only for Architect
    if (persona.allowExoticStructure) {
      for (let i = 0; i < Math.min(8, top.length) && candidates.length < 40; i++) {
        for (let j = i + 1; j < Math.min(10, top.length); j++) {
          for (let k = j + 1; k < Math.min(12, top.length); k++) {
            const sum = top[i].value + top[j].value + top[k].value;
            if (sum >= target * 0.92 && sum <= target * 1.08) {
              addIfNew([top[i], top[j], top[k]]);
            }
          }
        }
      }
    }
  }

  return candidates.slice(0, MAX_CANDIDATES_PER_PARTNER * targetRatios.length);
}

// ─── Persona-specific filtering ─────────────────────────────────────────

function passesPersonaSignature(
  worksForYou: FitScore,
  worksForThem: FitScore,
  persona: PersonaConfig
): boolean {
  const t = persona.fitTarget;
  return (
    worksForYou.total >= t.yourFitMin && worksForYou.total <= t.yourFitMax &&
    worksForThem.total >= t.theirFitMin && worksForThem.total <= t.theirFitMax
  );
}

function passesArchitectStructure(send: StudioAsset[], receive: StudioAsset[]): boolean {
  // Architect requires SOMETHING creative: 3+ pieces total, OR includes a far-future pick,
  // OR the structure is asymmetric (e.g. 1-for-3, 3-for-1, pick swap).
  const total = send.length + receive.length;
  if (total >= 4) return true;
  const allKeys = [...send, ...receive];
  const hasFarFuturePick = allKeys.some(a => {
    if (a.type !== "pick") return false;
    // Far-future = name contains a year >= current+2
    const yearMatch = a.name.match(/\b(20\d{2})\b/);
    if (!yearMatch) return false;
    const yr = parseInt(yearMatch[1], 10);
    const currentYear = new Date().getFullYear();
    return yr >= currentYear + 1;  // any non-current-year pick counts as "future"
  });
  if (hasFarFuturePick) return true;
  // Asymmetric: 1-for-2 or 2-for-1
  if ((send.length === 1 && receive.length >= 2) || (send.length >= 2 && receive.length === 1)) {
    return true;
  }
  return false;
}

// ─── Main entry point ───────────────────────────────────────────────────

export type GenerateOptions = {
  // Override persona on a single offer (used for "more like this" or per-card persona swap)
  personaOverride?: PersonaKey;
  // For "more like this" — anchor partner team
  anchorPartnerId?: string;
};

export function generateStudioOffers(
  ctx: StudioEngineContext,
  options?: GenerateOptions
): { offers: StudioOffer[]; totalCandidatesEvaluated: number } {
  if (ctx.shopList.length === 0) {
    return { offers: [], totalCandidatesEvaluated: 0 };
  }

  const persona = getPersona(options?.personaOverride ?? ctx.myPersona);
  const sendValue = ctx.shopList.reduce((s, a) => s + a.value, 0);
  if (sendValue <= 0) {
    return { offers: [], totalCandidatesEvaluated: 0 };
  }

  // Score each candidate for each partner, collect into a flat list
  type ScoredOffer = StudioOffer & { qualityScore: number };
  const allScored: ScoredOffer[] = [];
  let totalCandidates = 0;

  const partnerList = options?.anchorPartnerId
    ? ctx.partners.filter(p => p.teamId === options.anchorPartnerId)
    : ctx.partners;

  for (const partner of partnerList) {
    const candidates = generateCandidatesForPartner(ctx.shopList, partner.roster, persona);
    totalCandidates += candidates.length;

    for (const receiveBundle of candidates) {
      const worksForYou = computeWorksForYou(ctx.shopList, receiveBundle, ctx, partner.teamId);
      const worksForThem = computeWorksForThem(
        ctx.shopList,
        receiveBundle,
        partner.profile,
        partner.roster,
        partner.teamId,
        ctx.myTeamId
      );

      // Filter: must pass persona signature
      if (!passesPersonaSignature(worksForYou, worksForThem, persona)) continue;

      // Architect must include a creative structure
      if (persona.key === "architect" && !passesArchitectStructure(ctx.shopList, receiveBundle)) {
        continue;
      }

      const offer: StudioOffer = {
        id: `studio-${partner.teamId}-${receiveBundle.map(a => a.key).join("-")}-${Date.now()}-${Math.random().toString(36).slice(2, 7)}`,
        partnerTeamId: partner.teamId,
        partnerTeamName: partner.teamName,
        persona: persona.key,
        send: ctx.shopList.map(toOfferAsset),
        receive: receiveBundle.map(toOfferAsset),
        worksForYou,
        worksForThem,
        sendValue,
        receiveValue: receiveBundle.reduce((s, a) => s + a.value, 0),
      };

      // Quality score: average of the two fits, slight bonus when both are above 70
      const avgFit = (worksForYou.total + worksForThem.total) / 2;
      const balanceBonus = (worksForYou.total >= 70 && worksForThem.total >= 70) ? 5 : 0;
      const qualityScore = avgFit + balanceBonus;

      allScored.push({ ...offer, qualityScore });
    }
  }

  // Sort by quality, then dedupe partners (best offer per partner wins) for slate diversity
  allScored.sort((a, b) => b.qualityScore - a.qualityScore);
  const seenPartners = new Set<string>();
  const slate: StudioOffer[] = [];
  for (const offer of allScored) {
    if (slate.length >= SLATE_SIZE) break;
    if (seenPartners.has(offer.partnerTeamId)) continue;
    seenPartners.add(offer.partnerTeamId);
    // Strip the qualityScore field
    const { ...rest } = offer;
    delete (rest as Partial<ScoredOffer>).qualityScore;
    slate.push(rest as StudioOffer);
  }

  // If we don't have 5, fill from remaining (allowing partner repeats)
  if (slate.length < SLATE_SIZE) {
    for (const offer of allScored) {
      if (slate.length >= SLATE_SIZE) break;
      if (slate.some(s => s.id === offer.id)) continue;
      const { ...rest } = offer;
      delete (rest as Partial<ScoredOffer>).qualityScore;
      slate.push(rest as StudioOffer);
    }
  }

  return { offers: slate, totalCandidatesEvaluated: totalCandidates };
}
