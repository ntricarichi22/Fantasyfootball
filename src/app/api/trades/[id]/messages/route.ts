import { NextRequest, NextResponse } from "next/server";
import { getSupabaseAdminClient } from "../../../../../lib/supabaseAdmin";
import { LEAGUE_ID } from "../../../../../lib/config";

export const dynamic = "force-dynamic";

export async function GET(
  _request: NextRequest,
  { params }: { params: Promise<{ id: string }> },
) {
  const { id: offerId } = await params;

  if (!offerId) {
    return NextResponse.json({ error: "Offer ID is required" }, { status: 400 });
  }

  const league_id = LEAGUE_ID;
  if (!league_id) {
    return NextResponse.json({ error: "League ID not configured" }, { status: 500 });
  }

  const { client, error: clientError } = getSupabaseAdminClient();
  if (!client) {
    return NextResponse.json({ error: clientError }, { status: 500 });
  }

  // Resolve thread_id from the offer so we query by canonical column only
  const { data: offerRow, error: offerError } = await client
    .from("trade_offers")
    .select("thread_id")
    .eq("id", offerId)
    .eq("league_id", league_id)
    .single();

  if (offerError) {
    return NextResponse.json(
      { error: offerError.message },
      { status: 500 },
    );
  }

  if (!offerRow?.thread_id) {
    return NextResponse.json({ data: [] });
  }

  const { data, error } = await client
    .from("trade_messages")
    .select("id, league_id, thread_id, from_team_id, message, created_at")
    .eq("thread_id", offerRow.thread_id)
    .eq("league_id", league_id)
    .order("created_at", { ascending: true });

  if (error) {
    return NextResponse.json({ error: error.message }, { status: 500 });
  }

  return NextResponse.json({ data: data ?? [] });
}

export async function POST(
  request: NextRequest,
  { params }: { params: Promise<{ id: string }> },
) {
  const { id: offerId } = await params;

  if (!offerId) {
    return NextResponse.json({ error: "Offer ID is required" }, { status: 400 });
  }

  let body: Record<string, unknown>;
  try {
    body = await request.json();
  } catch {
    return NextResponse.json({ error: "Invalid JSON body" }, { status: 400 });
  }

  const { from_team_id, message } = body as {
    from_team_id?: string;
    message?: string;
  };

  if (!from_team_id || !message?.trim()) {
    return NextResponse.json(
      { error: "from_team_id and message are required" },
      { status: 400 },
    );
  }

  const league_id = LEAGUE_ID;
  if (!league_id) {
    return NextResponse.json({ error: "League ID not configured" }, { status: 500 });
  }

  const { client, error: clientError } = getSupabaseAdminClient();
  if (!client) {
    return NextResponse.json({ error: clientError }, { status: 500 });
  }

  // Resolve thread_id from the offer so we insert with canonical columns only
  const { data: offerRow, error: offerError } = await client
    .from("trade_offers")
    .select("thread_id")
    .eq("id", offerId)
    .eq("league_id", league_id)
    .single();

  if (offerError || !offerRow?.thread_id) {
    return NextResponse.json(
      { error: offerError?.message ?? "Offer has no associated thread" },
      { status: 400 },
    );
  }

  const { data, error } = await client
    .from("trade_messages")
    .insert({
      league_id,
      thread_id: offerRow.thread_id,
      from_team_id,
      message: message.trim(),
    })
    .select("id, league_id, thread_id, from_team_id, message, created_at")
    .single();

  if (error) {
    return NextResponse.json({ error: error.message }, { status: 500 });
  }

  return NextResponse.json({ ok: true, data });
}
