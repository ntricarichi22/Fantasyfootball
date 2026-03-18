import { getLlmPool } from "../llmDb";
import {
  extractWeekFromQuestion,
  includesAnyTerm,
} from "../questionUtils";
import type {
  HistorianAskInput,
  HistorianBuildPromptArgs,
  HistorianDataEnvelope,
  HistorianHandler,
} from "../historianTypes";

type WeeklyTeamGameRow = {
  season_year: number;
  week: number;
  week_type: string | null;
  franchise_name: string;
  opponent_franchise_name: string | null;
  result: string | null;
  points_for: number;
  points_against: number;
  is_playoffs: boolean | null;
  is_championship: boolean | null;
};

type WeeklyMatchupRow = {
  season_year: number;
  week: number;
  week_type: string | null;
  franchise_a_name: string;
  franchise_b_name: string;
  franchise_a_points: number;
  franchise_b_points: number;
};

type SeasonRow = {
  season_year: number;
  championship_week: number;
};

type WeeklyPerformanceMode =
  | "highest_score"
  | "lowest_score"
  | "highest_scoring_loss"
  | "lowest_winning_score"
  | "largest_margin"
  | "closest_game";

export type WeeklyPerformancePayload = {
  mode: WeeklyPerformanceMode;
  filters: {
    season_year: number | null;
    week: number | null;
    playoff_only: boolean;
    championship_only: boolean;
  };
  rows: Array<Record<string, unknown>>;
};

function detectWeeklyPerformanceMode(
  question: string
): WeeklyPerformanceMode | null {
  if (
    includesAnyTerm(question, ["highest scoring loss", "best losing effort"])
  ) {
    return "highest_scoring_loss";
  }

  if (includesAnyTerm(question, ["lowest winning score", "lowest winning"])) {
    return "lowest_winning_score";
  }

  if (
    includesAnyTerm(question, [
      "biggest blowout",
      "largest margin",
      "largest blowout",
      "biggest margin",
    ])
  ) {
    return "largest_margin";
  }

  if (
    includesAnyTerm(question, ["closest game", "smallest margin", "tightest game"])
  ) {
    return "closest_game";
  }

  if (
    includesAnyTerm(question, ["lowest score", "fewest points", "worst score"])
  ) {
    return "lowest_score";
  }

  if (
    includesAnyTerm(question, [
      "highest score",
      "most points",
      "best score",
      "highest scoring game",
    ])
  ) {
    return "highest_score";
  }

  return null;
}

async function getWeeklyPerformanceData(
  input: HistorianAskInput
): Promise<HistorianDataEnvelope<WeeklyPerformancePayload>> {
  const mode = detectWeeklyPerformanceMode(input.question);

  if (!mode) {
    throw new Error("Unable to detect weekly_performance mode");
  }

  const pool = getLlmPool();
  const weekFilter = extractWeekFromQuestion(input.question);
  const championshipOnly = includesAnyTerm(input.question, ["championship"]);
  const playoffOnly =
    !championshipOnly && includesAnyTerm(input.question, ["playoff", "playoffs"]);

  if (mode === "largest_margin" || mode === "closest_game") {
    const [matchupsResult, seasonsResult] = await Promise.all([
      pool.query<WeeklyMatchupRow>(
        `
          select
            season_year,
            week,
            week_type,
            franchise_a_name,
            franchise_b_name,
            franchise_a_points,
            franchise_b_points
          from llm.matchups
          where ($1::int is null or season_year = $1)
          order by season_year asc, week asc;
        `,
        [input.seasonYear ?? null]
      ),
      pool.query<SeasonRow>(`
        select
          season_year,
          championship_week
        from llm.seasons
        order by season_year asc;
      `),
    ]);

    const championshipWeekBySeason = new Map<number, number>(
      seasonsResult.rows.map((row) => [row.season_year, row.championship_week])
    );

    const rows = matchupsResult.rows
      .filter((row) => {
        if (typeof weekFilter === "number" && row.week !== weekFilter) {
          return false;
        }

        if (championshipOnly) {
          return championshipWeekBySeason.get(row.season_year) === row.week;
        }

        if (playoffOnly) {
          return row.week_type === "playoffs";
        }

        return true;
      })
      .map((row) => ({
        season_year: row.season_year,
        week: row.week,
        week_type: row.week_type,
        franchise_a_name: row.franchise_a_name,
        franchise_b_name: row.franchise_b_name,
        franchise_a_points: row.franchise_a_points,
        franchise_b_points: row.franchise_b_points,
        margin: Math.abs(row.franchise_a_points - row.franchise_b_points),
      }))
      .sort((a, b) => {
        if (mode === "largest_margin") {
          return (b.margin as number) - (a.margin as number);
        }

        return (a.margin as number) - (b.margin as number);
      })
      .slice(0, 25);

    return {
      family: "weekly_performance",
      payload: {
        mode,
        filters: {
          season_year: input.seasonYear ?? null,
          week: weekFilter,
          playoff_only: playoffOnly,
          championship_only: championshipOnly,
        },
        rows,
      },
    };
  }

  const teamGamesResult = await pool.query<WeeklyTeamGameRow>(
    `
      select
        season_year,
        week,
        week_type,
        franchise_name,
        opponent_franchise_name,
        result,
        points_for,
        points_against,
        is_playoffs,
        is_championship
      from llm.team_games
      where ($1::int is null or season_year = $1)
      order by season_year asc, week asc;
    `,
    [input.seasonYear ?? null]
  );

  const rows = teamGamesResult.rows
    .filter((row) => {
      if (typeof weekFilter === "number" && row.week !== weekFilter) {
        return false;
      }

      if (championshipOnly) {
        return row.is_championship === true;
      }

      if (playoffOnly) {
        return row.is_playoffs === true;
      }

      if (mode === "highest_scoring_loss") {
        return row.result === "L" || row.result === "LOSS";
      }

      if (mode === "lowest_winning_score") {
        return row.result === "W" || row.result === "WIN";
      }

      return true;
    })
    .map((row) => ({
      season_year: row.season_year,
      week: row.week,
      week_type: row.week_type,
      franchise_name: row.franchise_name,
      opponent_franchise_name: row.opponent_franchise_name,
      result: row.result,
      points_for: row.points_for,
      points_against: row.points_against,
      margin: Math.abs(row.points_for - row.points_against),
      is_playoffs: row.is_playoffs === true,
      is_championship: row.is_championship === true,
    }))
    .sort((a, b) => {
      if (mode === "lowest_score" || mode === "lowest_winning_score") {
        return (a.points_for as number) - (b.points_for as number);
      }

      return (b.points_for as number) - (a.points_for as number);
    })
    .slice(0, 25);

  return {
    family: "weekly_performance",
    payload: {
      mode,
      filters: {
        season_year: input.seasonYear ?? null,
        week: weekFilter,
        playoff_only: playoffOnly,
        championship_only: championshipOnly,
      },
      rows,
    },
  };
}

function buildWeeklyPerformancePrompt({
  input,
  data,
}: HistorianBuildPromptArgs<WeeklyPerformancePayload>): string {
  return [
    "You are answering a fantasy football league historian question.",
    "Only use the provided deterministic data.",
    "Do not invent facts.",
    "If the answer cannot be supported by the provided data, say that clearly.",
    "Keep the answer concise.",
    "",
    "Important data rules:",
    "- rows are already filtered and sorted for the requested weekly performance mode.",
    "- if a playoff or championship filter appears in the payload, use it exactly as provided.",
    "",
    `User question: ${input.question}`,
    "",
    "Deterministic historian data:",
    JSON.stringify(data),
  ].join("\n");
}

export const weeklyPerformanceHandler: HistorianHandler<WeeklyPerformancePayload> =
  {
    family: "weekly_performance",
    canHandle(input) {
      return detectWeeklyPerformanceMode(input.question) !== null;
    },
    getData: getWeeklyPerformanceData,
    buildPrompt: buildWeeklyPerformancePrompt,
  };