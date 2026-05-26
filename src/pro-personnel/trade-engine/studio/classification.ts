// src/lib/trade/studio/classification.ts
//
// v3.4: Logic moved to core/. This file is a thin re-export shim that
// preserves the previous API surface for any leftover imports. Anyone
// importing from "studio/classification" continues to work without code
// changes; new code should import from "core/classification" or
// "core/ranking" directly.

export {
  parsePickKey,
  getCFCYear,
  computeStarterLevelKeys,
  enrichRosters,
  inferTeamMode,
  isPlayer,
  isPick,
  isStud,
  isYouth,
  isAging,
  isStarterLevel,
  isUntouchable,
  isAgingBenchGuy,
  sumValue,
} from "@/pro-personnel/engine/core/classification";

export { scoreWantsMatch, countComplementarity } from "@/pro-personnel/engine/core/ranking";

// Backwards-compat alias — old name was countWantsMoreMatches
export { scoreWantsMatch as countWantsMoreMatches } from "@/pro-personnel/engine/core/ranking";
