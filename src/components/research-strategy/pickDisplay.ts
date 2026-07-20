// Pick key shapes (from the trade engine):
//   current-year (slot known):  pick:YYYY-R-SS-RID
//   future-year  (slot unknown): pick:YYYY-R-RID
// We parse for display only; value + inventory come from the targets route.

export type ParsedPick = { year: number; round: number; slot: number | null };

export const parsePickKey = (key: string): ParsedPick | null => {
  if (!key.startsWith("pick:")) return null;
  const parts = key.slice(5).split("-");
  if (parts.length !== 3 && parts.length !== 4) return null;
  const year = parseInt(parts[0], 10);
  const round = parseInt(parts[1], 10);
  if (Number.isNaN(year) || Number.isNaN(round)) return null;
  let slot: number | null = null;
  if (parts.length === 4) {
    const parsed = parseInt(parts[2], 10);
    slot = Number.isNaN(parsed) ? null : parsed;
  }
  return { year, round, slot };
};

const ORDINAL: Record<number, string> = { 1: "1ST", 2: "2ND", 3: "3RD" };
export const formatRoundOrdinal = (round: number): string => ORDINAL[round] ?? `${round}TH`;
const ordinalRound = formatRoundOrdinal;


// Known current-year slot -> "2.04"; otherwise the ordinal round -> "2ND".
export const formatPickBigText = (parsed: ParsedPick): string => {
  if (parsed.slot != null && parsed.slot > 0) {
    return `${parsed.round}.${String(parsed.slot).padStart(2, "0")}`;
  }
  return ordinalRound(parsed.round);
};

export const formatPickSubtitle = (parsed: ParsedPick): string => `${parsed.year} Draft`;

