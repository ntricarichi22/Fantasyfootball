import { NextResponse } from "next/server";
import { getSupabaseAdminClient } from "@/lib/supabaseAdmin";

export const dynamic = "force-dynamic";

export async function GET() {
  try {
  const clientResult = getSupabaseAdminClient();

  if (!clientResult.client) {
    return NextResponse.json(
      { ok: false, error: clientResult.error },
      { status: 500 },
    );
  }

  const client = clientResult.client;

  const { data, error } = await client
    .from("v_player_values_definitive")
    .select("sleeper_id,value,updated_at")
    .limit(25);

  if (error) {
    return NextResponse.json(
      { ok: false, error: error.message },
      { status: 500 },
    );
  }

  const rows = data ?? [];

  return NextResponse.json({
    ok: true,
    count: rows.length,
    sample: rows,
  });
  } catch (err) {
    console.error('[API GET /api/definitive-player-values-smoke]', err);
    return NextResponse.json(
      { error: 'Internal server error' },
      { status: 500 }
    );
  }
}
