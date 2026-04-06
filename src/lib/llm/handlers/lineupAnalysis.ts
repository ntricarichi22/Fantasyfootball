import { getLlmPool } from "../llmDb";
import { resolvePlayerInQuestion } from "../entityResolvers";
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

type LineupEntryRow = {
  team_game_id: string;
  season_year: number;
  week: number;
  week_type: string | null;
  player_id: string;
  franchise_name: string;
  opponent_franchise_name: string | null;
  result: string | null;
  is_playoffs: boolean | null;
  is_championship: boolean | null;
  is_starter: boolean;
  player_name: string;
  points: number;
};

type LineupAnalysisMode =
  | "player_starter_lookup"
  | "highest_non_starter_points"
  | "highest_benched_player"
  | "highest_starter_points";

export type LineupAnalysisPayload = {
  mode: LineupAnalysisMode;
  filters: {
    season_year: number | null;
    week: number | null;
    playoff_only: boolean;
    championship_only: boolean;
  };
  player: {
    player_id: string;
    player_name: string;
  } | null;
  starter_rows: Array<{
    season_year: number;
    week: number;
    week_type: string | null;
    franchise_name: string;
    opponent_franchise_name: string | null;
    result: string | null;
    is_playoffs: boolean;
    is_championship: boolean;
    points: number;
  }>;
  rows: Array<{
    season_year: number;
    week: number;
    week_type: string | null;
    franchise_name: string;
    opponent_franchise_name: string | null;
    result: string | null;
    is_playoffs: boolean;
    is_championship: boolean;
    starter_points: number;
    non_starter_points: number;
    top_non_starter_player_name: string | null;
    top_non_starter_player_points: number;
  }>;
};

function detectLineupAnalysisMode(question: string): LineupAnalysisMode | null {
  if (
    includesAnyTerm(question, [
      "who started",
      "started in championship week",
    ])
  ) {
    return "player_starter_lookup";
  }

  if (
    includesAnyTerm(question, [
      "highest scoring benched player",
      "best benched player",
      "top benched player",
    ])
  ) {
    return "highest_benched_player";
  }

  if (
    includesAnyTerm(question, [
      "best lineup",
      "highest starter points",
      "highest starting lineup",
    ])
  ) {
    return "highest_starter_points";
  }

  if (
    includesAnyTerm(question, [
      "bench",
      "benched",
      "lineup",
      "left on bench",
      "non starter",
      "non-starter",
      "start sit",
      "mistake",
      "optimal lineup",
    ])
  ) {
    return "highest_non_starter_points";
  }

  return null;
}

async function getLineupAnalysisData(
  input: HistorianAskInput
): Promise<HistorianDataEnvelope<LineupAnalysisPayload>> {
  const mode = detectLineupAnalysisMode(input.question);

  if (!mode) {
    throw new Error("Unable to detect lineup_analysis mode");
  }

  const pool = getLlmPool();
  const resolvedPlayer =
    mode === "player_starter_lookup"
      ? await resolvePlayerInQuestion(input.question)
      : null;

  if (mode === "player_starter_lookup" && !resolvedPlayer) {
    throw new Error("player starter lookup requires one player name");
  }

  const weekFilter = extractWeekFromQuestion(input.question);
  const championshipOnly = includesAnyTerm(input.question, ["championship"]);
  const playoffOnly =
    !championshipOnly && includesAnyTerm(input.question, ["playoff", "playoffs"]);

  const result = await pool.query<LineupEntryRow>(
    `
      select
        team_game_id,
        season_year,
        week,
        week_type,
        player_id,
        franchise_name,
        opponent_franchise_name,
        result,
        is_playoffs,
        is_championship,
        is_starter,
        player_name,
        points
      from llm.lineup_entries
      where ($1::int is null or season_year = $1)
      order by season_year asc, week asc, franchise_name asc;
    `,
    [input.seasonYear ?? null]
  );

  const gameMap = new Map<
    string,
    {
      season_year: number;
      week: number;
      week_type: string | null;
      franchise_name: string;
      opponent_franchise_name: string | null;
      result: string | null;
      is_playoffs: boolean;
      is_championship: boolean;
      starter_points: number;
      non_starter_points: number;
      top_non_starter_player_name: string | null;
      top_non_starter_player_points: number;
    }
  >();

  for (const row of result.rows) {
    if (typeof weekFilter === "number" && row.week !== weekFilter) {
      continue;
    }

    if (championshipOnly && row.is_championship !== true) {
      continue;
    }

    if (playoffOnly && row.is_playoffs !== true) {
      continue;
    }

    if (!gameMap.has(row.team_game_id)) {
      gameMap.set(row.team_game_id, {
        season_year: row.season_year,
        week: row.week,
        week_type: row.week_type,
        franchise_name: row.franchise_name,
        opponent_franchise_name: row.opponent_franchise_name,
        result: row.result,
        is_playoffs: row.is_playoffs === true,
        is_championship: row.is_championship === true,
        starter_points: 0,
        non_starter_points: 0,
        top_non_starter_player_name: null,
        top_non_starter_player_points: 0,
      });
    }

    const summary = gameMap.get(row.team_game_id)!;

    if (row.is_starter) {
      summary.starter_points += row.points;
    } else {
      summary.non_starter_points += row.points;

      if (row.points > summary.top_non_starter_player_points) {
        summary.top_non_starter_player_points = row.points;
        summary.top_non_starter_player_name = row.player_name;
      }
    }
  }

  const rows = Array.from(gameMap.values())
    .sort((a, b) => {
      if (mode === "highest_starter_points") {
        return b.starter_points - a.starter_points;
      }

      if (mode === "highest_benched_player") {
        return (
          b.top_non_starter_player_points - a.top_non_starter_player_points
        );
      }

      return b.non_starter_points - a.non_starter_points;
    })
    .slice(0, 25);

  const starterRows =
    mode === "player_starter_lookup" && resolvedPlayer
      ? result.rows
          .filter(
            (row) =>
              row.is_starter &&
              row.player_id === resolvedPlayer.player_id &&
              (typeof weekFilter !== "number" || row.week === weekFilter) &&
              (!championshipOnly || row.is_championship === true) &&
              (!playoffOnly || row.is_playoffs === true)
          )
          .map((row) => ({
            season_year: row.season_year,
            week: row.week,
            week_type: row.week_type,
            franchise_name: row.franchise_name,
            opponent_franchise_name: row.opponent_franchise_name,
            result: row.result,
            is_playoffs: row.is_playoffs === true,
            is_championship: row.is_championship === true,
            points: row.points,
          }))
      : [];

  return {
    family: "lineup_analysis",
    notes: [
      "non_starter_points are all points scored by players not marked as starters",
      "this is a proxy for bench regret, not a position-correct optimal lineup calculation",
    ],
    payload: {
      mode,
      filters: {
        season_year: input.seasonYear ?? null,
        week: weekFilter,
        playoff_only: playoffOnly,
        championship_only: championshipOnly,
      },
      player: resolvedPlayer
        ? {
            player_id: resolvedPlayer.player_id,
            player_name: resolvedPlayer.player_name,
          }
        : null,
      starter_rows: starterRows,
      rows,
    },
  };
}

function buildLineupAnalysisPrompt({
  input,
  data,
}: HistorianBuildPromptArgs<LineupAnalysisPayload>): string {
  return [
    "You are answering a fantasy football league historian question.",
    "Only use the provided deterministic data.",
    "Do not invent facts.",
    "If the answer cannot be supported by the provided data, say that clearly.",
    "Keep the answer concise.",
    "",
    "Important data rules:",
    "- non_starter_points are all points scored by players who were not marked as starters.",
    "- this is a bench-regret proxy, not a position-correct optimal lineup calculation.",
    "",
    `User question: ${input.question}`,
    "",
    "Deterministic historian data:",
    JSON.stringify(data),
  ].join("\n");
}

export const lineupAnalysisHandler: HistorianHandler<LineupAnalysisPayload> = {
  family: "lineup_analysis",
  canHandle(input) {
    return detectLineupAnalysisMode(input.question) !== null;
  },
  getData: getLineupAnalysisData,
  buildPrompt: buildLineupAnalysisPrompt,
};
