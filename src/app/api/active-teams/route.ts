import { NextRequest, NextResponse } from "next/server";
import { activeCutoffIso, getSupabaseAdminClient } from "./shared";

export const dynamic = "force-dynamic";

export async function GET(request: NextRequest) {
  const leagueId = request.nextUrl.searchParams.get("leagueId")?.trim();

  if (!leagueId) {
    return NextResponse.json({ error: "leagueId is required" }, { status: 400 });
  }

  const { client, error: clientError } = getSupabaseAdminClient();

  if (!client || clientError) {
    return NextResponse.json({ error: clientError ?? "Missing Supabase configuration" }, { status: 500 });
  }

  const cutoff = activeCutoffIso();

  const { data, error } = await client
    .from("active_teams")
    .select("roster_id, session_id, last_seen")
    .eq("league_id", leagueId)
    .gte("last_seen", cutoff);

  if (error) {
    return NextResponse.json({ error: error.message }, { status: 500 });
  }

  const rows = (data ?? [])
    .map((row) => ({
      rosterId: row.roster_id != null ? String(row.roster_id) : "",
      sessionId: row.session_id ?? "",
      lastSeen: row.last_seen ?? null,
    }))
    .filter((row) => row.rosterId);

  return NextResponse.json({ data: rows });
}
