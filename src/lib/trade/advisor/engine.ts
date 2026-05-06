// src/lib/trade/advisor/engine.ts
//
// Builder-specific advisor logic.
//
// v3.4 refactor: gap math, grade derivation, liquidity classification,
// post-trade warnings, and shape-mismatch detection have been extracted
// to core/. This file now imports those primitives and re-exports them
// for backwards compatibility with existing import paths
// (advisor/route.ts, studio/engine.ts, etc.). Suggestion engine logic
// stays here — it's Builder-specific. Stage 5 will modify
// generateSuggestions to support bidirectional combos and persona-
// awareness; this stage is a pure extraction with no behavioral change.

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
} from "../core/types";

import { computeGap, gradeFromVerdict, personaAwareGrade } from "../core/gap";
import { getLiquidityTier, isPremiumAsset } from "../core/liquidity";
import { computePostTradeWarnings } from "../core/warnings";
import { detectShapeMismatch } from "../core/shape";

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
};
export { computeGap, gradeFromVerdict, personaAwareGrade };
export { getLiquidityTier, isPremiumAsset };
export { computePostTradeWarnings };
export { detectShapeMismatch };

// ─── Suggestion engine (Builder-specific) ──────────────────────────────

export type Suggestion = {
  assets: { key: string; name: string; meta: string; value: number }[];
  direction: "send" | "receive";
  totalValue: number;
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
};

function findCombos(
  pool: ScoredAsset[],
  targetValue: number,
  tolerance = 0.10,
): Combo[] {
  const min = targetValue * (1 - tolerance);
  const max = targetValue * (1 + tolerance);
  const combos: Combo[] = [];
  const top = [...pool].sort((a, b) => b.value - a.value).slice(0, 25);
  for (let i = 0; i < top.length; i++) {
    for (let j = i + 1; j < top.length; j++) {
      const total = top[i].value + top[j].value;
      if (total < min || total > max) continue;
      const pickCount =
        (top[i].type === "pick" ? 1 : 0) + (top[j].type === "pick" ? 1 : 0);
      combos.push({
        a: top[i],
        b: top[j],
        total,
        pickCount,
        fitSum: top[i].fitScore + top[j].fitScore,
      });
    }
  }
  combos.sort((x, y) => {
    const distX = Math.abs(x.total - targetValue);
    const distY = Math.abs(y.total - targetValue);
    if (Math.abs(distX - distY) > targetValue * 0.02) return distX - distY;
    if (x.pickCount !== y.pickCount) return y.pickCount - x.pickCount;
    return y.fitSum - x.fitSum;
  });
  return combos;
}

function combineTradeoffs(parts: (string | null)[]): string | null {
  const real = parts.filter((p): p is string => p !== null);
  if (real.length === 0) return null;
  if (real.length === 1) return real[0];
  return real.join("; also ");
}

export type SuggestionContext = {
  dealAssets: DealAsset[];
  rosters: Record<string, RosterAsset[]>;
  myTeamId: string;
  otherTeamId: string;
  myProfile: StrategyProfile | null;
  otherProfile: StrategyProfile | null;
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
    gap,
  } = ctx;
  const dealKeys = new Set(dealAssets.map((a) => a.key));

  let direction: "send" | "receive" = "send";
  let targetValue = 0;
  let pool: ScoredAsset[] = [];

  if (gap.verdict === "EMPTY") return [];

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

  if (gap.verdict === "RECV_ONLY") {
    direction = "send";
    targetValue = gap.receiveValue;
    pool = buildSendPool();
  } else if (gap.verdict === "SEND_ONLY") {
    direction = "receive";
    targetValue = gap.sendValue;
    pool = buildReceivePool();
  } else if (gap.delta > 0 || gap.verdict === "FAIR") {
    direction = "send";
    targetValue = gap.delta > 0 ? gap.delta : gap.sendValue * 0.05;
    pool = buildSendPool();
  } else {
    direction = "receive";
    targetValue = Math.abs(gap.delta);
    pool = buildReceivePool();
  }

  if (pool.length === 0 || targetValue <= 0) return [];

  // Premium-floor: when partner ships out a stud and isn't getting one
  // back, suggestions need at least one premium (S/A liquidity) asset
  // to be plausible.
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

  const passesPremium = (combo: ScoredAsset[]): boolean => {
    if (!requirePremium) return true;
    return combo.some((a) => isPremiumAsset(a));
  };

  const suggestions: Suggestion[] = [];

  // Pass 1: single-asset closers within ±15% of target
  for (const s of findSingleClosers(pool, targetValue, 0.15).slice(0, 3)) {
    if (!passesPremium([s])) continue;
    suggestions.push({
      assets: [{ key: s.key, name: s.name, meta: s.rosterMeta, value: s.value }],
      direction,
      totalValue: s.value,
      closesGap: true,
      liquidityTiers: [s.tier_liq],
      tradeoff: s.tradeoff,
    });
  }

  // Pass 2: 2-asset combos within ±10%
  if (suggestions.length < 3) {
    for (const c of findCombos(pool, targetValue, 0.10)) {
      if (!passesPremium([c.a, c.b])) continue;
      const usedKeys = new Set(suggestions.flatMap((s) => s.assets.map((a) => a.key)));
      if (usedKeys.has(c.a.key) && usedKeys.has(c.b.key)) continue;
      suggestions.push({
        assets: [
          { key: c.a.key, name: c.a.name, meta: c.a.rosterMeta, value: c.a.value },
          { key: c.b.key, name: c.b.name, meta: c.b.rosterMeta, value: c.b.value },
        ],
        direction,
        totalValue: c.total,
        closesGap: true,
        liquidityTiers: [c.a.tier_liq, c.b.tier_liq],
        tradeoff: combineTradeoffs([c.a.tradeoff, c.b.tradeoff]),
      });
      if (suggestions.length >= 3) break;
    }
  }

  // Pass 3: best-fit fallback if nothing closes the gap
  if (suggestions.length === 0) {
    const sorted = [...pool].sort(
      (a, b) => b.fitScore - a.fitScore || b.value - a.value,
    );
    for (const s of sorted.slice(0, 3)) {
      if (!passesPremium([s])) continue;
      suggestions.push({
        assets: [{ key: s.key, name: s.name, meta: s.rosterMeta, value: s.value }],
        direction,
        totalValue: s.value,
        closesGap: false,
        liquidityTiers: [s.tier_liq],
        tradeoff: s.tradeoff,
      });
    }
  }

  return suggestions.slice(0, 3);
}
