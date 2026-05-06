// src/lib/trade/core/liquidity.ts
//
// Liquidity tier classification. Used by the suggestion engine to decide
// when a combo bundle needs a "premium" anchor (S/A) — e.g. when the
// partner ships out a stud without receiving one in return.

import type { RosterAsset, LiquidityTier } from "./types";

export function getLiquidityTier(asset: RosterAsset): LiquidityTier {
  if (asset.type === "pick") {
    if (asset.name.includes(" Rd 1") || /\b1\.\d+\b/.test(asset.name)) return "S";
    if (asset.name.includes(" Rd 2") || /\b2\.\d+\b/.test(asset.name)) return "A";
    return "B";
  }
  if (asset.isStud) return "S";
  if (asset.isYouth && asset.value >= 80) return "A";
  if (asset.value >= 60) return "B";
  return "C";
}

export function isPremiumAsset(asset: RosterAsset): boolean {
  const t = getLiquidityTier(asset);
  return t === "S" || t === "A";
}
