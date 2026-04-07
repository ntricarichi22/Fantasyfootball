import { getLlmPool } from "../llmDb";
import { resolvePlayerInQuestion } from "../entityResolvers";
import { includesAnyTerm } from "../questionUtils";
import type {
  HistorianAskInput,
  HistorianBuildPromptArgs,
  HistorianDataEnvelope,
  HistorianHandler,
} from "../historianTypes";

type PlayerLineupRow = {
  season_year: number;
  franchise_name: string;
  is_starter: boolean;
  is_playoffs: boolean | null;
  is_championship: boolean | null;
  points: number;
};

type DraftPickRow = {
  season_year: number;
  round: number;
  pick_number: number;
  selected_by_franchise_name: string | null;
};

export type PlayerCareerPayload = {
  player: {
    player_id: string;
    player_name: string;
    primary_position: string | null;
  };
  drafted: {
    season_year: number;
    round: number;
    pick_number: number;
    selected_by_franchise_name: string | null;
  } | null;
  all_time: {
    appearances: number;
    games_started: number;
    started_points: number;
    playoff_started_points: number;
    championship_started_points: number;
    seasons_with_starts: number;
    franchises_played_for: string[];
  };
  seasons: Array<{
    season_year: number;
    appearances: number;
    games_started: number;
    started_points: number;
    playoff_started_points: number;
    championship_started_points: number;
    franchises: string[];
  }>;
};

function looksLikePlayerCareerQuestion(question: string): boolean {
  return !includesAnyTerm(question, [
    "who started",
    "started in championship week",
    "lineup",
    "bench",
    "trade",
    "traded",
    "waiver",
    "waivers",
    "claim",
    "transaction",
    "draft",
    "pick",
  ]);
}

async function getPlayerCareerData(
  input: HistorianAskInput
): Promise<HistorianDataEnvelope<PlayerCareerPayload>> {
  const player = await resolvePlayerInQuestion(input.question);

  if (!player) {
    throw new Error("player_career requires one player name");
  }

  const pool = getLlmPool();

  const [lineupResult, draftResult] = await Promise.all([
    pool.query<PlayerLineupRow>(
      `
        select
          season_year,
          franchise_name,
          is_starter,
          is_playoffs,
          is_championship,
          points
        from llm.lineup_entries
        where player_id::text = $1::text
        order by season_year asc;
      `,
      [player.player_id]
    ),
    pool.query<DraftPickRow>(
      `
        select
          season_year,
          round,
          pick_number,
          selected_by_franchise_name
        from llm.draft_picks
        where selected_player_id::text = $1::text
        order by season_year asc
        limit 1;
      `,
      [player.player_id]
    ),
  ]);

  const seasonMap = new Map<
    number,
    {
      season_year: number;
      appearances: number;
      games_started: number;
      started_points: number;
      playoff_started_points: number;
      championship_started_points: number;
      franchises: Set<string>;
    }
  >();

  const allTimeFranchises = new Set<string>();
  let appearances = 0;
  let gamesStarted = 0;
  let startedPoints = 0;
  let playoffStartedPoints = 0;
  let championshipStartedPoints = 0;

  for (const row of lineupResult.rows) {
    appearances += 1;
    allTimeFranchises.add(row.franchise_name);

    if (!seasonMap.has(row.season_year)) {
      seasonMap.set(row.season_year, {
        season_year: row.season_year,
        appearances: 0,
        games_started: 0,
        started_points: 0,
        playoff_started_points: 0,
        championship_started_points: 0,
        franchises: new Set<string>(),
      });
    }

    const season = seasonMap.get(row.season_year)!;

    season.appearances += 1;
    season.franchises.add(row.franchise_name);

    if (row.is_starter) {
      gamesStarted += 1;
      startedPoints += row.points;

      season.games_started += 1;
      season.started_points += row.points;

      if (row.is_playoffs) {
        playoffStartedPoints += row.points;
        season.playoff_started_points += row.points;
      }

      if (row.is_championship) {
        championshipStartedPoints += row.points;
        season.championship_started_points += row.points;
      }
    }
  }

  const seasons = Array.from(seasonMap.values())
    .map((season) => ({
      season_year: season.season_year,
      appearances: season.appearances,
      games_started: season.games_started,
      started_points: season.started_points,
      playoff_started_points: season.playoff_started_points,
      championship_started_points: season.championship_started_points,
      franchises: Array.from(season.franchises).sort((a, b) =>
        a.localeCompare(b)
      ),
    }))
    .sort((a, b) => a.season_year - b.season_year);

  return {
    family: "player_career",
    notes: [
      "started_points only includes lineup entries where the player was marked as a starter",
      "playoff_started_points and championship_started_points are subsets of started_points",
    ],
    payload: {
      player: {
        player_id: player.player_id,
        player_name: player.player_name,
        primary_position: player.primary_position,
      },
      drafted: draftResult.rows[0] ?? null,
      all_time: {
        appearances,
        games_started: gamesStarted,
        started_points: startedPoints,
        playoff_started_points: playoffStartedPoints,
        championship_started_points: championshipStartedPoints,
        seasons_with_starts: seasons.filter((season) => season.games_started > 0)
          .length,
        franchises_played_for: Array.from(allTimeFranchises).sort((a, b) =>
          a.localeCompare(b)
        ),
      },
      seasons,
    },
  };
}

function buildPlayerCareerPrompt({
  input,
  data,
}: HistorianBuildPromptArgs<PlayerCareerPayload>): string {
  return [
    "You are answering a fantasy football league historian question.",
    "Only use the provided deterministic data.",
    "Do not invent facts.",
    "If the answer cannot be supported by the provided data, say that clearly.",
    "Keep the answer concise.",
    "",
    "Important data rules:",
    "- started_points only includes games where the player was actually marked as a starter.",
    "- playoff_started_points and championship_started_points are subsets of started_points.",
    "",
    `User question: ${input.question}`,
    "",
    "Deterministic historian data:",
    JSON.stringify(data),
  ].join("\n");
}

export const playerCareerHandler: HistorianHandler<PlayerCareerPayload> = {
  family: "player_career",
  async canHandle(input) {
    if (!looksLikePlayerCareerQuestion(input.question)) {
      return false;
    }

    const player = await resolvePlayerInQuestion(input.question);

    return Boolean(player);
  },
  getData: getPlayerCareerData,
  buildPrompt: buildPlayerCareerPrompt,
};
