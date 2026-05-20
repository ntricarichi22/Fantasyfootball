import { NextRequest, NextResponse } from "next/server";
import { getSupabaseAdminClient } from "@/infrastructure/supabase/admin";

const VALID_STATUSES = ["unread", "read", "archived", "trashed"] as const;
type MemoStatus = (typeof VALID_STATUSES)[number];

/**
 * GET /api/inbox/memos?teamId=X        -> list memos for the team
 * GET /api/inbox/memos?id=X            -> single memo detail (marks as read on first open)
 */
export async function GET(req: NextRequest) {
  const { client: supabase, error: clientError } = getSupabaseAdminClient();
  if (clientError || !supabase) {
    return NextResponse.json({ error: clientError ?? "Supabase unavailable" }, { status: 500 });
  }
  const url = new URL(req.url);
  const id = url.searchParams.get("id");
  const teamId = url.searchParams.get("teamId");
  const includeTrashed = url.searchParams.get("includeTrashed") === "1";
  const includeArchived = url.searchParams.get("includeArchived") === "1";

  // --- Single memo detail ---
  if (id) {
    const { data, error } = await supabase
      .from("cfc_director_memos")
      .select("*")
      .eq("id", id)
      .single();

    if (error || !data) {
      return NextResponse.json({ error: "Memo not found" }, { status: 404 });
    }

    // Mark as read on first open
    if (data.status === "unread") {
      await supabase
        .from("cfc_director_memos")
        .update({ status: "read", updated_at: new Date().toISOString() })
        .eq("id", id);
      data.status = "read";
    }

    return NextResponse.json({ memo: data });
  }

  // --- List ---
  if (!teamId) {
    return NextResponse.json({ error: "teamId required" }, { status: 400 });
  }

  let query = supabase
    .from("cfc_director_memos")
    .select("*")
    .eq("team_id", teamId)
    .order("created_at", { ascending: false });

  if (!includeTrashed) query = query.neq("status", "trashed");
  if (!includeArchived) query = query.neq("status", "archived");

  const { data, error } = await query;
  if (error) {
    return NextResponse.json({ error: error.message }, { status: 500 });
  }

  return NextResponse.json({ memos: data ?? [] });
}

/**
 * POST /api/inbox/memos
 * Body: { id?: string, ids?: string[], status: 'unread'|'read'|'archived'|'trashed' }
 * Updates one or many memos in a single call (for the multi-select action bar).
 */
export async function POST(req: NextRequest) {
  const { client: supabase, error: clientError } = getSupabaseAdminClient();
  if (clientError || !supabase) {
    return NextResponse.json({ error: clientError ?? "Supabase unavailable" }, { status: 500 });
  }
  let body: { id?: string; ids?: string[]; status?: string } = {};
  try {
    body = await req.json();
  } catch {
    return NextResponse.json({ error: "Invalid JSON body" }, { status: 400 });
  }

  const { id, ids, status } = body;

  if (!status || !VALID_STATUSES.includes(status as MemoStatus)) {
    return NextResponse.json({ error: "Invalid status" }, { status: 400 });
  }

  const targetIds = ids?.length ? ids : id ? [id] : [];
  if (targetIds.length === 0) {
    return NextResponse.json({ error: "id or ids required" }, { status: 400 });
  }

  const { error } = await supabase
    .from("cfc_director_memos")
    .update({ status, updated_at: new Date().toISOString() })
    .in("id", targetIds);

  if (error) {
    return NextResponse.json({ error: error.message }, { status: 500 });
  }

  return NextResponse.json({ ok: true, updated: targetIds.length });
}