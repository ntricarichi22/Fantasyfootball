import { getLlmPool } from "@/lib/llm/llmDb";
import { getSeasonRules } from "@/lib/llm/seasonRules";
import { includesAnyTerm } from "@/lib/llm/questionUtils";
import type {
  HistorianAskInput,
  HistorianBuildPromptArgs,
  HistorianDataEnvelope,
  HistorianHandler,
} from "@/lib/llm/historianTypes";

export type SeasonSnapshotSeason = {
  season_id: string;
  season_year: number;
  league_name: string;
  regular_season_weeks: number;
  playoff_start_week: number;
  championship_week: number;
  platforms_present: string[] | null;
};

export type SeasonSnapshotFranchiseRow = {
  franchise_id: string;
  franchise_name: string;
  display_team_name: string;
  wins: number;
  losses: number;
  ties: number;
  points_for: number;
  points_against: number;
};

type ChampionshipMatchupRow = {
  week: number;
  franchise_a_name: string;
  franchise_b_name: string;
  franchise_a_points: number;
  franchise_b_points: number;
  winner_franchise_name: string | null;
};

type PlayoffTeamRow = {
  franchise_name: string;
};

export type SeasonSnapshotPayload = {
  record_scope: {
    start_week: number;
    end_week: number;
  };
  points_scope: {
    start_week: number;
    end_week: number;
  };
  season: SeasonSnapshotSeason;
  playoff_summary: {
    playoff_teams: string[];
    championship_matchup: {
      week: number;
      franchise_a_name: string;
      franchise_b_name: string;
      franchise_a_points: number;
      franchise_b_points: number;
      winner_franchise_name: string | null;
    } | null;
    title_winner_franchise_name: string | null;
  };
  franchises: SeasonSnapshotFranchiseRow[];
};

function looksLikeSeasonSnapshotQuestion(question: string): boolean {
  return includesAnyTerm(question, [
    "best record",
    "worst record",
    "most points",
    "least points",
    "standings",
    "made the playoffs",
    "playoff teams",
    "won the title",
    "champion",
    "championship winner",
    "points for",
    "points against",
  ]);
}

export async function getSeasonSnapshotData(
  input: HistorianAskInput
): Promise<HistorianDataEnvelope<SeasonSnapshotPayload>> {
  if (!input.seasonYear || !Number.isInteger(input.seasonYear)) {
    throw new Error("season_snapshot requires a valid seasonYear");
  }

  const rules = getSeasonRules(input.seasonYear);
  const pool = getLlmPool();

  const seasonResult = await pool.query<SeasonSnapshotSeason>(
    `
      select
        season_id,
        season_year,
        league_name,
        regular_season_weeks,
        playoff_start_week,
        championship_week,
        platforms_present
      from llm.seasons
      where season_year = $1
      limit 1;
    `,
    [input.seasonYear]
  );

  if (seasonResult.rows.length === 0) {
    throw new Error("Season not found");
  }

  const season = seasonResult.rows[0];

  const [franchiseResult, playoffTeamsResult, championshipResult] =
    await Promise.all([
      pool.query<SeasonSnapshotFranchiseRow>(
        `
          with h2h as (
            select
              tg.franchise_id,
              coalesce(sum(case when upper(coalesce(tg.result, '')) in ('W', 'WIN') then 1 else 0 end), 0)::int as wins,
              coalesce(sum(case when upper(coalesce(tg.result, '')) in ('L', 'LOSS') then 1 else 0 end), 0)::int as losses,
              coalesce(sum(case when upper(coalesce(tg.result, '')) in ('T', 'TIE') then 1 else 0 end), 0)::int as ties
            from llm.team_games tg
            where tg.season_year = $1
              and coalesce(tg.week_type, '') = 'regular_season'
              and tg.week between $2 and $3
            group by tg.franchise_id
          ),
          points as (
            select
              tg.franchise_id,
              coalesce(sum(coalesce(tg.points_for, 0)), 0)::float8 as points_for,
              coalesce(sum(coalesce(tg.points_against, 0)), 0)::float8 as points_against
            from llm.team_games tg
            where tg.season_year = $1
              and coalesce(tg.week_type, '') = 'regular_season'
              and tg.week between $4 and $5
            group by tg.franchise_id
          )
          select
            fs.franchise_id,
            fs.franchise_name,
            fs.display_team_name,
            coalesce(h2h.wins, 0) as wins,
            coalesce(h2h.losses, 0) as losses,
            coalesce(h2h.ties, 0) as ties,
            coalesce(points.points_for, 0)::float8 as points_for,
            coalesce(points.points_against, 0)::float8 as points_against
          from llm.franchise_seasons fs
          left join h2h
            on h2h.franchise_id = fs.franchise_id
          left join points
            on points.franchise_id = fs.franchise_id
          where fs.season_year = $1
          order by
            coalesce(h2h.wins, 0) desc,
            coalesce(h2h.ties, 0) desc,
            coalesce(points.points_for, 0) desc,
            fs.franchise_name asc;
        `,
        [
          input.seasonYear,
          rules.recordWindow.startWeek,
          rules.recordWindow.endWeek,
          rules.pointsWindow.startWeek,
          rules.pointsWindow.endWeek,
        ]
      ),
      pool.query<PlayoffTeamRow>(
        `
          select distinct
            franchise_name
          from llm.team_games
          where season_year = $1
            and is_playoffs = true
          order by franchise_name asc;
        `,
        [input.seasonYear]
      ),
      pool.query<ChampionshipMatchupRow>(
        `
          select
            week,
            franchise_a_name,
            franchise_b_name,
            franchise_a_points,
            franchise_b_points,
            winner_franchise_name
          from llm.matchups
          where season_year = $1
            and week = $2
          order by week desc
          limit 1;
        `,
        [input.seasonYear, season.championship_week]
      ),
    ]);

  const championshipMatchup = championshipResult.rows[0] ?? null;

  return {
    family: "season_snapshot",
    notes: [
      `wins/losses/ties are head-to-head results for weeks ${rules.recordWindow.startWeek}-${rules.recordWindow.endWeek}`,
      `points_for and points_against are regular-season totals for weeks ${rules.pointsWindow.startWeek}-${rules.pointsWindow.endWeek}`,
      "playoff_summary contains playoff teams plus the championship matchup only",
    ],
    payload: {
      record_scope: {
        start_week: rules.recordWindow.startWeek,
        end_week: rules.recordWindow.endWeek,
      },
      points_scope: {
        start_week: rules.pointsWindow.startWeek,
        end_week: rules.pointsWindow.endWeek,
      },
      season,
      playoff_summary: {
        playoff_teams: playoffTeamsResult.rows.map((row) => row.franchise_name),
        championship_matchup: championshipMatchup,
        title_winner_franchise_name:
          championshipMatchup?.winner_franchise_name ?? null,
      },
      franchises: franchiseResult.rows,
    },
  };
}

function buildSeasonSnapshotPrompt({
  input,
  data,
}: HistorianBuildPromptArgs<SeasonSnapshotPayload>): string {
  return [
    "You are answering a fantasy football league historian question.",
    "Only use the provided deterministic data.",
    "Do not invent facts.",
    "If the answer cannot be supported by the provided data, say that clearly.",
    "Keep the answer concise.",
    "",
    "Important data rules:",
    `- wins/losses/ties are head-to-head regular season record for weeks ${data.payload.record_scope.start_week}-${data.payload.record_scope.end_week}.`,
    `- points_for and points_against are regular season totals for weeks ${data.payload.points_scope.start_week}-${data.payload.points_scope.end_week}.`,
    "- playoff_summary only contains playoff teams plus the championship matchup.",
    "- If the user asks about 'best record', interpret that as wins/losses/ties unless they explicitly ask about points.",
    "- Do not describe a full playoff bracket unless the data explicitly contains it.",
    "",
    `User question: ${input.question}`,
    "",
    "Deterministic historian data:",
    JSON.stringify(data),
  ].join("\n");
}

export const seasonSnapshotHandler: HistorianHandler<SeasonSnapshotPayload> = {
  family: "season_snapshot",
  canHandle(input) {
    return Boolean(
      input.seasonYear &&
        Number.isInteger(input.seasonYear) &&
        looksLikeSeasonSnapshotQuestion(input.question)
    );
  },
  getData: getSeasonSnapshotData,
  buildPrompt: buildSeasonSnapshotPrompt,
};
