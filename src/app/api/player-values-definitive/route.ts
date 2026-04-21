import { NextResponse } from "next/server";
import { getSupabaseAdminClient } from "@/lib/supabaseAdmin";

export const dynamic = "force-dynamic";

const buildPlayerValueMapBySleeperId = (
  rows: Array<{ sleeper_id: string | null; value: number | null }>,
) => {
  return rows.reduce<Record<string, number>>((acc, row) => {
    if (row.sleeper_id && typeof row.value === "number") {
      acc[row.sleeper_id] = row.value;
    }
    return acc;
  }, {});
};

const findLatestUpdatedAt = (rows: Array<{ updated_at?: string | null }>) => {
  let latest: string | null = null;
  let latestTime = -Infinity;

  rows.forEach((row) => {
    if (typeof row.updated_at !== "string") return;
    const timestamp = new Date(row.updated_at).getTime();
    if (Number.isNaN(timestamp)) return;
    if (timestamp > latestTime) {
      latest = row.updated_at;
      latestTime = timestamp;
    }
  });

  return latest;
};

export async function GET() {
  try {
  const clientResult = getSupabaseAdminClient();

  if (!clientResult.client) {
    return NextResponse.json({ error: clientResult.error }, { status: 500 });
  }

  const client = clientResult.client;

  const { data, error } = await client
    .from("v_player_values_definitive")
    .select("sleeper_id,value,updated_at")
    .limit(25);

  if (error) {
    return NextResponse.json({ error: error.message }, { status: 500 });
  }

  const rows = data ?? [];

  return NextResponse.json({
    ok: true,
    count: rows.length,
    data: buildPlayerValueMapBySleeperId(rows),
    meta: { lastUpdated: findLatestUpdatedAt(rows) },
  });
  } catch (err) {
    console.error('[API GET /api/player-values-definitive]', err);
    return NextResponse.json(
      { error: 'Internal server error' },
      { status: 500 }
    );
  }
}
