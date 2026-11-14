import { NextResponse } from "next/server";
import { getSupabaseAdminClient, presenceIdentity } from "../shared";

export const dynamic = "force-dynamic";

export async function POST(request: Request) {
  const identity = await presenceIdentity(request);
  if (!identity) return NextResponse.json({ error: "forbidden" }, { status: 403 });
  const { leagueId, rosterId, sessionId } = identity;

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
