// Fictional snapshot in the shared league settings shape; no live calls.
import { slotEligibility } from "@/shared/team-profiles/strength";
export const demoLeague = {
  rosterPositions: [
    "QB",
    "SUPER_FLEX",
    "RB",
    "WR",
    "WR",
    "FLEX",
    "FLEX",
    "REC_FLEX",
    "REC_FLEX",
    ...Array.from({ length: 9 }, () => "BN"),
  ],
  practiceSquadLimit: 2,
  irLimit: null as number | null,
  playoffs: { teams: 6, weeks: 3, byes: 2, startWeek: 15 },
  salaryCap: 100,
  salaryCapRemaining: 43,
};
export type Slot = {
  id: string;
  code: string;
  label: string;
  positions: string[];
};
export function buildSlots(positions: string[]): Slot[] {
  const counts: Record<string, number> = {};
  const labels: Record<string, string> = {
    SUPER_FLEX: "S-FLEX",
    REC_FLEX: "PC",
  };
  return positions.flatMap((code) => {
    const eligible = slotEligibility(code);
    if (!eligible) return [];
    counts[code] = (counts[code] ?? 0) + 1;
    return [
      {
        id: code + "-" + counts[code],
        code,
        label: labels[code] ?? code,
        positions: eligible,
      },
    ];
  });
}
export const lineupSlots = buildSlots(demoLeague.rosterPositions);
export const subLimit = demoLeague.rosterPositions.filter(
  (p) => p === "BN",
).length;
