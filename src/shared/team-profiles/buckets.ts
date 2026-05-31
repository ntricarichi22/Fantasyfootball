import type { StrategyProfile } from "@/shared/league-data";
import type { NeedBucket } from "./types";

// Single source of truth for two small, widely-shared mappings:
//
//  1. Roster position -> need bucket. Pass-catchers (WR + TE) are always one
//     bucket; TE is never a separate position in the engine's reasoning.
//  2. The owner's explicit "I'm shopping / I'm buying at this position" market
//     toggles, read straight off the strategy profile.
//
// Both the team-narratives brain (builder.ts + triggers.ts) and the
// trade-matching layer import from here, so the WR/TE merge and the market
// reads can never drift between callers.

export const POSITION_TO_BUCKET: Record<string, NeedBucket> = {
  QB: "QB",
  RB: "RB",
  WR: "PASS_CATCHER",
  TE: "PASS_CATCHER",
};

export function bucketOf(position: string): NeedBucket | null {
  return POSITION_TO_BUCKET[position] ?? null;
}

export function hasSellMarket(s: StrategyProfile | null): boolean {
  return (
    !!s &&
    (s.qbMarket === "sell" || s.rbMarket === "sell" || s.pcMarket === "sell" || s.picksMarket === "sell")
  );
}

export function hasBuyMarket(s: StrategyProfile | null): boolean {
  return (
    !!s &&
    (s.qbMarket === "buy" || s.rbMarket === "buy" || s.pcMarket === "buy" || s.picksMarket === "buy")
  );
}

export function sellMarketBuckets(s: StrategyProfile | null): NeedBucket[] {
  if (!s) return [];
  const out: NeedBucket[] = [];
  if (s.qbMarket === "sell") out.push("QB");
  if (s.rbMarket === "sell") out.push("RB");
  if (s.pcMarket === "sell") out.push("PASS_CATCHER");
  return out;
}

export function buyMarketBuckets(s: StrategyProfile | null): NeedBucket[] {
  if (!s) return [];
  const out: NeedBucket[] = [];
  if (s.qbMarket === "buy") out.push("QB");
  if (s.rbMarket === "buy") out.push("RB");
  if (s.pcMarket === "buy") out.push("PASS_CATCHER");
  return out;
}