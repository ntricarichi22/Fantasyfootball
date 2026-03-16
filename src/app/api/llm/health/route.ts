import { NextResponse } from "next/server";
import { Pool } from "pg";

export const runtime = "nodejs";
export const dynamic = "force-dynamic";

declare global {
  var llmHealthPool: Pool | undefined;
}

const getPool = (connectionString: string) => {
  if (!globalThis.llmHealthPool) {
    globalThis.llmHealthPool = new Pool({
      connectionString,
      max: 1,
    });
  }

  return globalThis.llmHealthPool;
};

export async function GET() {
  const connectionString = process.env.LLM_DATABASE_URL;

  if (!connectionString) {
    return NextResponse.json({ ok: false, error: "Missing LLM_DATABASE_URL" }, { status: 500 });
  }

  try {
    const pool = getPool(connectionString);
    const result = await pool.query<{ seasons_count: number }>(
      "select count(*)::int as seasons_count from llm.seasons;"
    );

    return NextResponse.json({ ok: true, seasons_count: result.rows[0]?.seasons_count ?? 0 });
  } catch (error) {
    return NextResponse.json(
      { ok: false, error: error instanceof Error ? error.message : "Database query failed" },
      { status: 500 }
    );
  }
}
