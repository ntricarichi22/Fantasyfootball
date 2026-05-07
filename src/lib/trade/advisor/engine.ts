// src/lib/trade/advisor/engine.ts
//
// Builder-specific advisor logic.
//
// v3.6 (FAIR sweetener fix):
//   - Within 5% of fair (|ratio - 1| ≤ 0.05) → no suggestions. The chip
//     prose handles "send as is" — engine adds nothing.
//   - 5–10% off fair → only late picks (round 3, or current-year 2.09+),
//     scaled to gap size. Prefer current-year picks, fall back to future.
//   - Direction routing now handles FAIR + negative delta correctly:
//     user giving more than receiving → suggest receive-side pick from
//     partner instead of (incorrectly) routing to send.
//
// v3.5 (Stage 5): persona-aware suggestions.
//   - Suggestion's `direction` moved from top-level to per-asset; new
//     top-level `kind` field summarises ("send" / "receive" / "swap").
//   - SuggestionContext gains `partnerPersona`. When the partner is
//     ARCHITECT, the combo finder emits bidirectional swap pairs and
//     weights future picks higher. Other personas keep prior behaviour.
//
// v3.4: gap math, grade derivation, liquidity, post-trade warnings, and
// shape-mismatch detection are in core/. This file imports those and
// re-exports them for backwards compatibility.

import type {
  RosterAsset,
  DealAsset,
  StrategyProfile,
  Gap,
  GapVerdict,
  Grade,
  GradeBucket,
  LiquidityTier,
  PostTradeWarning,
  PersonaKey,
} from "../core/types";

import { computeGap, gradeFromVerdict, personaAwareGrade } from "../core/gap";
import { getLiquidityTier, isPremiumAsset } from "../core/liquidity";
import { computePostTradeWarnings } from "../core/warnings";
import { detectShapeMismatch } from "../core/shape";
import { getCFCYear } from "../core/classification";

// ─── Re-exports (backwards compat) ─────────────────────────────────────

export type {
  RosterAsset,
  DealAsset,
  StrategyProfile,
  Gap,
  GapVerdict,
  Grade,
  GradeBucket,
  LiquidityTier,
  PostTradeWarning,
  PersonaKey,
};
export { computeGap, gradeFromVerdict, personaAwareGrade };
export { getLiquidityTier, isPremiumAsset };
export { computePostTradeWarnings };
export { detectShapeMismatch };

// ─── Suggestion engine ─────────────────────────────────────────────────

export type SuggestionAsset = {
  key: string;
  name: string;
  meta: string;
  value: number;
  direction: "send" | "receive";
};

export type SuggestionKind = "send" | "receive" | "swap";

export type Suggestion = {
  assets: SuggestionAsset[];
  kind: SuggestionKind;
  totalValue: number;        // magnitude — sum of asset values
  closesGap: boolean;
  liquidityTiers: LiquidityTier[];
  tradeoff: string | null;
};

type ScoredAsset = RosterAsset & {
  fitScore: number;
  tier_liq: LiquidityTier;
  tradeoff: string | null;
};

function listFromMarkets(
  p: StrategyProfile | null,
  target: "buy" | "sell",
): string[] {
  if (!p) return [];
  const out: string[] = [];
  if (p.qb_market === target) out.push("QB");
  if (p.rb_market === target) out.push("RB");
  if (p.wr_market === target) out.push("WR");
  if (p.te_market === target) out.push("TE");
  if (p.picks_market === target) out.push("PICK");
  return out;
}

function getMyMarket(p: StrategyProfile | null, position: string): string {
  if (!p) return "hold";
  if (position === "QB") return p.qb_market;
  if (position === "RB") return p.rb_market;
  if (position === "WR" || position === "TE") return p.wr_market;
  if (position === "PICK") return p.picks_market;
  return "hold";
}

function computeSendTradeoff(
  asset: RosterAsset,
  myProfile: StrategyProfile | null,
): string | null {
  if (!myProfile) return null;
  const myWants = new Set(myProfile.wants_more ?? []);
  if (asset.type === "pick" && myWants.has("draft_picks")) {
    return "costs you a pick when you're trying to accumulate them";
  }
  const market = getMyMarket(myProfile, asset.position);
  if (asset.type === "player" && market === "buy") {
    return `sends a ${asset.position} while you're shopping for ${asset.position}s`;
  }
  return null;
}

function scoreAssetForSend(
  asset: RosterAsset,
  myProfile: StrategyProfile | null,
  otherProfile: StrategyProfile | null,
): number {
  let s = 0;
  const mySelling = listFromMarkets(myProfile, "sell");
  if (mySelling.includes(asset.position)) s += 50;
  const otherBuying = listFromMarkets(otherProfile, "buy");
  if (otherBuying.includes(asset.position)) s += 30;
  const otherWants = new Set(otherProfile?.wants_more ?? []);
  if (otherWants.has("elite_producers") && asset.isStud) s += 25;
  if (otherWants.has("young_upside") && asset.isYouth) s += 15;
  if (otherWants.has("draft_picks") && asset.type === "pick") s += 60;
  if (
    otherWants.has("roster_depth") &&
    asset.value >= 30 &&
    asset.value <= 120
  ) {
    s += 8;
  }
  const myWants = new Set(myProfile?.wants_more ?? []);
  if (myWants.has("draft_picks") && asset.type === "pick") s -= 25;
  const market = getMyMarket(myProfile, asset.position);
  if (asset.type === "player" && market === "buy") s -= 25;
  return s;
}

function filterMyAsset(asset: RosterAsset, dealKeys: Set<string>): boolean {
  if (dealKeys.has(asset.key)) return false;
  if (asset.tier === "untouchable") return false;
  if (asset.value <= 0) return false;
  return true;
}

function dealHasStudInDirection(
  dealAssets: DealAsset[],
  rosters: Record<string, RosterAsset[]>,
  fromTeamId: string,
): boolean {
  for (const a of dealAssets) {
    if (a.fromTeamId !== fromTeamId) continue;
    const asset = (rosters[a.fromTeamId] ?? []).find((x) => x.key === a.key);
    if (asset?.isStud) return true;
  }
  return false;
}

function sideHasPremium(
  dealAssets: DealAsset[],
  rosters: Record<string, RosterAsset[]>,
  toTeamId: string,
): boolean {
  for (const a of dealAssets) {
    if (a.toTeamId !== toTeamId) continue;
    const asset = (rosters[a.fromTeamId] ?? []).find((x) => x.key === a.key);
    if (asset && isPremiumAsset(asset)) return true;
  }
  return false;
}

function isFuturePick(a: RosterAsset, currentYear: number): boolean {
  return a.type === "pick" && (a.pickYear ?? 0) > currentYear;
}

// "Late pick" predicate for the FAIR-deal sweetener path.
// Late = round 3 (any year) OR round 2 with slot ≥ 9 (current year only —
// future picks don't carry slot info). Parses the key directly because
// parsePickKey in core/ doesn't handle the 4-part current-year format.
function isLatePick(a: RosterAsset): boolean {
  if (a.type !== "pick") return false;
  if (!a.key.startsWith("pick:")) return false;
  const parts = a.key.slice(5).split("-");
  if (parts.length < 2) return false;
  const round = parseInt(parts[1], 10);
  if (round === 3) return true;
  // Current-year picks are formatted pick:YYYY-R-SS-RID (4 parts).
  if (round === 2 && parts.length === 4) {
    const slot = parseInt(parts[2], 10);
    if (!Number.isNaN(slot) && slot >= 9) return true;
  }
  return false;
}

function isCurrentYearPick(a: RosterAsset): boolean {
  if (a.type !== "pick") return false;
  if (!a.key.startsWith("pick:")) return false;
  return a.key.slice(5).split("-").length === 4;
}

function findSingleClosers(
  pool: ScoredAsset[],
  targetValue: number,
  tolerance = 0.15,
): ScoredAsset[] {
  const min = targetValue * (1 - tolerance);
  const max = targetValue * (1 + tolerance);
  return pool
    .filter((p) => p.value >= min && p.value <= max)
    .sort((a, b) => {
      const distA = Math.abs(a.value - targetValue);
      const distB = Math.abs(b.value - targetValue);
      if (Math.abs(distA - distB) > targetValue * 0.02) return distA - distB;
      if (b.fitScore !== a.fitScore) return b.fitScore - a.fitScore;
      if (a.type !== b.type) return a.type === "pick" ? -1 : 1;
      return 0;
    });
}

type Combo = {
  a: ScoredAsset;
  b: ScoredAsset;
  total: number;
  pickCount: number;
  fitSum: number;
  hasFuturePick: boolean;
};

function findCombos(
  pool: ScoredAsset[],
  targetValue: number,
  tolerance = 0.10,
  preferFuturePicks = false,
): Combo[] {
  const min = targetValue * (1 - tolerance);
  const max = targetValue * (1 + tolerance);
  const combos: Combo[] = [];
  const cy = getCFCYear();
  const top = [...pool].sort((a, b) => b.value - a.value).slice(0, 25);
  for (let i = 0; i < top.length; i++) {
    for (let j = i + 1; j < top.length; j++) {
      const total = top[i].value + top[j].value;
      if (total < min || total > max) continue;
      const pickCount =
        (top[i].type === "pick" ? 1 : 0) + (top[j].type === "pick" ? 1 : 0);
      const hasFuture = isFuturePick(top[i], cy) || isFuturePick(top[j], cy);
      combos.push({
        a: top[i],
        b: top[j],
        total,
        pickCount,
        fitSum: top[i].fitScore + top[j].fitScore,
        hasFuturePick: hasFuture,
      });
    }
  }
  combos.sort((x, y) => {
    const distX = Math.abs(x.total - targetValue);
    const distY = Math.abs(y.total - targetValue);
    if (Math.abs(distX - distY) > targetValue * 0.02) return distX - distY;
    if (preferFuturePicks && x.hasFuturePick !== y.hasFuturePick) {
      return Number(y.hasFuturePick) - Number(x.hasFuturePick);
    }
    if (x.pickCount !== y.pickCount) return y.pickCount - x.pickCount;
    return y.fitSum - x.fitSum;
  });
  return combos;
}

// ─── Swap combos (Architect-only) ──────────────────────────────────────
//
// A swap combo adds one asset to send and one to receive. Closes a signed
// gap.delta when (sendAsset.value - receiveAsset.value) ≈ gap.delta.
//
// Example: gap.delta = +20 (you ahead). A swap of (send 50, receive 30)
// has valueDiff = +20 → new delta = old + (30 - 50) = 0.

type SwapCombo = {
  send: ScoredAsset;
  receive: ScoredAsset;
  valueDiff: number;       // signed: send.value - receive.value
  pickCount: number;
  hasFuturePick: boolean;
};

function findSwapCombos(
  myPool: ScoredAsset[],
  theirPool: ScoredAsset[],
  delta: number,           // signed gap.delta (target valueDiff)
  tolerance = 0.10,
): SwapCombo[] {
  if (delta === 0) return [];
  const targetMag = Math.abs(delta);
  const minMag = targetMag * (1 - tolerance);
  const maxMag = targetMag * (1 + tolerance);
  const cy = getCFCYear();
  const combos: SwapCombo[] = [];

  // Cap pools to top 20 each — 400 pairs max
  const myTop = [...myPool].sort((a, b) => b.value - a.value).slice(0, 20);
  const theirTop = [...theirPool].sort((a, b) => b.value - a.value).slice(0, 20);

  for (const a of myTop) {
    for (const b of theirTop) {
      const diff = a.value - b.value;
      if (Math.sign(diff) !== Math.sign(delta)) continue;
      const mag = Math.abs(diff);
      if (mag < minMag || mag > maxMag) continue;
      const pickCount =
        (a.type === "pick" ? 1 : 0) + (b.type === "pick" ? 1 : 0);
      const hasFuture = isFuturePick(a, cy) || isFuturePick(b, cy);
      combos.push({ send: a, receive: b, valueDiff: diff, pickCount, hasFuturePick: hasFuture });
    }
  }

  combos.sort((x, y) => {
    if (x.hasFuturePick !== y.hasFuturePick) {
      return Number(y.hasFuturePick) - Number(x.hasFuturePick);
    }
    if (x.pickCount !== y.pickCount) return y.pickCount - x.pickCount;
    const distX = Math.abs(Math.abs(x.valueDiff) - targetMag);
    const distY = Math.abs(Math.abs(y.valueDiff) - targetMag);
    return distX - distY;
  });
  return combos;
}

function combineTradeoffs(parts: (string | null)[]): string | null {
  const real = parts.filter((p): p is string => p !== null);
  if (real.length === 0) return null;
  if (real.length === 1) return real[0];
  return real.join("; also ");
}

// ─── Public entry ──────────────────────────────────────────────────────

export type SuggestionContext = {
  dealAssets: DealAsset[];
  rosters: Record<string, RosterAsset[]>;
  myTeamId: string;
  otherTeamId: string;
  myProfile: StrategyProfile | null;
  otherProfile: StrategyProfile | null;
  partnerPersona?: PersonaKey | null;
  gap: Gap;
};

export function generateSuggestions(ctx: SuggestionContext): Suggestion[] {
  const {
    dealAssets,
    rosters,
    myTeamId,
    otherTeamId,
    myProfile,
    otherProfile,
    partnerPersona,
    gap,
  } = ctx;
  const dealKeys = new Set(dealAssets.map((a) => a.key));

  if (gap.verdict === "EMPTY") return [];

  // ── FAIR-deal short circuit ───────────────────────────────────────────
  // Within 5% of fair → deal sends as-is, no sweetener needed.
  const isFair = gap.verdict === "FAIR";
  const fairOffBy = isFair ? Math.abs(gap.ratio - 1) : 0;
  if (isFair && fairOffBy <= 0.05) return [];

  const isArchitect = partnerPersona === "architect";

  const buildSendPool = (): ScoredAsset[] =>
    (rosters[myTeamId] ?? [])
      .filter((p) => filterMyAsset(p, dealKeys))
      .map((p) => ({
        ...p,
        fitScore: scoreAssetForSend(p, myProfile, otherProfile),
        tier_liq: getLiquidityTier(p),
        tradeoff: computeSendTradeoff(p, myProfile),
      }));

  const buildReceivePool = (): ScoredAsset[] =>
    (rosters[otherTeamId] ?? [])
      .filter((p) => !dealKeys.has(p.key) && p.value > 0 && p.tier !== "untouchable")
      .map((p) => ({
        ...p,
        fitScore: 0,
        tier_liq: getLiquidityTier(p),
        tradeoff: null,
      }));

  // Always build both — needed for both same-direction and swap candidates
  const sendPool = buildSendPool();
  const receivePool = buildReceivePool();

  // ── Direction + target selection ──────────────────────────────────────
  // Refactored: handles delta < 0 in FAIR explicitly (was previously routed
  // to send incorrectly, asking the user to add when they were already
  // giving up more value).
  let direction: "send" | "receive" = "send";
  let targetValue = 0;
  let pool: ScoredAsset[] = [];

  if (gap.verdict === "RECV_ONLY") {
    direction = "send";
    targetValue = gap.receiveValue;
    pool = sendPool;
  } else if (gap.verdict === "SEND_ONLY") {
    direction = "receive";
    targetValue = gap.sendValue;
    pool = receivePool;
  } else if (gap.delta > 0) {
    direction = "send";
    targetValue = gap.delta;
    pool = sendPool;
  } else if (gap.delta < 0) {
    direction = "receive";
    targetValue = Math.abs(gap.delta);
    pool = receivePool;
  } else {
    // delta exactly 0 with both sides populated — no need to suggest
    return [];
  }

  if (pool.length === 0 || targetValue <= 0) return [];

  // ── FAIR + 5–10% off → late-pick-only sweetener ───────────────────────
  // Restrict to 3rds (any year) or current-year 2.09+. Pick the one whose
  // value is closest to the gap. Prefer current-year over future-year.
  // Skips Pass 1–4 entirely so we never dump a high-value asset on an
  // already-fair deal.
  if (isFair) {
    const latePicks = pool.filter(isLatePick);
    if (latePicks.length === 0) return [];
    const currentYear = latePicks.filter(isCurrentYearPick);
    const futureYear = latePicks.filter((p) => !isCurrentYearPick(p));
    const candidates = currentYear.length > 0 ? currentYear : futureYear;
    candidates.sort(
      (a, b) => Math.abs(a.value - targetValue) - Math.abs(b.value - targetValue),
    );
    const top = candidates[0];
    return [
      {
        assets: [
          { key: top.key, name: top.name, meta: top.rosterMeta, value: top.value, direction },
        ],
        kind: direction,
        totalValue: top.value,
        closesGap: true,
        liquidityTiers: [top.tier_liq],
        tradeoff: top.tradeoff,
      },
    ];
  }

  // ── Premium-floor rule (non-FAIR only) ────────────────────────────────
  // When partner ships a stud out and isn't getting one back, suggestions
  // need at least one premium (S/A liquidity) asset.
  let requirePremium = false;
  if (direction === "send") {
    const otherStudGoingOut = dealHasStudInDirection(dealAssets, rosters, otherTeamId);
    const otherReceivesPremium = sideHasPremium(dealAssets, rosters, otherTeamId);
    if (otherStudGoingOut && !otherReceivesPremium) requirePremium = true;
  } else {
    const otherStudGoingOut = dealHasStudInDirection(dealAssets, rosters, otherTeamId);
    const meReceivesPremium = sideHasPremium(dealAssets, rosters, myTeamId);
    if (otherStudGoingOut && !meReceivesPremium) requirePremium = true;
  }
  const passesPremium = (combo: ScoredAsset[]): boolean =>
    !requirePremium || combo.some((a) => isPremiumAsset(a));

  const suggestions: Suggestion[] = [];
  const usedKeys = (): Set<string> =>
    new Set(suggestions.flatMap((s) => s.assets.map((a) => a.key)));

  // Pass 1: single-asset closers within ±15% of target. Architect partners
  // cap singles at 1 so passes 2-3 (swap / pick-heavy combos) always have
  // room in the slate — keeps suggestions feeling Architect-shaped.
  const singleCap = isArchitect ? 1 : 3;
  for (const s of findSingleClosers(pool, targetValue, 0.15).slice(0, singleCap)) {
    if (suggestions.length >= 3) break;
    if (!passesPremium([s])) continue;
    suggestions.push({
      assets: [{ key: s.key, name: s.name, meta: s.rosterMeta, value: s.value, direction }],
      kind: direction,
      totalValue: s.value,
      closesGap: true,
      liquidityTiers: [s.tier_liq],
      tradeoff: s.tradeoff,
    });
  }

  // Pass 2 (Architect bias): swap combos before same-direction combos.
  // Only when both sides have assets AND gap is materially off.
  const allowSwap =
    isArchitect &&
    gap.hasSend &&
    gap.hasReceive &&
    gap.verdict !== "FAIR" &&
    gap.delta !== 0;

  if (allowSwap && suggestions.length < 3) {
    for (const sw of findSwapCombos(sendPool, receivePool, gap.delta, 0.10)) {
      if (suggestions.length >= 3) break;
      if (!passesPremium([sw.send, sw.receive])) continue;
      const used = usedKeys();
      if (used.has(sw.send.key) && used.has(sw.receive.key)) continue;
      suggestions.push({
        assets: [
          { key: sw.send.key, name: sw.send.name, meta: sw.send.rosterMeta, value: sw.send.value, direction: "send" },
          { key: sw.receive.key, name: sw.receive.name, meta: sw.receive.rosterMeta, value: sw.receive.value, direction: "receive" },
        ],
        kind: "swap",
        totalValue: sw.send.value + sw.receive.value,
        closesGap: true,
        liquidityTiers: [sw.send.tier_liq, sw.receive.tier_liq],
        tradeoff: combineTradeoffs([sw.send.tradeoff, null]),
      });
    }
  }

  // Pass 3: 2-asset same-direction combos within ±10%
  if (suggestions.length < 3) {
    for (const c of findCombos(pool, targetValue, 0.10, isArchitect)) {
      if (suggestions.length >= 3) break;
      if (!passesPremium([c.a, c.b])) continue;
      const used = usedKeys();
      if (used.has(c.a.key) && used.has(c.b.key)) continue;
      suggestions.push({
        assets: [
          { key: c.a.key, name: c.a.name, meta: c.a.rosterMeta, value: c.a.value, direction },
          { key: c.b.key, name: c.b.name, meta: c.b.rosterMeta, value: c.b.value, direction },
        ],
        kind: direction,
        totalValue: c.total,
        closesGap: true,
        liquidityTiers: [c.a.tier_liq, c.b.tier_liq],
        tradeoff: combineTradeoffs([c.a.tradeoff, c.b.tradeoff]),
      });
    }
  }

  // Pass 4: best-fit fallback when nothing closes the gap
  if (suggestions.length === 0) {
    const sorted = [...pool].sort(
      (a, b) => b.fitScore - a.fitScore || b.value - a.value,
    );
    for (const s of sorted.slice(0, 3)) {
      if (!passesPremium([s])) continue;
      suggestions.push({
        assets: [{ key: s.key, name: s.name, meta: s.rosterMeta, value: s.value, direction }],
        kind: direction,
        totalValue: s.value,
        closesGap: false,
        liquidityTiers: [s.tier_liq],
        tradeoff: s.tradeoff,
      });
    }
  }

  return suggestions.slice(0, 3);
}
