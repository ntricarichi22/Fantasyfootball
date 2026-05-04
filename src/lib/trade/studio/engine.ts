// Trade Studio engine — partner search, offer generation, fit scoring.
//
// v2 changes:
//   - Persona ratios FLIPPED to correct direction (Closer < 1, Hustler > 1)
//   - Fair value scoring is now ASYMMETRIC (recipient-perspective)
//   - Filtering is by ratio band (primary) + fit target (secondary)
//   - More candidates per partner, wider tolerance, more variety
//   - "More like this" matches anchor SHAPE, not just persona

import { computePostTradeWarnings, type RosterAsset, type DealAsset } from "../advisor/engine";
import type { PersonaConfig, PersonaKey } from "./persona";
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
const RATIO_TOLERANCE = 0.04; // candidates can be ±4% off the persona's prefer ratio

// ─── Helpers ─────────────────────────────────────────────────────────────

function studioAssetToRosterAsset(a: StudioAsset): RosterAsset {
  return {
    key: a.key, name: a.name, position: a.position, posGroup: a.posGroup,
    value: a.value, tier: a.tier, type: a.type,
    isStud: a.isStud, isYouth: a.isYouth, meta: a.meta, rosterMeta: a.rosterMeta,
  };
}

function toOfferAsset(a: StudioAsset): OfferAssetSimple {
  const parts = a.meta.split(" · ");
  return {
    key: a.key, name: a.name, type: a.type,
    position: a.type === "player" ? parts[0] : undefined,
    team: a.type === "player" ? parts[1] : undefined,
    ageLabel: a.type === "player" ? parts[2] : undefined,
    value: a.value,
  };
}

// ─── Asymmetric fair value scoring ───────────────────────────────────────
// Returns a recipient-perspective score: how good is this trade FOR THIS SIDE?
//   ratio = received_value / sent_value (from this side's POV)
//   ratio = 1.0 → ~80 (fair is good but not perfect)
//   ratio = 1.2 → ~89 (you're getting more, even better)
//   ratio = 0.8 → ~67 (you're paying a premium, still acceptable)
//   ratio = 0.5 → ~36 (overpaying badly)

function scoreFairValueAsymmetric(receivedValue: number, sentValue: number): number {
  if (sentValue <= 0 && receivedValue <= 0) return 50;
  if (sentValue <= 0) return 100;
  if (receivedValue <= 0) return 0;
  const logR = Math.log(receivedValue / sentValue);
  // Sigmoid: 100 / (1 + exp(-3*(logR + 0.5)))
  const score = 100 / (1 + Math.exp(-3 * (logR + 0.5)));
  return Math.max(0, Math.min(100, score));
}

// ─── Component scorers ──────────────────────────────────────────────────

function scorePositionNeed(
  received: StudioAsset[],
  sent: StudioAsset[],
  profile: StudioStrategyProfile | null
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

function scoreRosterShape(
  myRoster: StudioAsset[],
  send: StudioAsset[],
  receive: StudioAsset[],
  myTeamId: string,
  partnerTeamId: string
): number {
  const dealAssets: DealAsset[] = [
    ...send.map(a => ({ key: a.key, name: a.name, fromTeamId: myTeamId, toTeamId: partnerTeamId })),
    ...receive.map(a => ({ key: a.key, name: a.name, fromTeamId: partnerTeamId, toTeamId: myTeamId })),
  ];
  const rosters: Record<string, RosterAsset[]> = {
    [myTeamId]: myRoster.map(studioAssetToRosterAsset),
    [partnerTeamId]: receive.map(studioAssetToRosterAsset),
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
  partnerId: string
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

// ─── Candidate generation (ratio-driven) ────────────────────────────────

function generateCandidatesForPartner(
  shopList: StudioAsset[],
  partnerRoster: StudioAsset[],
  persona: PersonaConfig
): StudioAsset[][] {
  const sendValue = shopList.reduce((s, a) => s + a.value, 0);
  if (sendValue <= 0) return [];

  // Exclude untouchables from partner pool — they wouldn't move them
  const pool = partnerRoster
    .filter(a => a.value > 0 && a.tier !== "untouchable")
    .sort((a, b) => b.value - a.value);
  if (pool.length === 0) return [];

  // Spread targets across the persona's ratio band
  const { min, max, prefer } = persona.ratioBand;
  const targetRatios = [
    min + (prefer - min) * 0.5,    // halfway from min to prefer
    prefer,
    prefer + (max - prefer) * 0.5,  // halfway from prefer to max
    min,
    max,
  ];

  const candidates: StudioAsset[][] = [];
  const seen = new Set<string>();
  const addIfNew = (combo: StudioAsset[]) => {
    if (combo.length === 0) return;
    const total = combo.reduce((s, a) => s + a.value, 0);
    const ratio = total / sendValue;
    if (ratio < min - RATIO_TOLERANCE || ratio > max + RATIO_TOLERANCE) return;
    const key = combo.map(c => c.key).sort().join("|");
    if (seen.has(key)) return;
    seen.add(key);
    candidates.push(combo);
  };

  for (const ratio of targetRatios) {
    const target = sendValue * ratio;
    const tol = target * 0.18;

    // Single-asset candidates
    for (const a of pool) {
      if (a.value >= target - tol && a.value <= target + tol) addIfNew([a]);
    }
    // 2-asset candidates
    const top = pool.slice(0, Math.min(25, pool.length));
    for (let i = 0; i < top.length && candidates.length < 80; i++) {
      for (let j = i + 1; j < top.length; j++) {
        const sum = top[i].value + top[j].value;
        if (sum >= target - tol && sum <= target + tol) addIfNew([top[i], top[j]]);
      }
    }
    // 3-asset candidates only for Architect (exotic structures)
    if (persona.allowExoticStructure) {
      for (let i = 0; i < Math.min(10, top.length) && candidates.length < 120; i++) {
        for (let j = i + 1; j < Math.min(12, top.length); j++) {
          for (let k = j + 1; k < Math.min(14, top.length); k++) {
            const sum = top[i].value + top[j].value + top[k].value;
            if (sum >= target - tol && sum <= target + tol) addIfNew([top[i], top[j], top[k]]);
          }
        }
      }
    }
  }
  return candidates;
}

// ─── Architect structure check ──────────────────────────────────────────

function passesArchitectStructure(send: StudioAsset[], receive: StudioAsset[]): boolean {
  const total = send.length + receive.length;
  if (total >= 4) return true;  // multi-piece package
  // Asymmetric: 1-for-2 or 2-for-1
  if ((send.length === 1 && receive.length >= 2) || (send.length >= 2 && receive.length === 1)) return true;
  // Far-future pick involved
  const allKeys = [...send, ...receive];
  const currentYear = new Date().getFullYear();
  const hasFuturePick = allKeys.some(a => {
    if (a.type !== "pick") return false;
    const yearMatch = a.name.match(/\b(20\d{2})\b/);
    if (!yearMatch) return false;
    return parseInt(yearMatch[1], 10) >= currentYear + 1;
  });
  return hasFuturePick;
}

// ─── Main entry ─────────────────────────────────────────────────────────

export type GenerateOptions = {
  personaOverride?: PersonaKey;
  anchorPartnerId?: string;
  // For "more like this" — match candidates with similar shape
  shapeSignature?: { sendCount: number; receiveCount: number; receiveValueMin: number; receiveValueMax: number };
};

export function generateStudioOffers(
  ctx: StudioEngineContext,
  options?: GenerateOptions
): { offers: StudioOffer[]; totalCandidatesEvaluated: number } {
  if (ctx.shopList.length === 0) return { offers: [], totalCandidatesEvaluated: 0 };

  const persona = getPersona(options?.personaOverride ?? ctx.myPersona);
  const sendValue = ctx.shopList.reduce((s, a) => s + a.value, 0);
  if (sendValue <= 0) return { offers: [], totalCandidatesEvaluated: 0 };

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
      // Architect: must be exotic structure
      if (persona.requireExoticStructure && !passesArchitectStructure(ctx.shopList, receiveBundle)) continue;

      // Shape signature filter (for "more like this")
      if (options?.shapeSignature) {
        const sig = options.shapeSignature;
        if (ctx.shopList.length !== sig.sendCount) continue;
        if (receiveBundle.length !== sig.receiveCount) continue;
        const recvVal = receiveBundle.reduce((s, a) => s + a.value, 0);
        if (recvVal < sig.receiveValueMin || recvVal > sig.receiveValueMax) continue;
      }

      const receiveValue = receiveBundle.reduce((s, a) => s + a.value, 0);

      const worksForYou = computeFit(
        receiveValue, sendValue,
        receiveBundle, ctx.shopList,
        ctx.myProfile, ctx.myRoster, ctx.myTeamId, partner.teamId
      );
      // Their perspective: their received = our sent, their sent = our received
      const worksForThem = computeFit(
        sendValue, receiveValue,
        ctx.shopList, receiveBundle,
        partner.profile, partner.roster, partner.teamId, ctx.myTeamId
      );

      // Soft fit signature filter
      const t = persona.fitTarget;
      if (worksForYou.total < t.yourFitMin || worksForYou.total > t.yourFitMax) continue;
      if (worksForThem.total < t.theirFitMin || worksForThem.total > t.theirFitMax) continue;

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
        receiveValue,
      };

      // Quality: prioritize offers near the persona's prefer ratio AND with both fits decent
      const ratio = receiveValue / sendValue;
      const ratioCloseness = 100 - Math.min(100, Math.abs(ratio - persona.ratioBand.prefer) * 200);
      const balanceBonus = (worksForYou.total >= 70 && worksForThem.total >= 60) ? 8 : 0;
      const qualityScore = (worksForYou.total + worksForThem.total) / 2 + ratioCloseness * 0.3 + balanceBonus;

      allScored.push({ ...offer, qualityScore });
    }
  }

  // Sort by quality, dedupe partners across the slate for variety
  allScored.sort((a, b) => b.qualityScore - a.qualityScore);
  const seenPartners = new Set<string>();
  const slate: StudioOffer[] = [];
  for (const offer of allScored) {
    if (slate.length >= SLATE_SIZE) break;
    if (seenPartners.has(offer.partnerTeamId)) continue;
    seenPartners.add(offer.partnerTeamId);
    const { qualityScore: _q, ...rest } = offer;
    void _q;
    slate.push(rest);
  }
  // Fill remainder allowing partner repeats if we don't have 5
  if (slate.length < SLATE_SIZE) {
    for (const offer of allScored) {
      if (slate.length >= SLATE_SIZE) break;
      if (slate.some(s => s.id === offer.id)) continue;
      const { qualityScore: _q, ...rest } = offer;
      void _q;
      slate.push(rest);
    }
  }
  return { offers: slate, totalCandidatesEvaluated: totalCandidates };
}
