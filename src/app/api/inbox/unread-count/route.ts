import { NextRequest, NextResponse } from "next/server";
import { getSupabaseAdminClient } from "@/infrastructure/supabase/admin";
import { LEAGUE_ID } from "@/infrastructure/config";

export const dynamic = "force-dynamic";

export async function GET(request: NextRequest) {
  try {
  const teamId = request.nextUrl.searchParams.get("teamId")?.trim();

  if (!teamId) {
    return NextResponse.json({ error: "teamId is required" }, { status: 400 });
  }

  const league_id = LEAGUE_ID;
  if (!league_id) {
    return NextResponse.json({ error: "League ID not configured" }, { status: 500 });
  }

  const { client, error: clientError } = getSupabaseAdminClient();
  if (!client) {
    return NextResponse.json({ error: clientError }, { status: 500 });
  }

  // One inbox, one number: unopened inbound pending offers, unacknowledged
  // verdicts on offers you sent (closure rows, freshness-capped to match the
  // inbox), and unread director mail (offer_card memos are retired — an offer
  // is a DM from the other team).
  const closureSince = new Date(Date.now() - 7 * 24 * 60 * 60 * 1000).toISOString();
  const [offersRes, closureRes, withdrawnRes, memosRes] = await Promise.all([
    client
      .from("trade_offers")
      .select("id", { count: "exact", head: true })
      .eq("league_id", league_id)
      .eq("to_team_id", teamId)
      .eq("status", "pending")
      .is("read_at", null),
    client
      .from("trade_offers")
      .select("id", { count: "exact", head: true })
      .eq("league_id", league_id)
      .eq("from_team_id", teamId)
      .in("status", ["accepted", "declined"])
      .is("read_at", null)
      .gte("updated_at", closureSince),
    client
      .from("trade_offers")
      .select("id", { count: "exact", head: true })
      .eq("league_id", league_id)
      .eq("to_team_id", teamId)
      .eq("status", "withdrawn")
      .is("read_at", null)
      .gte("updated_at", closureSince),
    client
      .from("cfc_director_memos")
      .select("id", { count: "exact", head: true })
      .eq("team_id", teamId)
      .eq("status", "unread")
      .neq("play_mode", "offer_card"),
  ]);

  if (offersRes.error) {
    return NextResponse.json({ error: offersRes.error.message }, { status: 500 });
  }
  if (closureRes.error) {
    return NextResponse.json({ error: closureRes.error.message }, { status: 500 });
  }
  if (withdrawnRes.error) {
    return NextResponse.json({ error: withdrawnRes.error.message }, { status: 500 });
  }
  if (memosRes.error) {
    return NextResponse.json({ error: memosRes.error.message }, { status: 500 });
  }

  return NextResponse.json({
    count:
      (offersRes.count ?? 0) +
      (closureRes.count ?? 0) +
      (withdrawnRes.count ?? 0) +
      (memosRes.count ?? 0),
  });
  } catch (err) {
    console.error('[API GET /api/inbox/unread-count]', err);
    return NextResponse.json(
      { error: 'Internal server error' },
      { status: 500 }
    );
  }
}
