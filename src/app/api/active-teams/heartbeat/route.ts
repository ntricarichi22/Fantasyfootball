import { NextResponse } from "next/server";
import { getSupabaseAdminClient } from "../shared";

export const dynamic = "force-dynamic";

type HeartbeatPayload = {
  leagueId?: string;
  rosterId?: string | number;
  sessionId?: string;
};

const normalizeRosterId = (value: string | number | null | undefined) =>
  value !== undefined && value !== null ? String(value) : "";

export async function POST(request: Request) {
  let payload: HeartbeatPayload;
  try {
    payload = await request.json();
  } catch {
    return NextResponse.json({ error: "Invalid JSON body" }, { status: 400 });
  }

  const leagueId = payload.leagueId?.trim() ?? "";
  const rosterId = normalizeRosterId(payload.rosterId);
  const sessionId = payload.sessionId?.trim() ?? "";

  if (!leagueId || !rosterId || !sessionId) {
    return NextResponse.json({ error: "leagueId, rosterId, and sessionId are required" }, { status: 400 });
  }

  const { client, error: clientError } = getSupabaseAdminClient();

  if (!client || clientError) {
    return NextResponse.json({ error: clientError ?? "Missing Supabase configuration" }, { status: 500 });
  }

  const { data: existing, error: readError } = await client
    .from("active_teams")
    .select("session_id")
    .eq("league_id", leagueId)
    .eq("roster_id", rosterId)
    .maybeSingle();

  // PGRST116 indicates no rows were found for maybeSingle(); treat as missing claim.
  if (readError && readError.code !== "PGRST116") {
    return NextResponse.json({ error: readError.message }, { status: 500 });
  }

  if (!existing?.session_id) {
    return NextResponse.json({ error: "Team not claimed" }, { status: 404 });
  }

  if (existing.session_id !== sessionId) {
    return NextResponse.json({ error: "Session mismatch" }, { status: 409 });
  }

  const nowIso = new Date().toISOString();
  const { error } = await client
    .from("active_teams")
    .update({ last_seen: nowIso })
    .eq("league_id", leagueId)
    .eq("roster_id", rosterId)
    .eq("session_id", sessionId);

  if (error) {
    return NextResponse.json({ error: error.message }, { status: 500 });
  }

  return NextResponse.json({ ok: true, lastSeen: nowIso });
}
