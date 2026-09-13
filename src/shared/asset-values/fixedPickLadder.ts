export const FIXED_PICK_LADDER_VERSION = "2026-09-12.v1";

const rounds = [
  [300,250,230,200,190,175,165,155,145,135,125,115],
  [100,85,75,68,61,54,47,41,35,31,27,24],
  [22,20,18,16,14,12,10,9,8,7,6,5],
] as const;

export const FIXED_PICK_LADDER = new Map<string, number>(
  rounds.flatMap((values, roundIndex) => values.map((value, slotIndex) =>
    [`${roundIndex + 1}.${String(slotIndex + 1).padStart(2, "0")}`, value] as const)),
);

export function fixedPickValue(round: number, slot: number): number | null {
  return FIXED_PICK_LADDER.get(`${round}.${String(slot).padStart(2, "0")}`) ?? null;
}
