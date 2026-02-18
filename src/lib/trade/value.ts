import tgifValues from "./tgif_values.json";
import type { DraftPick } from "../picks";

type Asset =
  | { type: "player"; playerId: string }
  | { type: "pick"; pick: DraftPick };

const DEFAULT_TEAM_COUNT = 12;
const FIRST_ROUND_BASE = 4500;
const FIRST_ROUND_EARLY_MULTIPLIER = 1.25;
const FIRST_ROUND_LATE_MULTIPLIER = 0.75;
const FUTURE_DISCOUNT: Record<string, number> = {
  "2027": 0.88,
};

const seasonDiscount = (season?: string) => {
  if (!season) return 1;
  return FUTURE_DISCOUNT[season] ?? 1;
};

const normalizeSlot = (pickNo?: number, teamCount: number = DEFAULT_TEAM_COUNT) => {
  if (!pickNo || pickNo <= 0) return undefined;
  if (pickNo > teamCount) {
    const normalized = ((pickNo - 1) % teamCount) + 1;
    return normalized;
  }
  return pickNo;
};

const tgifValueForPick = (pick: DraftPick, teamCount: number = DEFAULT_TEAM_COUNT) => {
  if (!pick.round || (pick.round !== 2 && pick.round !== 3)) return null;
  const baseSeason = pick.season ?? Object.keys(tgifValues)[0] ?? "2026";
  const seasonTable =
    (tgifValues as Record<string, Record<string, number>>)[baseSeason] ??
    (tgifValues as Record<string, Record<string, number>>)["2026"] ??
    {};
  const slot = normalizeSlot(pick.pick_no, teamCount) ?? Math.ceil(teamCount / 2);
  const key = `${pick.round}.${String(slot).padStart(2, "0")}`;
  return seasonTable[key] ?? null;
};

export const getPlayerValue = (playerId: string, values: Record<string, number | null | undefined>) => {
  const value = values?.[playerId];
  return typeof value === "number" ? value : null;
};

export const getPickValue = (pick: DraftPick, options?: { teamCount?: number }) => {
  if (!pick.round) return 0;
  const teamCount = options?.teamCount ?? DEFAULT_TEAM_COUNT;
  const discount = seasonDiscount(pick.season);

  if (pick.round === 2 || pick.round === 3) {
    const base = tgifValueForPick(pick, teamCount);
    if (base != null) {
      return Math.round(base * discount);
    }
    const fallbackMidSlot = `${pick.round}.06`;
    const fallback =
      (tgifValues as Record<string, Record<string, number>>)["2026"]?.[fallbackMidSlot] ?? 0;
    return Math.round(fallback * discount);
  }

  if (pick.round === 1) {
    const slot = normalizeSlot(pick.pick_no, teamCount) ?? Math.ceil(teamCount / 2);
    let multiplier = 1;
    if (slot <= Math.max(4, Math.floor(teamCount / 3))) {
      multiplier = FIRST_ROUND_EARLY_MULTIPLIER;
    } else if (slot >= teamCount - 3) {
      multiplier = FIRST_ROUND_LATE_MULTIPLIER;
    }
    const value = FIRST_ROUND_BASE * multiplier;
    return Math.round(value * discount);
  }

  const lateRoundBase = Math.max(5, 40 - (pick.round - 4) * 5);
  return Math.round(lateRoundBase * discount);
};

export const getAssetValue = (
  asset: Asset,
  values: Record<string, number | null | undefined>,
  options?: { teamCount?: number }
) => {
  if (asset.type === "player") {
    return getPlayerValue(asset.playerId, values) ?? 0;
  }
  return getPickValue(asset.pick, options);
};

export const sumPackageValue = (
  assets: Asset[],
  values: Record<string, number | null | undefined>,
  options?: { teamCount?: number }
) => assets.reduce((total, asset) => total + getAssetValue(asset, values, options), 0);
