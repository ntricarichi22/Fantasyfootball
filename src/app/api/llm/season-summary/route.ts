import { NextRequest, NextResponse } from "next/server";
import { Pool } from "pg";

export const runtime = "nodejs";
export const dynamic = "force-dynamic";

declare global {
  // eslint-disable-next-line no-var
  var llmSeasonSummaryPool: Pool | undefined;
}

function getPool(connectionString: string) {
  if (!globalThis.llmSeasonSummaryPool) {
    globalThis.llmSeasonSummaryPool = new Pool({
      connectionString,
      max: 1,
    });
  }

  return globalThis.llmSeasonSummaryPool;
}

export async function GET(request: NextRequest) {
  const connectionString = process.env.LLM_DATABASE_URL;

  if (!connectionString) {
    return NextResponse.json(
      { ok: false, error: "Missing LLM_DATABASE_URL" },
      { status: 500 }
    );
  }

  const seasonYearParam = request.nextUrl.searchParams.get("seasonYear");

  if (!seasonYearParam) {
    return NextResponse.json(
      { ok: false, error: "Missing seasonYear" },
      { status: 400 }
    );
  }

  const seasonYear = Number(seasonYearParam);

  if (!Number.isInteger(seasonYear)) {
    return NextResponse.json(
      { ok: false, error: "Invalid seasonYear" },
      { status: 400 }
    );
  }

  try {
    const pool = getPool(connectionString);

    const seasonResult = await pool.query(
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
      [seasonYear]
    );

    if (seasonResult.rows.length === 0) {
      return NextResponse.json(
        { ok: false, error: "Season not found" },
        { status: 404 }
      );
    }

    const franchiseResult = await pool.query(
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
      [seasonYear]
    );

    return NextResponse.json({
      ok: true,
      intent: "season_summary",
      record_scope: {
        head_to_head: "weeks_1_13",
        points: "weeks_1_14",
      },
      season: seasonResult.rows[0],
      franchises: franchiseResult.rows,
    });
  } catch (error) {
    return NextResponse.json(
      {
        ok: false,
        error: error instanceof Error ? error.message : "Database query failed",
      },
      { status: 500 }
    );
  }
}
