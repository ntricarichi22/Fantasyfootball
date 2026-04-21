import { NextResponse } from "next/server";
import { getSupabaseAdminClient, normalizeRosterId } from "../shared";

export const dynamic = "force-dynamic";

type ReleasePayload = {
  leagueId?: string;
  rosterId?: string | number;
  sessionId?: string;
};

export async function POST(request: Request) {
  let payload: ReleasePayload;
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

  const { error } = await client
    .from("active_teams")
    .delete()
    .eq("league_id", leagueId)
    .eq("roster_id", rosterId)
    .eq("session_id", sessionId);

  if (error) {
    return NextResponse.json({ error: error.message }, { status: 500 });
  }

  return NextResponse.json({ released: true });
}
