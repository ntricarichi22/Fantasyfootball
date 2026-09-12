import { NextRequest, NextResponse } from "next/server";
import { getSupabaseAdminClient } from "@/infrastructure/supabase/admin";
import { LEAGUE_ID } from "@/infrastructure/config";
import { currentAppSessionFromRequest, currentSessionCanAccessTeamPair } from "@/infrastructure/auth/currentSession";

export const dynamic = "force-dynamic";

/* ------------------------------------------------------------------ */
/*  GET /api/inbox/threads/[threadId]                                 */
/*  Returns the thread metadata + all offers in chronological order.   */
/* ------------------------------------------------------------------ */

export async function GET(
  request: NextRequest,
  { params }: { params: Promise<{ threadId: string }> },
) {
  try {
  const { threadId } = await params;

  if (!threadId) {
    return NextResponse.json({ error: "Thread ID is required" }, { status: 400 });
  }

  const league_id = LEAGUE_ID;
  if (!league_id) {
    return NextResponse.json({ error: "League ID not configured" }, { status: 500 });
  }
  const { session } = await currentAppSessionFromRequest(request);
  if (!session) return NextResponse.json({ error: "not_authenticated" }, { status: 401 });

  const { client, error: clientError } = getSupabaseAdminClient();
  if (!client) {
    return NextResponse.json({ error: clientError }, { status: 500 });
  }

  const [threadRes, offersRes] = await Promise.all([
    client
      .from("trade_threads")
      .select("*")
      .eq("id", threadId)
      .eq("league_id", league_id)
      .single(),
    client
      .from("trade_offers")
      .select("*")
      .eq("thread_id", threadId)
      .eq("league_id", league_id)
      .order("created_at", { ascending: true }),
  ]);

  if (threadRes.error || !threadRes.data) {
    return NextResponse.json({ error: "Thread not found" }, { status: 404 });
  }
  if (!currentSessionCanAccessTeamPair(session, league_id, String(threadRes.data.team_a_id), String(threadRes.data.team_b_id))) {
    return NextResponse.json({ error: "forbidden" }, { status: 403 });
  }

  if (offersRes.error) {
    return NextResponse.json({ error: offersRes.error.message }, { status: 500 });
  }

  return NextResponse.json({
    thread: threadRes.data,
    offers: offersRes.data ?? [],
  });
  } catch (err) {
    console.error('[API GET /api/inbox/threads/:threadId]', err);
    return NextResponse.json(
      { error: 'Internal server error' },
      { status: 500 }
    );
  }
}
