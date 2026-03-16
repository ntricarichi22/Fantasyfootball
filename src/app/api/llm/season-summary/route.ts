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
        select
          franchise_id,
          franchise_name,
          display_team_name,
          owner_display_name,
          conference,
          division,
          seed,
          final_rank,
          wins,
          losses,
          ties,
          points_for,
          points_against,
          potential_points,
          made_playoffs,
          made_conference_final,
          made_championship,
          won_title
        from llm.franchise_seasons
        where season_year = $1
        order by
          won_title desc,
          final_rank asc nulls last,
          points_for desc,
          franchise_name asc;
      `,
      [seasonYear]
    );

    return NextResponse.json({
      ok: true,
      intent: "season_summary",
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
