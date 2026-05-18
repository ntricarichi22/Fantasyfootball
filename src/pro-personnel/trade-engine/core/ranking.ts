// src/lib/trade/core/ranking.ts
//
// Wants-more matching + market complementarity scoring.
// Both signals feed Studio's offer ranker and (Stage 5) Builder's
// persona-aware suggestion engine.
//
// Count-based with caps per Nick's confirmation:
//   PICKS_CAP = 3   (a pile of picks is a real "wants more picks" hit)
//   OTHER_CAP = 2   (studs / young / depth saturate fast)

import type { RosterAsset, StrategyProfile } from "./types";

const PICKS_CAP = 3;
const OTHER_CAP = 2;

export function scoreWantsMatch(
  received: RosterAsset[],
  wantsMore: string[] | null | undefined,
): number {
  if (!wantsMore || wantsMore.length === 0) return 0;
  const wants = new Set(wantsMore);
  let score = 0;
  if (wants.has("elite_producers")) {
    score += Math.min(received.filter((a) => a.isStud).length, OTHER_CAP);
  }
  if (wants.has("young_upside")) {
    score += Math.min(received.filter((a) => a.isYouth).length, OTHER_CAP);
  }
  if (wants.has("draft_picks")) {
    score += Math.min(
      received.filter((a) => a.type === "pick").length,
      PICKS_CAP,
    );
  }
  if (wants.has("roster_depth")) {
    score += Math.min(
      received.filter((a) => a.type === "player" && !!a.isStarterLevel).length,
      OTHER_CAP,
    );
  }
  return score;
}

const MARKET_KEYS = [
  "qb_market",
  "rb_market",
  "wr_market",
  "te_market",
  "picks_market",
] as const;

export function countComplementarity(
  mine: StrategyProfile | null,
  theirs: StrategyProfile | null,
): number {
  if (!mine || !theirs) return 0;
  let count = 0;
  for (const k of MARKET_KEYS) {
    const my = mine[k];
    const th = theirs[k];
    if (!my || !th) continue;
    if ((my === "buy" && th === "sell") || (my === "sell" && th === "buy")) {
      count++;
    }
  }
  return count;
}
