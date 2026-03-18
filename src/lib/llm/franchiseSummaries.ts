import { getLlmPool } from "./llmDb";
import {
  isChampionshipGame,
  isLossResult,
  isPlayoffGame,
  isTieResult,
  isWithinPointsWindow,
  isWithinRecordWindow,
  isWinResult,
} from "./seasonFilters";

type FranchiseSeasonRow = {
  franchise_id: string;
  franchise_name: string;
  season_year: number;
};

type TeamGameRow = {
  franchise_id: string;
  franchise_name: string;
  season_year: number;
  week: number | null;
  week_type: string | null;
  result: string | null;
  points_for: number | null;
  points_against: number | null;
  is_playoffs: boolean | null;
  is_championship: boolean | null;
};

export type ComputedFranchiseSeason = {
  franchise_id: string;
  franchise_name: string;
  season_year: number;
  wins: number;
  losses: number;
  ties: number;
  points_for: number;
  points_against: number;
  made_playoffs: boolean;
  made_championship: boolean;
  won_title: boolean;
};

export type ComputedFranchiseAllTime = {
  wins: number;
  losses: number;
  ties: number;
  points_for: number;
  points_against: number;
  seasons_played: number;
  playoff_appearances: number;
  championship_appearances: number;
  titles: number;
  undefeated_seasons: number;
};

export async function buildFranchiseSeasonSummaries(
  franchiseIds?: string[]
): Promise<ComputedFranchiseSeason[]> {
  const pool = getLlmPool();
  const idSet = franchiseIds ? new Set(franchiseIds) : null;

  const seasonRowsResult = await pool.query<FranchiseSeasonRow>(`
    select
      franchise_id,
      franchise_name,
      season_year
    from llm.franchise_seasons
    order by franchise_name asc, season_year asc;
  `);

  const teamGameRowsResult = await pool.query<TeamGameRow>(`
    select
      franchise_id,
      franchise_name,
      season_year,
      week,
      week_type,
      result,
      points_for,
      points_against,
      is_playoffs,
      is_championship
    from llm.team_games
    order by franchise_name asc, season_year asc, week asc;
  `);

  const seasonMap = new Map<string, ComputedFranchiseSeason>();

  for (const row of seasonRowsResult.rows) {
    if (idSet && !idSet.has(row.franchise_id)) {
      continue;
    }

    const key = `${row.franchise_id}::${row.season_year}`;

    seasonMap.set(key, {
      franchise_id: row.franchise_id,
      franchise_name: row.franchise_name,
      season_year: row.season_year,
      wins: 0,
      losses: 0,
      ties: 0,
      points_for: 0,
      points_against: 0,
      made_playoffs: false,
      made_championship: false,
      won_title: false,
    });
  }

  for (const row of teamGameRowsResult.rows) {
    if (idSet && !idSet.has(row.franchise_id)) {
      continue;
    }

    const key = `${row.franchise_id}::${row.season_year}`;

    if (!seasonMap.has(key)) {
      seasonMap.set(key, {
        franchise_id: row.franchise_id,
        franchise_name: row.franchise_name,
        season_year: row.season_year,
        wins: 0,
        losses: 0,
        ties: 0,
        points_for: 0,
        points_against: 0,
        made_playoffs: false,
        made_championship: false,
        won_title: false,
      });
    }

    const summary = seasonMap.get(key)!;

    if (isWithinRecordWindow(row)) {
      if (isWinResult(row.result)) {
        summary.wins += 1;
      } else if (isLossResult(row.result)) {
        summary.losses += 1;
      } else if (isTieResult(row.result)) {
        summary.ties += 1;
      }
    }

    if (isWithinPointsWindow(row)) {
      summary.points_for += row.points_for ?? 0;
      summary.points_against += row.points_against ?? 0;
    }

    if (isPlayoffGame(row)) {
      summary.made_playoffs = true;
    }

    if (isChampionshipGame(row)) {
      summary.made_championship = true;

      if (isWinResult(row.result)) {
        summary.won_title = true;
      }
    }
  }

  return Array.from(seasonMap.values()).sort((a, b) => {
    if (a.franchise_name !== b.franchise_name) {
      return a.franchise_name.localeCompare(b.franchise_name);
    }

    return a.season_year - b.season_year;
  });
}

export function buildFranchiseAllTimeSummary(
  seasons: ComputedFranchiseSeason[]
): ComputedFranchiseAllTime {
  return seasons.reduce<ComputedFranchiseAllTime>(
    (acc, season) => {
      acc.wins += season.wins;
      acc.losses += season.losses;
      acc.ties += season.ties;
      acc.points_for += season.points_for;
      acc.points_against += season.points_against;
      acc.seasons_played += 1;

      if (season.made_playoffs) {
        acc.playoff_appearances += 1;
      }

      if (season.made_championship) {
        acc.championship_appearances += 1;
      }

      if (season.won_title) {
        acc.titles += 1;
      }

      if (season.wins > 0 && season.losses === 0 && season.ties === 0) {
        acc.undefeated_seasons += 1;
      }

      return acc;
    },
    {
      wins: 0,
      losses: 0,
      ties: 0,
      points_for: 0,
      points_against: 0,
      seasons_played: 0,
      playoff_appearances: 0,
      championship_appearances: 0,
      titles: 0,
      undefeated_seasons: 0,
    }
  );
}

export function groupFranchiseSeasonsByFranchise(
  seasons: ComputedFranchiseSeason[]
): Map<string, ComputedFranchiseSeason[]> {
  const grouped = new Map<string, ComputedFranchiseSeason[]>();

  for (const season of seasons) {
    const existing = grouped.get(season.franchise_id) ?? [];
    existing.push(season);
    grouped.set(season.franchise_id, existing);
  }

  return grouped;
}