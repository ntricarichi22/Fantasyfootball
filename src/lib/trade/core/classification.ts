// src/lib/trade/core/classification.ts
//
// Asset classification — pick parsing, starter-level inference, team-mode
// inference, and predicates (isStud / isYouth / isAging / isStarterLevel /
// isUntouchable / isAgingBenchGuy). All shared between Builder (advisor)
// and Studio.

import type { RosterAsset, StrategyProfile, TeamMode } from "./types";

// ─── Pick parsing ──────────────────────────────────────────────────────

export function parsePickKey(
  key: string,
): { year: number; round: number; slot: number } | null {
  if (!key.startsWith("pick:")) return null;
  const body = key.slice(5);
  const parts = body.split("-");
  if (parts.length !== 3) return null;
  const year = parseInt(parts[0], 10);
  const round = parseInt(parts[1], 10);
  const slot = parseInt(parts[2], 10);
  if (Number.isNaN(year) || Number.isNaN(round) || Number.isNaN(slot)) {
    return null;
  }
  return { year, round, slot };
}

export function getCFCYear(): number {
  const n = new Date();
  return n.getMonth() >= 2 ? n.getFullYear() : n.getFullYear() - 1;
}

// ─── Starter-level classification ──────────────────────────────────────
//
// A non-stud player is "starter-level" if they're in the top N at their
// position by value across the entire league. Excludes studs (already
// captured by isStud). Used by Studio's AGING BENCH GUY dealbreaker rule
// and by the wants-match ranker.

const STARTER_LEVEL_TOPN: Record<string, number> = {
  QB: 30,
  RB: 30,
  WR: 40,
  TE: 10,
};

export function computeStarterLevelKeys(
  rosters: Map<string, RosterAsset[]>,
): Set<string> {
  const byPosition = new Map<string, RosterAsset[]>();
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

export function enrichRosters(
  rosters: Map<string, RosterAsset[]>,
): Map<string, RosterAsset[]> {
  const starterKeys = computeStarterLevelKeys(rosters);
  const out = new Map<string, RosterAsset[]>();
  for (const [tid, assets] of rosters) {
    out.set(
      tid,
      assets.map((a) => {
        const next: RosterAsset = { ...a };
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
      }),
    );
  }
  return out;
}

// ─── Team mode inference ──────────────────────────────────────────────

export function inferTeamMode(
  roster: RosterAsset[],
  profile: StrategyProfile | null,
): TeamMode {
  const players = roster.filter((a) => a.type === "player");
  if (players.length < 5) return "retool";

  const studCount = players.filter((p) => p.isStud).length;
  const youthCount = players.filter((p) => p.isYouth).length;
  const totalValue = players.reduce((sum, p) => sum + p.value, 0);
  const avgValue = players.length > 0 ? totalValue / players.length : 0;

  let score = 0;
  if (studCount >= 3 && avgValue >= 90) score += 2;
  else if (studCount >= 2) score += 1;
  if (youthCount >= 5 && studCount <= 1) score -= 2;
  else if (youthCount >= 4) score -= 1;

  const wants = new Set(profile?.wants_more ?? []);
  if (
    wants.has("elite_producers") &&
    !wants.has("draft_picks") &&
    !wants.has("young_upside")
  ) {
    score += 1;
  }
  if (
    (wants.has("draft_picks") || wants.has("young_upside")) &&
    !wants.has("elite_producers")
  ) {
    score -= 1;
  }

  if (profile?.picks_market === "sell") score += 1;
  else if (profile?.picks_market === "buy") score -= 1;

  if (score >= 2) return "contend";
  if (score <= -2) return "rebuild";
  return "retool";
}

// ─── Convenience predicates ──────────────────────────────────────────

export const isPlayer = (a: RosterAsset): boolean => a.type === "player";
export const isPick = (a: RosterAsset): boolean => a.type === "pick";
export const isStud = (a: RosterAsset): boolean => !!a.isStud;
export const isYouth = (a: RosterAsset): boolean => !!a.isYouth;
export const isAging = (a: RosterAsset): boolean => !!a.isAging;
export const isStarterLevel = (a: RosterAsset): boolean => !!a.isStarterLevel;
export const isUntouchable = (a: RosterAsset): boolean =>
  a.tier === "untouchable";
export const isAgingBenchGuy = (a: RosterAsset): boolean =>
  a.type === "player" && !!a.isAging && !a.isStarterLevel && !a.isStud;

export const sumValue = (assets: RosterAsset[]): number =>
  assets.reduce((s, a) => s + a.value, 0);
