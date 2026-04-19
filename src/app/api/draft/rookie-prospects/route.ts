import { NextResponse } from "next/server";

import { normalizeProspectName } from "@/lib/draft/types";
import { getSupabaseAdminClient } from "@/lib/supabaseAdmin";

export const dynamic = "force-dynamic";

/**
 * Returns the curated rookie-prospect rows from Supabase keyed by the
 * normalized player name (lowercase a-z0-9). Keying by name (instead of
 * Sleeper `player_id`) lets the war room consume bootstrap rows that
 * carry placeholder ids like `tmp_*` before the NFL draft assigns real
 * Sleeper ids. The draft board uses these rows as a fallback for fields
 * Sleeper doesn't have on file (college, age, height_inches, weight)
 * plus the post-NFL-draft fields (nfl_team, nfl_draft_round,
 * nfl_draft_pick) that drive the Draft Capital grade.
 */
export async function GET() {
  const { client, error } = getSupabaseAdminClient();
  if (!client) {
    // Without Supabase, return an empty map so the UI degrades gracefully.
    return NextResponse.json({ data: {}, warning: error ?? "supabase unavailable" });
  }

  const { data, error: queryError } = await client
    .from("rookie_prospects")
    .select(
      "player_id,name,position,college,age,height_inches,weight,nfl_team,nfl_draft_round,nfl_draft_pick,avatar_url"
    );

  if (queryError) {
    return NextResponse.json({ error: queryError.message }, { status: 500 });
  }

  const result: Record<string, unknown> = {};
  (data ?? []).forEach((row) => {
    const key = normalizeProspectName(row?.name);
    if (key) result[key] = row;
  });

  return NextResponse.json({ data: result });
}
