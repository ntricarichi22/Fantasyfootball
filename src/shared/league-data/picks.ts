export type ParsedPickKey = {
  season: number;
  round: number;
  originalRosterId: string;
};

/** The durable identity is season + round + original roster. Slot is metadata. */
export function formatPickKey(season: number, round: number, originalRosterId: string): string {
  return `pick:${season}-${round}-${originalRosterId}`;
}

/**
 * Read the canonical key and the retired slotted current-year shape. Supporting
 * the latter lets persisted offers survive the one-time migration in 018.
 */
export function parsePickKey(key: string): ParsedPickKey | null {
  const parts = key.replace(/^pick:/, "").split("-");
  if (parts.length !== 3 && parts.length !== 4) return null;
  const season = Number(parts[0]);
  const round = Number(parts[1]);
  const originalRosterId = parts.at(-1) ?? "";
  if (!Number.isInteger(season) || !Number.isInteger(round) || !originalRosterId) return null;
  return { season, round, originalRosterId };
}

export function formatPickLabel(pick: {
  season: number;
  round: number;
  slot?: number | null;
}): string {
  return pick.slot == null
    ? `${pick.season} Rd ${pick.round}`
    : `${pick.season} ${pick.round}.${String(pick.slot).padStart(2, "0")}`;
}

export function getCFCYear(now = new Date()): number {
  return now.getMonth() >= 2 ? now.getFullYear() : now.getFullYear() - 1;
}

export function deriveOwnablePickShape(
  cfcYear: number,
  firstUndraftedSeason: number,
  drafts: Array<{ season?: string; settings?: { rounds?: number } }>,
  traded: Array<{ season?: string; round?: number }>,
): { seasons: number[]; rounds: number } {
  const seasons = new Set([firstUndraftedSeason, firstUndraftedSeason + 1, firstUndraftedSeason + 2]);
  let rounds = 3;
  for (const draft of drafts) {
    const year = Number(draft.season);
    if (Number.isInteger(year) && year >= cfcYear) seasons.add(year);
    const configuredRounds = Number(draft.settings?.rounds);
    if (Number.isInteger(configuredRounds) && configuredRounds > rounds) rounds = configuredRounds;
  }
  for (const pick of traded) {
    const year = Number(pick.season);
    if (Number.isInteger(year) && year >= cfcYear) seasons.add(year);
    if (Number.isInteger(pick.round) && Number(pick.round) > rounds) rounds = Number(pick.round);
  }
  return { seasons: [...seasons].filter(year => year >= cfcYear).sort((a, b) => a - b), rounds };
}

export function deriveSpentPickNumbers(
  pickNumbers: number[], complete: boolean, teamCount: number, rounds: number,
): Set<number> {
  if (complete) return new Set(Array.from({ length: teamCount * rounds }, (_, index) => index + 1));
  return new Set(pickNumbers);
}
