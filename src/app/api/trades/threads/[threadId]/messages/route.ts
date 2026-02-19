import { NextRequest, NextResponse } from "next/server";
import { getSupabaseAdminClient } from "../../../../../../lib/supabaseAdmin";
import { LEAGUE_ID } from "../../../../../../lib/config";

export const dynamic = "force-dynamic";

/* ------------------------------------------------------------------ */
/*  GET /api/trades/threads/[threadId]/messages                        */
/* ------------------------------------------------------------------ */

export async function GET(
  _request: NextRequest,
  { params }: { params: Promise<{ threadId: string }> },
) {
  const { threadId } = await params;

  const league_id = LEAGUE_ID;
  if (!league_id) {
    return NextResponse.json({ error: "League ID not configured" }, { status: 500 });
  }

  const { client, error: clientError } = getSupabaseAdminClient();
  if (!client) {
    return NextResponse.json({ error: clientError }, { status: 500 });
  }

  const { data, error } = await client
    .from("trade_messages")
    .select("*")
    .eq("thread_id", threadId)
    .eq("league_id", league_id)
    .order("created_at", { ascending: true });

  if (error) {
    return NextResponse.json({ error: error.message }, { status: 500 });
  }

  return NextResponse.json({ data: data ?? [] });
}

/* ------------------------------------------------------------------ */
/*  POST /api/trades/threads/[threadId]/messages                       */
/* ------------------------------------------------------------------ */

export async function POST(
  request: NextRequest,
  { params }: { params: Promise<{ threadId: string }> },
) {
  const { threadId } = await params;

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

  const { data, error } = await client
    .from("trade_messages")
    .insert({
      league_id,
      thread_id: threadId,
      from_team_id,
      message: message.trim(),
    })
    .select("*")
    .single();

  if (error) {
    return NextResponse.json({ error: error.message }, { status: 500 });
  }

  // Update thread last_message_at + last_activity_at
  const now = new Date().toISOString();
  await client
    .from("trade_threads")
    .update({ last_message_at: now, last_activity_at: now, updated_at: now })
    .eq("id", threadId)
    .eq("league_id", league_id);

  return NextResponse.json({ ok: true, data });
}
