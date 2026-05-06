// Trade Studio classification helpers.
//
// Resolves the defined terms in CFC Trade Engine Commandments — STUD,
// YOUNG PLAYER, AGING BENCH GUY, STARTER-LEVEL PLAYER, COMPLIMENTARY
// PARTNER, FUTURE PICK — from raw schema attributes.
//
// All inputs come from the API route after hydrating from Supabase.
// All outputs are pure functions (no DB access here).

import type { StudioAsset, StudioStrategyProfile, TeamMode } from "./types";

// ─── Pick parsing ────────────────────────────────────────────────────────

/**
 * Parse a pick key like "pick:2026-1-3" into year/round/slot.
 * Returns null if the key isn't a recognizable pick format.
 */
export function parsePickKey(key: string): { year: number; round: number; slot: number } | null {
  if (!key.startsWith("pick:")) return null;
  const body = key.slice(5);
  const parts = body.split("-");
  if (parts.length !== 3) return null;
  const year = parseInt(parts[0], 10);
  const round = parseInt(parts[1], 10);
  const slot = parseInt(parts[2], 10);
  if (Number.isNaN(year) || Number.isNaN(round) || Number.isNaN(slot)) return null;
  return { year, round, slot };
}

/** Current CFC year. Mirrors getCFCYear() in trades/targets/route.ts. */
export function getCFCYear(): number {
  const n = new Date();
  return n.getMonth() >= 2 ? n.getFullYear() : n.getFullYear() - 1;
}

// ─── Player class (STARTER-LEVEL PLAYER) ─────────────────────────────────

const STARTER_LEVEL_TOPN: Record<string, number> = {
  QB: 30,
  RB: 30,
  WR: 40,
  TE: 10,
};

/**
 * Compute the set of asset keys that qualify as STARTER-LEVEL PLAYER per
 * the commandments: top 30 QBs/RBs by value, top 40 WRs, top 10 TEs,
 * excluding STUDs. Ranking is league-wide across all rostered players.
 */
export function computeStarterLevelKeys(rosters: Map<string, StudioAsset[]>): Set<string> {
  const byPosition = new Map<string, StudioAsset[]>();
  for (const assets of rosters.values()) {
    for (const a of assets) {
      if (a.type !== "player") continue;
      if (a.isStud) continue;
      const pos = (a.position ?? "").toUpperCase();
      if (!STARTER_LEVEL_TOPN[pos]) continue;
      if (!byPosition.has(pos)) byPosition.set(pos, []);
      byPosition.get(pos)!.push(a);
    }
  }
  const starterKeys = new Set<string>();
  for (const [pos, assets] of byPosition) {
    const n = STARTER_LEVEL_TOPN[pos];
    assets.sort((a, b) => b.value - a.value);
    for (let i = 0; i < Math.min(n, assets.length); i++) {
      starterKeys.add(assets[i].key);
    }
  }
  return starterKeys;
}

/**
 * Enrich every asset on every roster with computed fields:
 *   - isStarterLevel (players)
 *   - pickYear / pickRound / pickSlot (picks)
 * Does not mutate inputs.
 */
export function enrichRosters(rosters: Map<string, StudioAsset[]>): Map<string, StudioAsset[]> {
  const starterKeys = computeStarterLevelKeys(rosters);
  const out = new Map<string, StudioAsset[]>();
  for (const [tid, assets] of rosters) {
    out.set(tid, assets.map(a => {
      const next: StudioAsset = { ...a };
      if (a.type === "player") {
        next.isStarterLevel = starterKeys.has(a.key);
      } else if (a.type === "pick") {
        const parsed = parsePickKey(a.key);
        if (parsed) {
          next.pickYear = parsed.year;
          next.pickRound = parsed.round;
          next.pickSlot = parsed.slot;
        }
      }
      return next;
    }));
  }
  return out;
}

// ─── WANTS_MORE matching ─────────────────────────────────────────────────

/**
 * Count how many WANTS_MORE buckets the received-side bundle satisfies.
 * Higher = more aligned with what the recipient explicitly wants.
 *   elite_producers: at least one STUD
 *   young_upside:    at least one YOUNG PLAYER
 *   draft_picks:     at least one pick
 *   roster_depth:    at least one STARTER-LEVEL PLAYER
 */
export function countWantsMoreMatches(received: StudioAsset[], wantsMore: string[]): number {
  if (!wantsMore?.length) return 0;
  const wants = new Set(wantsMore);
  let matches = 0;
  if (wants.has("elite_producers") && received.some(a => a.isStud)) matches++;
  if (wants.has("young_upside") && received.some(a => a.isYouth)) matches++;
  if (wants.has("draft_picks") && received.some(a => a.type === "pick")) matches++;
  if (wants.has("roster_depth") && received.some(a => a.type === "player" && !!a.isStarterLevel)) matches++;
  return matches;
}

// ─── Complementarity (COMPLIMENTARY PARTNER detection) ───────────────────

const MARKET_KEYS: Array<keyof StudioStrategyProfile> = [
  "qb_market", "rb_market", "wr_market", "te_market", "picks_market",
];

/**
 * Count of inverted BUY/SELL signals across the 5 markets.
 * Higher = more complementary partner. BUY+SELL or SELL+BUY = 1 each.
 * HOLD-anywhere or matching markers = 0.
 */
export function countComplementarity(
  mine: StudioStrategyProfile | null,
  theirs: StudioStrategyProfile | null,
): number {
  if (!mine || !theirs) return 0;
  let count = 0;
  for (const k of MARKET_KEYS) {
    const my = (mine as unknown as Record<string, string | undefined>)[k as string];
    const th = (theirs as unknown as Record<string, string | undefined>)[k as string];
    if (!my || !th) continue;
    if ((my === "buy" && th === "sell") || (my === "sell" && th === "buy")) count++;
  }
  return count;
}

// ─── TEAM MODE inference ─────────────────────────────────────────────────

/**
 * Infer TEAM MODE (contend / retool / rebuild) from roster composition and
 * profile. This mirrors the lighter-weight version used by the advisor — the
 * studio engine doesn't currently gate on team mode but stores it on profiles
 * so the future-pick logic and partner ranking can use it later.
 */
export function inferTeamMode(roster: StudioAsset[], profile: StudioStrategyProfile | null): TeamMode {
  const players = roster.filter(a => a.type === "player");
  if (players.length < 5) return "retool";

  const studCount = players.filter(p => p.isStud).length;
  const youthCount = players.filter(p => p.isYouth).length;
  const totalValue = players.reduce((sum, p) => sum + p.value, 0);
  const avgValue = players.length > 0 ? totalValue / players.length : 0;

  let score = 0;
  if (studCount >= 3 && avgValue >= 90) score += 2;
  else if (studCount >= 2) score += 1;
  if (youthCount >= 5 && studCount <= 1) score -= 2;
  else if (youthCount >= 4) score -= 1;

  const wants = new Set(profile?.wants_more ?? []);
  if (wants.has("elite_producers") && !wants.has("draft_picks") && !wants.has("young_upside")) score += 1;
  if ((wants.has("draft_picks") || wants.has("young_upside")) && !wants.has("elite_producers")) score -= 1;

  if (profile?.picks_market === "sell") score += 1;
  else if (profile?.picks_market === "buy") score -= 1;

  if (score >= 2) return "contend";
  if (score <= -2) return "rebuild";
  return "retool";
}

// ─── Convenience predicates ──────────────────────────────────────────────

export const isPlayer = (a: StudioAsset): boolean => a.type === "player";
export const isPick = (a: StudioAsset): boolean => a.type === "pick";
export const isStud = (a: StudioAsset): boolean => !!a.isStud;
export const isYouth = (a: StudioAsset): boolean => !!a.isYouth;
export const isAging = (a: StudioAsset): boolean => !!a.isAging;
export const isStarterLevel = (a: StudioAsset): boolean => !!a.isStarterLevel;
export const isUntouchable = (a: StudioAsset): boolean => a.tier === "untouchable";

/** AGING BENCH GUY per commandments: has age penalty AND not starter-level AND not stud. */
export const isAgingBenchGuy = (a: StudioAsset): boolean =>
  a.type === "player" && !!a.isAging && !a.isStarterLevel && !a.isStud;

/** Sum of values across an asset bundle. */
export const sumValue = (assets: StudioAsset[]): number =>
  assets.reduce((s, a) => s + a.value, 0);
