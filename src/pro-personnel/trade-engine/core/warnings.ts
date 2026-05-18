// src/lib/trade/core/warnings.ts
//
// Post-trade roster warnings. Catches situations like "you'd lose your
// only real starter QB" that are dealbreakers for Superflex or otherwise
// need surfacing before the user sends an offer. Studio promotes
// "alarm"-severity warnings to dealbreakers; Builder shows them all.

import type { RosterAsset, DealAsset, PostTradeWarning } from "./types";

const REAL_QB_THRESHOLD = 150;

export function computePostTradeWarnings(
  dealAssets: DealAsset[],
  rosters: Record<string, RosterAsset[]>,
  myTeamId: string,
): PostTradeWarning[] {
  const warnings: PostTradeWarning[] = [];
  const myRoster = rosters[myTeamId] ?? [];
  const sentKeys = new Set(
    dealAssets.filter((a) => a.fromTeamId === myTeamId).map((a) => a.key),
  );
  const receivedAssets: RosterAsset[] = [];
  for (const a of dealAssets) {
    if (a.toTeamId !== myTeamId) continue;
    const asset = (rosters[a.fromTeamId] ?? []).find((r) => r.key === a.key);
    if (asset) receivedAssets.push(asset);
  }
  const postTrade = [
    ...myRoster.filter((p) => !sentKeys.has(p.key)),
    ...receivedAssets,
  ];

  const allQbs = postTrade.filter(
    (p) => p.position === "QB" && p.type === "player",
  );
  const realStarterQbs = allQbs.filter(
    (p) => p.isStud || p.value >= REAL_QB_THRESHOLD,
  );

  const sentRealStarterQB = myRoster.some(
    (p) =>
      sentKeys.has(p.key) &&
      p.position === "QB" &&
      p.type === "player" &&
      (p.isStud || p.value >= REAL_QB_THRESHOLD),
  );

  if (allQbs.length === 1) {
    warnings.push({
      severity: "alarm",
      message: `This trade leaves you with only one QB (${allQbs[0].name}). Superflex makes this a major roster hole.`,
    });
  } else if (sentRealStarterQB && realStarterQbs.length <= 1) {
    const bench = allQbs
      .filter((p) => !p.isStud && p.value < REAL_QB_THRESHOLD)
      .map((p) => p.name)
      .slice(0, 2)
      .join(", ");
    const remaining =
      realStarterQbs.length === 1
        ? `Only ${realStarterQbs[0].name} remains as a real starter; the rest (${bench || "your backups"}) are depth.`
        : `What's left (${bench || "your backups"}) is bench-level QB play.`;
    warnings.push({
      severity: "alarm",
      message: `This trade ships out a real starter QB. ${remaining} For Superflex, that's a major hole.`,
    });
  } else if (
    allQbs.length === 2 &&
    myRoster.some((p) => sentKeys.has(p.key) && p.position === "QB")
  ) {
    warnings.push({
      severity: "warning",
      message: "This trade drops you to two QBs. Thin for Superflex.",
    });
  }

  const sentYouth = myRoster.filter(
    (p) => sentKeys.has(p.key) && p.isYouth && p.type === "player",
  ).length;
  const receivedYouth = receivedAssets.filter(
    (p) => p.isYouth && p.type === "player",
  ).length;
  if (sentYouth >= 2 && receivedYouth === 0) {
    warnings.push({
      severity: "info",
      message:
        "You're sending out multiple young players without getting youth back.",
    });
  }

  return warnings;
}
