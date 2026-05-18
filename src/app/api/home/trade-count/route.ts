import { NextRequest, NextResponse } from "next/server";
import { getSupabaseAdminClient } from "@/infrastructure/supabase/admin";

export async function GET(request: NextRequest) {
  try {
    const rosterId = request.cookies.get("cfc_roster_id")?.value;
    const leagueId = process.env.NEXT_PUBLIC_SLEEPER_LEAGUE_ID;

    if (!rosterId || !leagueId) {
      return NextResponse.json({ count: 0 });
    }

    const { client, error: clientError } = getSupabaseAdminClient();
    if (!client) {
      return NextResponse.json({ error: clientError }, { status: 500 });
    }

    const { count, error } = await client
      .from("trade_threads")
      .select("*", { count: "exact", head: true })
      .eq("league_id", leagueId)
      .eq("status", "open")
      .or(`team_a_id.eq.${rosterId},team_b_id.eq.${rosterId}`);

    if (error) {
      return NextResponse.json({ error: error.message }, { status: 500 });
    }

    return NextResponse.json({ count: count ?? 0 });
  } catch (error) {
    return NextResponse.json(
      { error: error instanceof Error ? error.message : "failed" },
      { status: 500 }
    );
  }
}
