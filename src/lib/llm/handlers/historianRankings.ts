import {
  buildFranchiseAllTimeSummary,
  buildFranchiseSeasonSummaries,
  groupFranchiseSeasonsByFranchise,
} from "../franchiseSummaries";
import { getLlmPool } from "../llmDb";
import { includesAnyTerm } from "../questionUtils";
import type {
  HistorianAskInput,
  HistorianBuildPromptArgs,
  HistorianDataEnvelope,
  HistorianHandler,
} from "../historianTypes";

type RankingMode =
  | "most_titles"
  | "most_playoff_appearances"
  | "greatest_dynasty"
  | "best_championship_performance"
  | "biggest_playoff_blowout";

type ChampionshipGameRow = {
  season_year: number;
  week: number;
  franchise_name: string;
  opponent_franchise_name: string | null;
  points_for: number;
  points_against: number;
  result: string | null;
};

type PlayoffMatchupRow = {
  season_year: number;
  week: number;
  franchise_a_name: string;
  franchise_b_name: string;
  franchise_a_points: number;
  franchise_b_points: number;
};

export type HistorianRankingsPayload = {
  mode: RankingMode;
  ranking_definition: string;
  rows: Array<Record<string, unknown>>;
};

function detectHistorianRankingMode(question: string): RankingMode | null {
  if (includesAnyTerm(question, ["greatest dynasty", "best dynasty"])) {
    return "greatest_dynasty";
  }

  if (includesAnyTerm(question, ["most titles", "most championships"])) {
    return "most_titles";
  }

  if (includesAnyTerm(question, ["most playoff appearances"])) {
    return "most_playoff_appearances";
  }

  if (
    includesAnyTerm(question, [
      "best championship performance",
      "highest championship score",
      "best championship game",
    ])
  ) {
    return "best_championship_performance";
  }

  if (
    includesAnyTerm(question, [
      "biggest playoff blowout",
      "largest playoff blowout",
      "largest playoff margin",
    ])
  ) {
    return "biggest_playoff_blowout";
  }

  return null;
}

async function getHistorianRankingsData(
  input: HistorianAskInput
): Promise<HistorianDataEnvelope<HistorianRankingsPayload>> {
  const mode = detectHistorianRankingMode(input.question);

  if (!mode) {
    throw new Error("Unable to detect historian_rankings mode");
  }

  if (
    mode === "most_titles" ||
    mode === "most_playoff_appearances" ||
    mode === "greatest_dynasty"
  ) {
    const seasons = await buildFranchiseSeasonSummaries();
    const grouped = groupFranchiseSeasonsByFranchise(seasons);

    const rows = Array.from(grouped.values())
      .map((franchiseSeasons) => {
        const allTime = buildFranchiseAllTimeSummary(franchiseSeasons);
        const franchiseName = franchiseSeasons[0]?.franchise_name ?? "Unknown";

        return {
          franchise_name: franchiseName,
          titles: allTime.titles,
          championship_appearances: allTime.championship_appearances,
          playoff_appearances: allTime.playoff_appearances,
          wins: allTime.wins,
          losses: allTime.losses,
          ties: allTime.ties,
          points_for: allTime.points_for,
          seasons_played: allTime.seasons_played,
        };
      })
      .sort((a, b) => {
        if (mode === "most_playoff_appearances") {
          if (b.playoff_appearances !== a.playoff_appearances) {
            return b.playoff_appearances - a.playoff_appearances;
          }

          if (b.titles !== a.titles) {
            return b.titles - a.titles;
          }

          return b.wins - a.wins;
        }

        if (b.titles !== a.titles) {
          return b.titles - a.titles;
        }

        if (b.championship_appearances !== a.championship_appearances) {
          return b.championship_appearances - a.championship_appearances;
        }

        if (b.playoff_appearances !== a.playoff_appearances) {
          return b.playoff_appearances - a.playoff_appearances;
        }

        return b.wins - a.wins;
      })
      .slice(0, 25);

    const rankingDefinition =
      mode === "most_playoff_appearances"
        ? "sorted by playoff_appearances, then titles, then wins"
        : "sorted by titles, then championship_appearances, then playoff_appearances, then wins";

    return {
      family: "historian_rankings",
      payload: {
        mode,
        ranking_definition: rankingDefinition,
        rows,
      },
    };
  }

  const pool = getLlmPool();

  if (mode === "best_championship_performance") {
    const result = await pool.query<ChampionshipGameRow>(
      `
        select
          season_year,
          week,
          franchise_name,
          opponent_franchise_name,
          points_for,
          points_against,
          result
        from llm.team_games
        where is_championship = true
          and ($1::int is null or season_year = $1)
        order by points_for desc, season_year asc;
      `,
      [input.seasonYear ?? null]
    );

    return {
      family: "historian_rankings",
      payload: {
        mode,
        ranking_definition: "sorted by championship game points_for descending",
        rows: result.rows.slice(0, 25),
      },
    };
  }

  const result = await pool.query<PlayoffMatchupRow>(
    `
      select
        season_year,
        week,
        franchise_a_name,
        franchise_b_name,
        franchise_a_points,
        franchise_b_points
      from llm.matchups
      where week_type = 'playoffs'
        and ($1::int is null or season_year = $1)
      order by season_year asc, week asc;
    `,
    [input.seasonYear ?? null]
  );

  const rows = result.rows
    .map((row) => ({
      season_year: row.season_year,
      week: row.week,
      franchise_a_name: row.franchise_a_name,
      franchise_b_name: row.franchise_b_name,
      franchise_a_points: row.franchise_a_points,
      franchise_b_points: row.franchise_b_points,
      margin: Math.abs(row.franchise_a_points - row.franchise_b_points),
    }))
    .sort((a, b) => (b.margin as number) - (a.margin as number))
    .slice(0, 25);

  return {
    family: "historian_rankings",
    payload: {
      mode,
      ranking_definition: "sorted by playoff matchup margin descending",
      rows,
    },
  };
}

function buildHistorianRankingsPrompt({
  input,
  data,
}: HistorianBuildPromptArgs<HistorianRankingsPayload>): string {
  return [
    "You are answering a fantasy football league historian question.",
    "Only use the provided deterministic data.",
    "Do not invent facts.",
    "If the answer cannot be supported by the provided data, say that clearly.",
    "Keep the answer concise.",
    "",
    "Important data rules:",
    "- ranking_definition tells you exactly how the rows were sorted.",
    "- do not invent a different ranking formula than the one provided.",
    "",
    `User question: ${input.question}`,
    "",
    "Deterministic historian data:",
    JSON.stringify(data),
  ].join("\n");
}

export const historianRankingsHandler: HistorianHandler<HistorianRankingsPayload> =
  {
    family: "historian_rankings",
    canHandle(input) {
      return detectHistorianRankingMode(input.question) !== null;
    },
    getData: getHistorianRankingsData,
    buildPrompt: buildHistorianRankingsPrompt,
  };