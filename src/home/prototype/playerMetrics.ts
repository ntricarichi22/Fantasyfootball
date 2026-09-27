import { ageBucket } from "@/shared/asset-values/age";
import { IMPACT_TOPN, SCRUB_RANK_FLOOR } from "@/shared/team-profiles/impact";
import { bucketOf } from "@/shared/team-profiles/buckets";
import type { Player } from "./model";

// Review fixtures only. Ranks describe the league-wide VALUE order, not this
// roster or fantasy scoring. Stud mirrors values.isStud (elite multiplier).
const scouting: Record<string, [number, number, boolean]> = {
  allen: [30, 2, true],
  love: [27, 11, false],
  bijan: [24, 2, true],
  jefferson: [27, 2, true],
  olave: [26, 23, false],
  hall: [25, 8, true],
  cook: [27, 14, false],
  mcbride: [26, 13, true],
  metcalf: [28, 32, false],
  purdy: [26, 13, false],
  lawrence: [26, 18, false],
  flowers: [26, 25, false],
  reed: [26, 38, false],
  robinson: [27, 32, false],
  kincaid: [26, 49, false],
  downs: [25, 51, false],
  bigsby: [25, 44, false],
  johnson: [30, 84, false],
  judkins: [22, 24, false],
  mcmillan: [23, 29, false],
  aiyuk: [28, 41, false],
  brooks: [23, 43, false],
  watson: [27, 65, false],
  dell: [26, 74, false],
  mccarthy: [23, 28, false],
  miller: [24, 49, false],
  musgrave: [26, 88, false],
};
export function qualityTier(
  position: string,
  valueRank: number,
  isStud: boolean,
) {
  const bucket = bucketOf(position);
  if (isStud) return "Stud";
  if (!bucket) return "Unrated";
  if (valueRank <= IMPACT_TOPN[bucket]) return "Impact";
  if (valueRank > SCRUB_RANK_FLOOR[bucket]) return "Scrub";
  return "Depth";
}
export function playerMetrics(p: Player) {
  const [age, valueRank, stud] = scouting[p.id] ?? [p.age, 50, false];
  const ageStatus = ageBucket(p.position, age);
  const quality = qualityTier(p.position, valueRank, stud);
  const seed = p.id.split("").reduce((n, c) => n + c.charCodeAt(0), 0);
  const seasons = 1 + (seed % 5);
  const games = p.group === "IR" ? 0 : 3;
  const average = Math.round(p.points * 1.06 * 10) / 10;
  return {
    age,
    ageStatus,
    quality,
    valueRank,
    games,
    average,
    seasonPoints: +(average * games).toFixed(1),
    seasonRank: Math.max(1, valueRank - (seed % 4)),
    franchiseSeasons: seasons,
    joined: 2027 - seasons,
    acquisition: seed % 2 ? "Rookie draft" : "Trade acquisition",
    franchiseStarts: seasons * 11 + (seed % 7),
    franchisePoints: (average * (seasons * 11 + (seed % 7))).toFixed(1),
    franchiseRank: 1 + (seed % 12),
    careerPoints: (average * (age - 21) * 12).toFixed(1),
    careerRank: 12 + (seed % 92),
    statLine:
      p.position === "QB"
        ? "742 PASS YDS · 6 TD · 2 INT"
        : p.position === "RB"
          ? "218 RUSH YDS · 9 REC · 3 TD"
          : "19 REC · 246 YDS · 2 TD",
  };
}
export type PickPrice = { firsts: number; seconds: number; thirds: number };
export const defaultPrice = (p: Player): PickPrice => {
  const tier = playerMetrics(p).quality;
  return tier === "Stud"
    ? { firsts: 2, seconds: 1, thirds: 0 }
    : tier === "Impact"
      ? { firsts: 1, seconds: 0, thirds: 0 }
      : { firsts: 0, seconds: tier === "Depth" ? 1 : 0, thirds: 1 };
};
export const priceText = (p: PickPrice) =>
  [
    p.firsts && `${p.firsts} × 1st`,
    p.seconds && `${p.seconds} × 2nd`,
    p.thirds && `${p.thirds} × 3rd`,
  ]
    .filter(Boolean)
    .join(" + ") || "Open to offers";
