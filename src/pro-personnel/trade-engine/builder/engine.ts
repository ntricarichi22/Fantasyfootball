// src/pro-personnel/trade-engine/builder/engine.ts
//
// Builder slate generator. Inverts the Studio pattern: instead of taking
// our shopList and finding receive-sets, this walks each partner's roster,
// identifies target players, then constructs send-sets from our roster
// using our persona's shape rules.
//
// Pipeline:
//   1. identifyTargetCandidates  — score every gettable player on every
//                                  partner roster as a potential acquisition
//   2. constructSendSide         — for each target, build a clean send
//                                  composition that hits our persona's
//                                  ratio band
//   3. applyDealbreakerFilters   — untouchables, stud protection, pick
//                                  capital alarms
//   4. checkBilateralAcceptance  — empirical partner band (if N>=5
//                                  accepted trades on file) else persona
//                                  band fallback
//   5. checkRejectionMemory      — drop shapes matching recent passes
//                                  (v1 STUB — see history/reader.ts)
//   6. scoreOffer                — composite fit score for ranking
//   7. buildSlate                — top N with diversity rules (variety in
//                                  partner, position)
//   8. generateProse             — director-voice placeholder prose
//                                  (UI overrides with advisor/route.ts
//                                  prose when the card becomes active)
//
// Pure module. No DB calls. The API route is responsible for loading
// rosters, profiles, personas, and partner histories, then passing them
// in via BuilderContext.

import {
  computeGap,
  personaAwareGrade,
} from "../core/gap";
import {
  isAging,
  isUntouchable,
  isAgingBenchGuy,
} from "../core/classification";
import type {
  RosterAsset,
  DealAsset,
  Gap,
  Grade,
  GradeBucket,
  PersonaKey,
  StrategyProfile,
  TeamMode,
} from "../core/types";
import {
  deriveEmpiricalBand,
  matchesRecentPass,
  type PartnerHistory,
  type PassHistory,
} from "../history/reader";

// ─── Types ─────────────────────────────────────────────────────────────

export type TeamInfo = {
  teamId: string;
  name: string;
  roster: RosterAsset[];
  profile: StrategyProfile | null;
  persona: PersonaKey | null;
  mode: TeamMode;
};

export type BuilderContext = {
  userTeamId: string;
  us: TeamInfo;
  others: TeamInfo[];
  passHistory: PassHistory;
  // Keyed by partner teamId
  partnerHistories: Record<string, PartnerHistory>;
};

export type TargetCandidate = {
  partnerTeamId: string;
  player: RosterAsset;
  fitScore: number;
  reasons: string[];
};

export type BuilderOffer = {
  id: string;
  partnerTeam: { id: string; name: string; persona: PersonaKey | null };
  // Full per-side asset arrays, hydrated from rosters
  sendAssets: RosterAsset[];
  receiveAssets: RosterAsset[];
  // Canonical deal shape consumed by the UI + downstream surfaces
  dealAssets: DealAsset[];
  gap: Gap;
  grade: Grade;
  verdict: string;
  prose: string;
  targetPlayerKey: string;
  totalScore: number;
};

export type BuilderSlate = {
  generatedAt: string;
  offers: BuilderOffer[];
  // Surfaces on the page may want to show "nothing landed" UI vs the
  // empty-strategy state — distinguished by `reason`.
  reason?: "ok" | "no_strategy" | "no_clean_offers";
};

// ─── Constants ─────────────────────────────────────────────────────────

const SLATE_MAX = 5;
const TARGETS_PER_PARTNER = 3;
const MAX_OFFERS_PER_PARTNER = 1;
const PICK_CAPITAL_FLOOR_VALUE = 80; // total pick value below which we alarm
const FAVORABLE_BUCKETS = new Set<GradeBucket>(["great", "ahead", "fair"]);

// Composite scoring weights
const W_TARGET_FIT = 1.0;
const W_PARTNER_MOTIVATION = 0.6;
const W_RATIO_CLEAN = 0.5;
const W_HISTORY_BONUS = 0.3;

// Persona-driven shape — what ratio we aim for on the send side
const PERSONA_TARGET_RATIO: Record<PersonaKey, number> = {
  straight_shooter: 1.0,
  closer: 0.95, // we send a hair more to grease the deal
  hustler: 1.08, // come in light
  architect: 1.0,
};

// Partner's persona band — what they'd accept from us, partner's POV ratio
const PARTNER_PERSONA_BAND: Record<PersonaKey, [number, number]> = {
  straight_shooter: [0.90, 1.10],
  closer: [0.85, 1.00],
  hustler: [1.00, 99],
  architect: [0.90, 1.10],
};

// ─── Helpers ───────────────────────────────────────────────────────────

function newId(prefix: string): string {
  return `${prefix}-${Math.random().toString(36).slice(2, 9)}`;
}

function positionOf(a: RosterAsset): string {
  return (a.position ?? "").toUpperCase();
}

function isPlayer(a: RosterAsset): boolean {
  return a.type === "player";
}

function isPick(a: RosterAsset): boolean {
  return a.type === "pick";
}

function pickValueTotal(roster: RosterAsset[]): number {
  return roster.filter(isPick).reduce((s, a) => s + a.value, 0);
}

function studsAtPosition(roster: RosterAsset[], pos: string): RosterAsset[] {
  return roster.filter(
    (a) => isPlayer(a) && a.isStud && positionOf(a) === pos,
  );
}

// Read a position market signal from a strategy profile. Returns
// 'buy' | 'hold' | 'sell' | 'unknown'.
function marketFor(
  profile: StrategyProfile | null,
  pos: string,
): "buy" | "hold" | "sell" | "unknown" {
  if (!profile) return "unknown";
  const key = `${pos.toLowerCase()}_market` as keyof StrategyProfile;
  const v = (profile as unknown as Record<string, unknown>)[key as string];
  if (v === "buy" || v === "hold" || v === "sell") return v;
  return "unknown";
}

// Fuzzy-match a wants_more array. The strategy form's exact strings
// aren't documented anywhere in the type system, so we match by substring
// across plausible terms. Worst case: a bonus doesn't fire — the engine
// still produces results, just slightly less tuned.
function wantsContains(wants: string[] | undefined, ...terms: string[]): boolean {
  if (!wants) return false;
  const haystack = wants.map((w) => w.toLowerCase());
  return terms.some((t) => haystack.some((h) => h.includes(t)));
}

// ─── Step 1: Target identification ────────────────────────────────────

function scoreTarget(
  target: RosterAsset,
  partner: TeamInfo,
  ctx: BuilderContext,
): { score: number; reasons: string[] } {
  const reasons: string[] = [];
  let score = 0;

  if (!isPlayer(target)) return { score: 0, reasons };
  if (isUntouchable(target)) return { score: -Infinity, reasons: ["untouchable"] };

  const pos = positionOf(target);
  const ourWants = ctx.us.profile?.wants_more;

  // Base value contribution (light weight on raw value)
  score += target.value * 0.02;

  // Match against our wants_more (fuzzy)
  if (target.isStud && wantsContains(ourWants, "stud", "elite", "produc")) {
    score += 4;
    reasons.push("matches our elite-producers want");
  }
  if (target.isYouth && wantsContains(ourWants, "youth", "young", "upside")) {
    score += 3;
    reasons.push("matches our young-upside want");
  }

  // Position need — our market signal
  const ourMarket = marketFor(ctx.us.profile, pos);
  if (ourMarket === "buy") {
    score += 3;
    reasons.push(`we're buying ${pos}`);
  }

  // Roster hole — no studs at this position on our side
  const ourStudsHere = studsAtPosition(ctx.us.roster, pos);
  if (ourStudsHere.length === 0 && (pos === "RB" || pos === "WR" || pos === "QB" || pos === "TE")) {
    score += 2;
    reasons.push(`roster hole at ${pos}`);
  }

  // Partner's market on this position
  const partnerMarket = marketFor(partner.profile, pos);
  if (partnerMarket === "sell") {
    score += 3;
    reasons.push(`partner is selling ${pos}`);
  } else if (partnerMarket === "buy") {
    score -= 4;
    reasons.push(`partner is buying ${pos} — won't move`);
  }

  // Partner team mode interaction
  if (partner.mode === "rebuild") {
    if (target.isStud || isAging(target)) {
      score += 3;
      reasons.push("rebuilder, shedding studs/aging");
    } else if (target.isYouth) {
      score -= 3;
      reasons.push("rebuilder hoards youth");
    }
  } else if (partner.mode === "contend") {
    if (target.isStud) {
      score -= 5;
      reasons.push("contender won't move core stud");
    } else if (isPick(target) || target.isYouth) {
      score += 1;
      reasons.push("contender will deal picks/young");
    }
  }

  // Attachment-tier soft signals (tier is a loose string per types.ts)
  if (target.tier === "moveable") {
    score += 2;
    reasons.push("partner has flagged moveable");
  } else if (target.tier === "listening") {
    score += 1;
    reasons.push("partner is listening");
  } else if (target.tier === "core") {
    score -= 2;
    reasons.push("partner has flagged core");
  }

  return { score, reasons };
}

function identifyTargetCandidates(ctx: BuilderContext): TargetCandidate[] {
  const all: TargetCandidate[] = [];
  for (const partner of ctx.others) {
    const scored = partner.roster
      .filter((a) => isPlayer(a) && !isUntouchable(a))
      .map((player) => {
        const { score, reasons } = scoreTarget(player, partner, ctx);
        return {
          partnerTeamId: partner.teamId,
          player,
          fitScore: score,
          reasons,
        };
      })
      .filter((c) => c.fitScore > 0)
      .sort((a, b) => b.fitScore - a.fitScore)
      .slice(0, TARGETS_PER_PARTNER);
    all.push(...scored);
  }
  return all;
}

// ─── Step 2: Send-side construction ───────────────────────────────────
//
// Given a target candidate and our persona, build a send composition
// that lands in our persona's accept ratio band relative to target
// value. Greedy by attractiveness-to-partner + dispensability-to-us.

function constructSendSide(
  target: TargetCandidate,
  ctx: BuilderContext,
): RosterAsset[] | null {
  const targetValue = target.player.value;
  if (targetValue <= 0) return null;

  const ourPersona: PersonaKey = ctx.us.persona ?? "straight_shooter";
  const desiredRatio = PERSONA_TARGET_RATIO[ourPersona];
  const targetSendValue = targetValue / desiredRatio;
  const tolerance = 0.10;
  const minSend = targetSendValue * (1 - tolerance);
  const maxSend = targetSendValue * (1 + tolerance);
  const overshootCap = maxSend * 1.5;

  const partner = ctx.others.find((t) => t.teamId === target.partnerTeamId);
  const partnerWants = partner?.profile?.wants_more;

  // Score each of our assets by "how attractive to partner +
  // how dispensable to us"
  const pool = ctx.us.roster
    .filter((a) => !isUntouchable(a))
    .map((a) => {
      let s = 0;

      // Prefer assets that match partner's wants (fuzzy)
      if (isPick(a) && wantsContains(partnerWants, "pick", "draft")) s += 3;
      if (a.isYouth && wantsContains(partnerWants, "youth", "young", "upside")) s += 3;
      if (a.isStud && wantsContains(partnerWants, "stud", "elite", "produc")) s += 3;

      // Prefer aging bench depth (low cost to us)
      if (isAgingBenchGuy(a)) s += 2;

      // Penalize sending from a position where we have only one stud
      if (isPlayer(a) && a.isStud) {
        const studsHere = studsAtPosition(ctx.us.roster, positionOf(a));
        if (studsHere.length <= 1) s -= 8; // strong protection
      }

      // Don't deplete a position we're already buying
      if (isPlayer(a)) {
        const mkt = marketFor(ctx.us.profile, positionOf(a));
        if (mkt === "buy") s -= 4;
        if (mkt === "sell") s += 2;
      }

      return { asset: a, score: s };
    })
    .sort((a, b) => b.score - a.score);

  // Greedy pack — pick highest-scored assets until we land in band.
  // Skip pieces that would overshoot the band ceiling.
  const send: RosterAsset[] = [];
  let total = 0;
  for (const { asset } of pool) {
    if (total >= minSend && total <= maxSend) break;
    if (total + asset.value > overshootCap) continue;
    send.push(asset);
    total += asset.value;
    if (send.length >= 4) break; // cap piece count
  }

  if (total < minSend || total > maxSend) return null;
  if (send.length === 0) return null;
  return send;
}

// ─── Step 3: Dealbreaker filters ──────────────────────────────────────

function violatesStudProtection(
  sendAssets: RosterAsset[],
  receiveAssets: RosterAsset[],
  ctx: BuilderContext,
): boolean {
  // For each stud we're shipping, ensure we get a comparable-or-better
  // stud back at a position that doesn't leave us thin.
  for (const a of sendAssets) {
    if (!a.isStud) continue;
    const pos = positionOf(a);
    const studsHere = studsAtPosition(ctx.us.roster, pos);
    if (studsHere.length <= 1) {
      const incomingStud = receiveAssets.find(
        (r) => r.isStud && r.value >= a.value * 0.9,
      );
      if (!incomingStud) return true;
    }
  }
  return false;
}

function violatesPickCapitalFloor(
  sendAssets: RosterAsset[],
  receiveAssets: RosterAsset[],
  ctx: BuilderContext,
): boolean {
  const currentPickCapital = pickValueTotal(ctx.us.roster);
  const sentPickValue = sendAssets
    .filter(isPick)
    .reduce((s, a) => s + a.value, 0);
  const receivedPickValue = receiveAssets
    .filter(isPick)
    .reduce((s, a) => s + a.value, 0);
  const postTrade = currentPickCapital - sentPickValue + receivedPickValue;
  return postTrade < PICK_CAPITAL_FLOOR_VALUE;
}

function applyDealbreakerFilters(
  sendAssets: RosterAsset[],
  receiveAssets: RosterAsset[],
  ctx: BuilderContext,
): { pass: boolean; reason?: string } {
  // Hard block on untouchables on either side
  for (const a of [...sendAssets, ...receiveAssets]) {
    if (isUntouchable(a)) return { pass: false, reason: "untouchable involved" };
  }
  if (violatesStudProtection(sendAssets, receiveAssets, ctx)) {
    return { pass: false, reason: "last stud at position, no comparable return" };
  }
  if (violatesPickCapitalFloor(sendAssets, receiveAssets, ctx)) {
    return { pass: false, reason: "pick capital below floor" };
  }
  return { pass: true };
}

// ─── Step 4: Bilateral acceptance check ───────────────────────────────
//
// Compute the deal from the PARTNER'S perspective. Check if their ratio
// falls in the empirical band (if we have enough history) or in their
// persona band (fallback).

function checkBilateralAcceptance(
  sendValue: number,
  receiveValue: number,
  partner: TeamInfo,
  history: PartnerHistory | undefined,
): boolean {
  // Partner's perspective: they receive `sendValue`, send `receiveValue`
  const partnerRatio = receiveValue > 0 ? sendValue / receiveValue : 0;

  const empirical = history
    ? deriveEmpiricalBand(history.acceptedPartnerRatios)
    : null;

  if (empirical) {
    return partnerRatio >= empirical.min && partnerRatio <= empirical.max;
  }
  const persona = partner.persona ?? "straight_shooter";
  const [min, max] = PARTNER_PERSONA_BAND[persona];
  return partnerRatio >= min && partnerRatio <= max;
}

// ─── Step 6: Offer scoring ────────────────────────────────────────────

function scoreOffer(
  target: TargetCandidate,
  gap: Gap,
  partner: TeamInfo,
  history: PartnerHistory | undefined,
): number {
  let score = 0;
  score += target.fitScore * W_TARGET_FIT;

  // Partner motivation — rebuilder ready to deal scores higher
  if (partner.mode === "rebuild") score += 3 * W_PARTNER_MOTIVATION;
  else if (partner.mode === "retool") score += 1 * W_PARTNER_MOTIVATION;

  // Ratio closeness to 1.0 (cleaner deal = better)
  const ratioDistance = Math.abs(gap.ratio - 1.0);
  score += (1 - Math.min(ratioDistance, 0.3)) * W_RATIO_CLEAN * 10;

  // History bonus — partner has accepted similar trades before
  if (history && history.acceptedCount >= 5) {
    score += W_HISTORY_BONUS * 5;
  }

  return score;
}

// ─── Step 7: Slate building ───────────────────────────────────────────

function buildSlate(offers: BuilderOffer[]): BuilderOffer[] {
  // Sort by total score desc
  const sorted = [...offers].sort((a, b) => b.totalScore - a.totalScore);

  const slate: BuilderOffer[] = [];
  const partnerCount = new Map<string, number>();
  const positionCount = new Map<string, number>();

  for (const offer of sorted) {
    if (slate.length >= SLATE_MAX) break;

    const partnerId = offer.partnerTeam.id;
    const pCount = partnerCount.get(partnerId) ?? 0;
    if (pCount >= MAX_OFFERS_PER_PARTNER) continue;

    // Position diversity — no more than 2 of the same target position
    const target = offer.receiveAssets.find((a) => a.key === offer.targetPlayerKey);
    const tPos = target ? positionOf(target) : "UNK";
    const posCount = positionCount.get(tPos) ?? 0;
    if (posCount >= 2) continue;

    slate.push(offer);
    partnerCount.set(partnerId, pCount + 1);
    positionCount.set(tPos, posCount + 1);
  }

  return slate;
}

// ─── Step 8: Placeholder prose ────────────────────────────────────────
//
// Director's voice, no numbers, no ratios. Persona-aware reads. This is
// the slate-generation-time placeholder — when a card becomes active the
// UI calls /api/pro-personnel/advisor which returns the real LLM-backed
// prose and overwrites this.

function generatePlaceholderProse(
  offer: BuilderOffer,
  ctx: BuilderContext,
): string {
  const partner = ctx.others.find((t) => t.teamId === offer.partnerTeam.id);
  const partnerPersona = offer.partnerTeam.persona;
  const target = offer.receiveAssets.find((a) => a.key === offer.targetPlayerKey);
  const targetName = target?.name ?? "the target";
  const partnerName = offer.partnerTeam.name;

  const lines: string[] = [];

  // Lead with value read (favorable buckets all read as a clean match)
  if (FAVORABLE_BUCKETS.has(offer.grade.bucket)) {
    lines.push("Clean value match.");
  } else if (offer.grade.bucket === "reaching") {
    lines.push("We're paying up a touch here.");
  } else {
    lines.push("Tough one to make work as-is.");
  }

  // Partner motivation read
  if (partner?.mode === "rebuild") {
    lines.push(`${partnerName} is in shed mode — ${targetName} fits the kind of piece they're moving.`);
  } else if (partner?.mode === "retool") {
    lines.push(`${partnerName} is balancing right now, willing to listen on most pieces.`);
  } else {
    lines.push(`${partnerName} is competing, so the ask has to be sharp.`);
  }

  // Persona-aware closing read
  if (partnerPersona === "hustler") {
    lines.push("They'll counter for a sweetener — hold firm on what you've offered.");
  } else if (partnerPersona === "closer") {
    lines.push("Closer profile — if they like it, they'll move quick.");
  } else if (partnerPersona === "architect") {
    lines.push("They prefer swaps over add-ons; this shape should land cleanly.");
  } else {
    lines.push("Straight shooter — what we send is what they read.");
  }

  return lines.join(" ");
}

// ─── Main entry ────────────────────────────────────────────────────────

export async function buildBuilderSlate(
  ctx: BuilderContext,
): Promise<BuilderSlate> {
  // Empty-state check — no strategy profile means nothing to anchor on
  if (!ctx.us.profile) {
    return {
      generatedAt: new Date().toISOString(),
      offers: [],
      reason: "no_strategy",
    };
  }

  const ourPersona = ctx.us.persona ?? "straight_shooter";

  // Step 1: identify targets across all partners
  const targets = identifyTargetCandidates(ctx);

  // Steps 2–6: for each target, build candidate offer
  const candidateOffers: BuilderOffer[] = [];

  for (const target of targets) {
    const partner = ctx.others.find((t) => t.teamId === target.partnerTeamId);
    if (!partner) continue;

    const sendAssets = constructSendSide(target, ctx);
    if (!sendAssets) continue;

    const receiveAssets = [target.player];

    const filter = applyDealbreakerFilters(sendAssets, receiveAssets, ctx);
    if (!filter.pass) continue;

    const dealAssets: DealAsset[] = [
      ...sendAssets.map((a) => ({
        key: a.key,
        name: a.name,
        fromTeamId: ctx.us.teamId,
        toTeamId: target.partnerTeamId,
      })),
      ...receiveAssets.map((a) => ({
        key: a.key,
        name: a.name,
        fromTeamId: target.partnerTeamId,
        toTeamId: ctx.us.teamId,
      })),
    ];

    const rosters: Record<string, RosterAsset[]> = {
      [ctx.us.teamId]: ctx.us.roster,
      [target.partnerTeamId]: partner.roster,
    };

    const gap = computeGap(dealAssets, rosters, ctx.us.teamId);
    const grade = personaAwareGrade(gap, ourPersona);

    // Bilateral acceptance (will the partner take it?)
    const history = ctx.partnerHistories[target.partnerTeamId];
    const partnerAccepts = checkBilateralAcceptance(
      gap.sendValue,
      gap.receiveValue,
      partner,
      history,
    );
    if (!partnerAccepts) continue;

    // Rejection memory — v1 STUB always returns false (see history/reader)
    if (
      matchesRecentPass(
        {
          partnerTeamId: target.partnerTeamId,
          targetPlayerKey: target.player.key,
          sendPlayerKeys: sendAssets.map((a) => a.key),
        },
        ctx.passHistory,
      )
    ) {
      continue;
    }

    const totalScore = scoreOffer(target, gap, partner, history);

    const offer: BuilderOffer = {
      id: newId("offer"),
      partnerTeam: {
        id: partner.teamId,
        name: partner.name,
        persona: partner.persona,
      },
      sendAssets,
      receiveAssets,
      dealAssets,
      gap,
      grade,
      verdict: grade.label,
      prose: "",
      targetPlayerKey: target.player.key,
      totalScore,
    };

    // Placeholder prose now — gets overwritten by the advisor route's
    // LLM-backed prose when the card becomes active in the UI
    offer.prose = generatePlaceholderProse(offer, ctx);

    candidateOffers.push(offer);
  }

  // Step 7: assemble slate with diversity rules
  const slate = buildSlate(candidateOffers);

  return {
    generatedAt: new Date().toISOString(),
    offers: slate,
    reason: slate.length > 0 ? "ok" : "no_clean_offers",
  };
}