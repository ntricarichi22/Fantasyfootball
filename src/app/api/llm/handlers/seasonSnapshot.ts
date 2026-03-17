import { getLlmPool } from "../llmDb";
import type {
  HistorianAskInput,
  HistorianBuildPromptArgs,
  HistorianDataEnvelope,
  HistorianHandler,
} from "../historianTypes";

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
  potential_points: number;
};

export type SeasonSnapshotPayload = {
  record_scope: {
    head_to_head: "weeks_1_13";
    points: "weeks_1_14";
  };
  season: SeasonSnapshotSeason;
  franchises: SeasonSnapshotFranchiseRow[];
};

function normalizeQuestion(value: string): string {
  return value.trim().toLowerCase();
}

function looksLikeSeasonSnapshotQuestion(question: string): boolean {
  const q = normalizeQuestion(question);

  return [
    "record",
    "best record",
    "worst record",
    "most points",
    "least points",
    "season",
    "standings",
    "playoffs",
    "won the title",
    "champion",
    "championship",
    "points for",
    "points against",
  ].some((term) => q.includes(term));
}

async function getSeasonSnapshotData(
  input: HistorianAskInput
): Promise<HistorianDataEnvelope<SeasonSnapshotPayload>> {
  if (!input.seasonYear || !Number.isInteger(input.seasonYear)) {
    throw new Error("season_snapshot requires a valid seasonYear");
  }

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

  const franchiseResult = await pool.query<SeasonSnapshotFranchiseRow>(
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
          and tg.week between 1 and 13
        group by tg.franchise_id
      ),
      points as (
        select
          tg.franchise_id,
          coalesce(sum(coalesce(tg.points_for, 0)), 0)::float8 as points_for,
          coalesce(sum(coalesce(tg.points_against, 0)), 0)::float8 as points_against,
          coalesce(sum(coalesce(tg.optimal_points, 0)), 0)::float8 as potential_points
        from llm.team_games tg
        where tg.season_year = $1
          and coalesce(tg.week_type, '') = 'regular_season'
          and tg.week between 1 and 14
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
        coalesce(points.points_against, 0)::float8 as points_against,
        coalesce(points.potential_points, 0)::float8 as potential_points
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
    [input.seasonYear]
  );

  return {
    family: "season_snapshot",
    notes: [
      "wins/losses/ties are head-to-head results for weeks 1-13",
      "points_for, points_against, and potential_points are regular-season totals for weeks 1-14",
    ],
    payload: {
      record_scope: {
        head_to_head: "weeks_1_13",
        points: "weeks_1_14",
      },
      season: seasonResult.rows[0],
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
    "- wins/losses/ties are head-to-head regular season record for weeks 1-13.",
    "- points_for, points_against, and potential_points are regular season totals for weeks 1-14.",
    "- If the user asks about 'best record', interpret that as wins/losses/ties unless they explicitly ask about points.",
    "- Do not describe any result as including playoffs unless the data explicitly says so.",
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
