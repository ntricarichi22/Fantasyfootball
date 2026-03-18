import { getLlmPool } from "../llmDb";
import { resolveFranchisesInQuestion } from "../entityResolvers";
import { includesAnyTerm } from "../questionUtils";
import type {
  HistorianAskInput,
  HistorianBuildPromptArgs,
  HistorianDataEnvelope,
  HistorianHandler,
} from "../historianTypes";

type MatchupRow = {
  season_year: number;
  week: number;
  week_type: string | null;
  playoff_round: string | null;
  franchise_a_id: string;
  franchise_a_name: string;
  franchise_b_id: string;
  franchise_b_name: string;
  franchise_a_points: number;
  franchise_b_points: number;
  winner_franchise_id: string | null;
  winner_franchise_name: string | null;
  is_tie: boolean | null;
};

type SeasonRow = {
  season_year: number;
  championship_week: number;
};

export type MatchupHistoryPayload = {
  franchises: Array<{
    franchise_id: string;
    franchise_name: string;
  }>;
  summary: {
    total_meetings: number;
    overall_record: {
      franchise_one_wins: number;
      franchise_two_wins: number;
      ties: number;
    };
    regular_season_record: {
      franchise_one_wins: number;
      franchise_two_wins: number;
      ties: number;
    };
    playoff_record: {
      franchise_one_wins: number;
      franchise_two_wins: number;
      ties: number;
    };
    total_points: {
      franchise_one_points: number;
      franchise_two_points: number;
    };
    playoff_meetings: number;
    championship_meetings: number;
  };
  meetings: Array<{
    season_year: number;
    week: number;
    week_type: string | null;
    playoff_round: string | null;
    franchise_a_name: string;
    franchise_b_name: string;
    franchise_a_points: number;
    franchise_b_points: number;
    winner_franchise_name: string | null;
    margin: number;
  }>;
};

function looksLikeMatchupHistoryQuestion(question: string): boolean {
  return includesAnyTerm(question, [
    "against",
    "between",
    "head to head",
    "head-to-head",
    "matchup",
    "record vs",
    "versus",
    " vs ",
    "met",
    "meetings",
  ]);
}

async function getMatchupHistoryData(
  input: HistorianAskInput
): Promise<HistorianDataEnvelope<MatchupHistoryPayload>> {
  const franchises = await resolveFranchisesInQuestion(input.question);

  if (franchises.length < 2) {
    throw new Error("matchup_history requires two franchise names");
  }

  const franchiseOne = franchises[0];
  const franchiseTwo = franchises[1];
  const pool = getLlmPool();

  const [matchupsResult, seasonsResult] = await Promise.all([
    pool.query<MatchupRow>(`
      select
        season_year,
        week,
        week_type,
        playoff_round,
        franchise_a_id,
        franchise_a_name,
        franchise_b_id,
        franchise_b_name,
        franchise_a_points,
        franchise_b_points,
        winner_franchise_id,
        winner_franchise_name,
        is_tie
      from llm.matchups
      order by season_year asc, week asc;
    `),
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

  const relevantMeetings = matchupsResult.rows.filter((row) => {
    const directOrder =
      row.franchise_a_id === franchiseOne.franchise_id &&
      row.franchise_b_id === franchiseTwo.franchise_id;
    const reverseOrder =
      row.franchise_a_id === franchiseTwo.franchise_id &&
      row.franchise_b_id === franchiseOne.franchise_id;

    return directOrder || reverseOrder;
  });

  let overallOneWins = 0;
  let overallTwoWins = 0;
  let overallTies = 0;
  let regularOneWins = 0;
  let regularTwoWins = 0;
  let regularTies = 0;
  let playoffOneWins = 0;
  let playoffTwoWins = 0;
  let playoffTies = 0;
  let franchiseOnePoints = 0;
  let franchiseTwoPoints = 0;
  let playoffMeetings = 0;
  let championshipMeetings = 0;

  const meetings = relevantMeetings.map((row) => {
    const franchiseOneRowPoints =
      row.franchise_a_id === franchiseOne.franchise_id
        ? row.franchise_a_points
        : row.franchise_b_points;

    const franchiseTwoRowPoints =
      row.franchise_a_id === franchiseOne.franchise_id
        ? row.franchise_b_points
        : row.franchise_a_points;

    franchiseOnePoints += franchiseOneRowPoints;
    franchiseTwoPoints += franchiseTwoRowPoints;

    const isPlayoff = row.week_type === "playoffs";
    const isChampionship =
      championshipWeekBySeason.get(row.season_year) === row.week;

    if (isPlayoff) {
      playoffMeetings += 1;
    }

    if (isChampionship) {
      championshipMeetings += 1;
    }

    if (row.is_tie) {
      overallTies += 1;

      if (isPlayoff) {
        playoffTies += 1;
      } else {
        regularTies += 1;
      }
    } else if (row.winner_franchise_id === franchiseOne.franchise_id) {
      overallOneWins += 1;

      if (isPlayoff) {
        playoffOneWins += 1;
      } else {
        regularOneWins += 1;
      }
    } else if (row.winner_franchise_id === franchiseTwo.franchise_id) {
      overallTwoWins += 1;

      if (isPlayoff) {
        playoffTwoWins += 1;
      } else {
        regularTwoWins += 1;
      }
    }

    return {
      season_year: row.season_year,
      week: row.week,
      week_type: row.week_type,
      playoff_round: row.playoff_round,
      franchise_a_name: row.franchise_a_name,
      franchise_b_name: row.franchise_b_name,
      franchise_a_points: row.franchise_a_points,
      franchise_b_points: row.franchise_b_points,
      winner_franchise_name: row.winner_franchise_name,
      margin: Math.abs(row.franchise_a_points - row.franchise_b_points),
    };
  });

  return {
    family: "matchup_history",
    notes: [
      "overall, regular-season, and playoff records are separated explicitly",
      "championship meetings are identified using each season's championship week",
    ],
    payload: {
      franchises: [
        {
          franchise_id: franchiseOne.franchise_id,
          franchise_name: franchiseOne.franchise_name,
        },
        {
          franchise_id: franchiseTwo.franchise_id,
          franchise_name: franchiseTwo.franchise_name,
        },
      ],
      summary: {
        total_meetings: meetings.length,
        overall_record: {
          franchise_one_wins: overallOneWins,
          franchise_two_wins: overallTwoWins,
          ties: overallTies,
        },
        regular_season_record: {
          franchise_one_wins: regularOneWins,
          franchise_two_wins: regularTwoWins,
          ties: regularTies,
        },
        playoff_record: {
          franchise_one_wins: playoffOneWins,
          franchise_two_wins: playoffTwoWins,
          ties: playoffTies,
        },
        total_points: {
          franchise_one_points: franchiseOnePoints,
          franchise_two_points: franchiseTwoPoints,
        },
        playoff_meetings: playoffMeetings,
        championship_meetings: championshipMeetings,
      },
      meetings,
    },
  };
}

function buildMatchupHistoryPrompt({
  input,
  data,
}: HistorianBuildPromptArgs<MatchupHistoryPayload>): string {
  return [
    "You are answering a fantasy football league historian question.",
    "Only use the provided deterministic data.",
    "Do not invent facts.",
    "If the answer cannot be supported by the provided data, say that clearly.",
    "Keep the answer concise.",
    "",
    "Important data rules:",
    "- overall, regular-season, and playoff records are provided separately.",
    "- championship meetings are identified separately from the broader playoff record.",
    "",
    `User question: ${input.question}`,
    "",
    "Deterministic historian data:",
    JSON.stringify(data),
  ].join("\n");
}

export const matchupHistoryHandler: HistorianHandler<MatchupHistoryPayload> = {
  family: "matchup_history",
  async canHandle(input) {
    if (!looksLikeMatchupHistoryQuestion(input.question)) {
      return false;
    }

    const matches = await resolveFranchisesInQuestion(input.question);

    return matches.length >= 2;
  },
  getData: getMatchupHistoryData,
  buildPrompt: buildMatchupHistoryPrompt,
};