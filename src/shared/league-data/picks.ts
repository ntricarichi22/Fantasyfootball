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
