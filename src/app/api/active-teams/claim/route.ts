import { NextResponse } from "next/server";
import { activeCutoffIso, getSupabaseAdminClient, presenceIdentity } from "../shared";

export const dynamic = "force-dynamic";

export async function POST(request: Request) {
  const identity = await presenceIdentity(request);
  if (!identity) return NextResponse.json({ error: "forbidden" }, { status: 403 });
  const { leagueId, rosterId, sessionId } = identity;

  const { client, error: clientError } = getSupabaseAdminClient();

  if (!client || clientError) {
    return NextResponse.json({ error: clientError ?? "Missing Supabase configuration" }, { status: 500 });
  }

  const { data: existing, error: readError } = await client
    .from("active_teams")
    .select("session_id, last_seen")
    .eq("league_id", leagueId)
    .eq("roster_id", rosterId)
    .maybeSingle();

  // PGRST116 indicates no rows were found for maybeSingle(); treat as no existing claim.
  if (readError && readError.code !== "PGRST116") {
    return NextResponse.json({ error: readError.message }, { status: 500 });
  }

  const cutoff = new Date(activeCutoffIso()).getTime();
  const lastSeenTime = existing?.last_seen ? new Date(existing.last_seen).getTime() : 0;
  const existingSession = existing?.session_id ?? "";
  const isActive = lastSeenTime >= cutoff;

  if (isActive && existingSession && existingSession !== sessionId) {
    return NextResponse.json({ error: "Team already claimed" }, { status: 409 });
  }

  const nowIso = new Date().toISOString();
  const { error } = await client
    .from("active_teams")
    .upsert(
      {
        league_id: leagueId,
        roster_id: rosterId,
        session_id: sessionId,
        claimed_at: nowIso,
        last_seen: nowIso,
      },
      { onConflict: "league_id,roster_id" }
    );

  if (error) {
    return NextResponse.json({ error: error.message }, { status: 500 });
  }

  return NextResponse.json({ ok: true, lastSeen: nowIso });
}
