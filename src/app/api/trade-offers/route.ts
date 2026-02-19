import { NextRequest, NextResponse } from "next/server";
import { getSupabaseClient } from "../../../lib/supabaseClient";

export const dynamic = "force-dynamic";

interface TradeOfferPayload {
  league_id: string;
  from_team_id: string;
  to_team_id: string;
  assets_from: unknown[];
  assets_to: unknown[];
  from_value: number;
  to_value: number;
  grade_label: string;
}

export async function POST(request: NextRequest) {
  let payload: TradeOfferPayload;
  try {
    payload = await request.json();
  } catch {
    return NextResponse.json({ error: "Invalid JSON body" }, { status: 400 });
  }

  const {
    league_id,
    from_team_id,
    to_team_id,
    assets_from,
    assets_to,
    from_value,
    to_value,
    grade_label,
  } = payload;

  if (!league_id || !from_team_id || !to_team_id) {
    return NextResponse.json(
      { error: "league_id, from_team_id, and to_team_id are required" },
      { status: 400 }
    );
  }

  if (
    !Array.isArray(assets_from) ||
    !Array.isArray(assets_to) ||
    assets_from.length === 0 ||
    assets_to.length === 0
  ) {
    return NextResponse.json(
      { error: "Both assets_from and assets_to must be non-empty arrays" },
      { status: 400 }
    );
  }

  const client = getSupabaseClient();
  if (!client) {
    return NextResponse.json({ error: "Missing Supabase configuration" }, { status: 500 });
  }

  const { data, error } = await client
    .from("trade_offers")
    .insert({
      league_id,
      from_team_id,
      to_team_id,
      assets_from,
      assets_to,
      from_value: typeof from_value === "number" ? from_value : 0,
      to_value: typeof to_value === "number" ? to_value : 0,
      grade_label: typeof grade_label === "string" ? grade_label : "",
      status: "pending",
      created_at: new Date().toISOString(),
    })
    .select("id")
    .single();

  if (error) {
    return NextResponse.json({ error: error.message }, { status: 500 });
  }

  return NextResponse.json({ ok: true, id: data?.id });
}

export async function GET(request: NextRequest) {
  const leagueId = request.nextUrl.searchParams.get("league_id")?.trim();
  const toTeamId = request.nextUrl.searchParams.get("to_team_id")?.trim();

  if (!leagueId) {
    return NextResponse.json({ error: "league_id is required" }, { status: 400 });
  }

  const client = getSupabaseClient();
  if (!client) {
    return NextResponse.json({ error: "Missing Supabase configuration" }, { status: 500 });
  }

  let query = client
    .from("trade_offers")
    .select("*")
    .eq("league_id", leagueId)
    .eq("status", "pending")
    .order("created_at", { ascending: false });

  if (toTeamId) {
    query = query.eq("to_team_id", toTeamId);
  }

  const { data, error } = await query;

  if (error) {
    return NextResponse.json({ error: error.message }, { status: 500 });
  }

  return NextResponse.json({ data: data ?? [] });
}
