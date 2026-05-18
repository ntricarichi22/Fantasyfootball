import { NextRequest, NextResponse } from "next/server";
import { getSupabaseAdminClient } from "@/infrastructure/supabase/admin";
import { LEAGUE_ID } from "@/infrastructure/config";

export const dynamic = "force-dynamic";

export async function GET(request: NextRequest) {
  try {
  const teamId = request.nextUrl.searchParams.get("teamId")?.trim();
  const tab = request.nextUrl.searchParams.get("tab")?.trim() || "inbox";
  const offerId = request.nextUrl.searchParams.get("offerId")?.trim();

  const league_id = LEAGUE_ID;
  if (!league_id) {
    return NextResponse.json({ error: "League ID not configured" }, { status: 500 });
  }

  const { client, error: clientError } = getSupabaseAdminClient();
  if (!client) {
    return NextResponse.json({ error: clientError }, { status: 500 });
  }

  // Single offer fetch
  if (offerId) {
    const { data, error } = await client
      .from("trade_offers")
      .select("*")
      .eq("id", offerId)
      .eq("league_id", league_id)
      .single();

    if (error) {
      return NextResponse.json({ error: error.message }, { status: 500 });
    }

    return NextResponse.json({ data });
  }

  if (!teamId) {
    return NextResponse.json({ error: "teamId is required" }, { status: 400 });
  }

  // List offers based on tab
  let query = client
    .from("trade_offers")
    .select("*")
    .eq("league_id", league_id)
    .order("created_at", { ascending: false });

  if (tab === "inbox") {
    query = query.eq("to_team_id", teamId).eq("status", "pending");
  } else if (tab === "sent") {
    query = query.eq("from_team_id", teamId);
  }

  const { data, error } = await query;

  if (error) {
    return NextResponse.json({ error: error.message }, { status: 500 });
  }

  return NextResponse.json({ data: data ?? [] });
  } catch (err) {
    console.error('[API GET /api/inbox/trades/list]', err);
    return NextResponse.json(
      { error: 'Internal server error' },
      { status: 500 }
    );
  }
}
