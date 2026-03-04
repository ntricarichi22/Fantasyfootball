import { NextResponse } from "next/server";
import { getSupabaseAdminClient } from "@/lib/supabaseAdmin";
import { buildValueMap, backfillMissingRosteredPlayers } from "@/lib/rosterBackfill";

export const dynamic = "force-dynamic";
export const runtime = "nodejs";

export async function GET() {
  const { client, error: clientError } = getSupabaseAdminClient();

  if (!client) {
    return NextResponse.json({ error: clientError }, { status: 500 });
  }

  const { data, error } = await client
    .from("cfc_trade_values_current")
    .select("sleeper_player_id, asset_key, cfc_value");

  if (error) {
    return NextResponse.json({ error: error.message }, { status: 500 });
  }

  // Build the initial value map from what is already in Supabase.
  let valueMap = buildValueMap(data ?? []);

  // Detect any currently-rostered players that are missing from the map and
  // backfill them server-side before returning.  On the happy path (all
  // rostered players already have values) the only overhead is one small
  // Sleeper rosters API call; the heavy external fetches are skipped entirely.
  try {
    valueMap = await backfillMissingRosteredPlayers(client, valueMap);
  } catch (err) {
    // Non-fatal: return whatever we have rather than failing the whole request.
    console.warn(
      "[player-values] roster backfill error (continuing with existing values):",
      err instanceof Error ? err.message : err,
    );
  }

  const response: Record<string, unknown> = {
    data: valueMap,
    meta:
      process.env.NODE_ENV === "development"
        ? { source: "cfc_trade_values_current" }
        : {},
  };

  return NextResponse.json(response);
}

