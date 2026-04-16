import { NextResponse } from "next/server";
import { Pool } from "pg";

export const runtime = "nodejs";
export const dynamic = "force-dynamic";

declare global {
  var llmHealthPool: Pool | undefined;
}

function getPool(connectionString: string): Pool {
  if (!globalThis.llmHealthPool) {
    globalThis.llmHealthPool = new Pool({
      connectionString,
      max: 1,
    });
    globalThis.llmHealthPool.on("connect", (client) => {
      client.query("SET search_path TO public;");
    });
  }
  return globalThis.llmHealthPool;
}

export async function GET() {
  const dbUrl = process.env.LLM_DATABASE_URL;
  const anthropicKey = process.env.ANTHROPIC_API_KEY;

  if (!dbUrl) {
    return NextResponse.json(
      { ok: false, error: "Missing LLM_DATABASE_URL" },
      { status: 500 }
    );
  }

  try {
    const pool = getPool(dbUrl);

    const [seasonsResult, franchisesResult, playerGamesResult] = await Promise.all([
      pool.query<{ count: number }>("select count(*)::int as count from llm_seasons;"),
      pool.query<{ count: number }>("select count(*)::int as count from llm_franchises;"),
      pool.query<{ count: number }>("select count(*)::int as count from llm_player_games;"),
    ]);

    return NextResponse.json({
      ok: true,
      database: "connected",
      anthropic_key_configured: Boolean(anthropicKey),
      table_counts: {
        llm_seasons: seasonsResult.rows[0]?.count ?? 0,
        llm_franchises: franchisesResult.rows[0]?.count ?? 0,
        llm_player_games: playerGamesResult.rows[0]?.count ?? 0,
      },
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
