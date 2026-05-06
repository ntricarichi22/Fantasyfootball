// src/lib/trade/core/shape.ts
//
// Shape-mismatch detection. Identifies cases where the user's offered
// asset bundle doesn't match what the partner is shopping for —
// e.g. shipping a pile of depth players to a partner who wants studs.
// Returns a short tag (or null) that the advisor turns into prose.

import type { RosterAsset, DealAsset, StrategyProfile } from "./types";

export function detectShapeMismatch(
  dealAssets: DealAsset[],
  rosters: Record<string, RosterAsset[]>,
  myTeamId: string,
  otherProfile: StrategyProfile | null,
): string | null {
  if (!otherProfile) return null;
  const otherWants = new Set(otherProfile.wants_more);

  const myAssets: RosterAsset[] = [];
  for (const a of dealAssets) {
    if (a.fromTeamId !== myTeamId) continue;
    const asset = (rosters[a.fromTeamId] ?? []).find((r) => r.key === a.key);
    if (asset) myAssets.push(asset);
  }
  if (myAssets.length === 0) return null;

  const hasStud = myAssets.some((a) => a.isStud);
  const hasYouth = myAssets.some((a) => a.isYouth);
  const hasPick = myAssets.some((a) => a.type === "pick");
  const allDepth = myAssets.every(
    (a) => !a.isStud && !a.isYouth && a.type === "player",
  );

  if (otherWants.has("elite_producers") && !hasStud && myAssets.length >= 3) {
    return "stacked_depth_for_studs";
  }
  if (otherWants.has("draft_picks") && !hasPick && myAssets.length >= 2) {
    return "no_picks_for_pick_buyer";
  }
  if (otherWants.has("young_upside") && !hasYouth && allDepth) {
    return "vets_for_youth_buyer";
  }
  return null;
}
