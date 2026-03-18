import { getSeasonRules } from "./seasonRules";

export type SeasonGameLike = {
  season_year: number;
  week: number | null;
  week_type: string | null;
  is_playoffs?: boolean | null;
  is_championship?: boolean | null;
};

type RegularSeasonGame = SeasonGameLike & {
  week: number;
  week_type: "regular_season";
};

export function normalizeResult(result: string | null | undefined): string {
  return (result ?? "").trim().toUpperCase();
}

export function isWinResult(result: string | null | undefined): boolean {
  const normalized = normalizeResult(result);

  return normalized === "W" || normalized === "WIN";
}

export function isLossResult(result: string | null | undefined): boolean {
  const normalized = normalizeResult(result);

  return normalized === "L" || normalized === "LOSS";
}

export function isTieResult(result: string | null | undefined): boolean {
  const normalized = normalizeResult(result);

  return normalized === "T" || normalized === "TIE";
}

export function isRegularSeasonGame(
  row: SeasonGameLike
): row is RegularSeasonGame {
  return (
    row.week_type === "regular_season" &&
    typeof row.week === "number" &&
    Number.isInteger(row.week)
  );
}

export function isWithinRecordWindow(row: SeasonGameLike): boolean {
  if (!isRegularSeasonGame(row)) {
    return false;
  }

  const rules = getSeasonRules(row.season_year);

  return (
    row.week >= rules.recordWindow.startWeek &&
    row.week <= rules.recordWindow.endWeek
  );
}

export function isWithinPointsWindow(row: SeasonGameLike): boolean {
  if (!isRegularSeasonGame(row)) {
    return false;
  }

  const rules = getSeasonRules(row.season_year);

  return (
    row.week >= rules.pointsWindow.startWeek &&
    row.week <= rules.pointsWindow.endWeek
  );
}

export function isPlayoffGame(row: SeasonGameLike): boolean {
  return row.is_playoffs === true || row.week_type === "playoffs";
}

export function isChampionshipGame(row: SeasonGameLike): boolean {
  return row.is_championship === true;
}