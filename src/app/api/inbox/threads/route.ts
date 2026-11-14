import { normalizeTradeOffer } from "@/shared/trade-offers/normalize";
import { NextRequest, NextResponse } from "next/server";
import { getSupabaseAdminClient } from "@/infrastructure/supabase/admin";
import { currentAppSessionFromRequest } from "@/infrastructure/auth/currentSession";

export const dynamic = "force-dynamic";

/* ------------------------------------------------------------------ */
/*  GET /api/inbox/threads?teamId=X                                  */
/*  Returns all threads where the team is team_a or team_b, ordered   */
/*  by most recent activity.                                           */
/*                                                                     */
/*  ?include=latest additionally attaches, per thread:                 */
/*    latest_offer   — the most recent trade_offers row                */
/*    latest_message — the most recent trade_messages row              */
/*  so the inbox list renders from a single request.                   */
/* ------------------------------------------------------------------ */

export async function GET(request: NextRequest) {
  const { session } = await currentAppSessionFromRequest(request);
  if (!session) return NextResponse.json({ error: "not_authenticated" }, { status: 401 });

  const teamId = request.nextUrl.searchParams.get("teamId")?.trim();
  const includeLatest = request.nextUrl.searchParams.get("include") === "latest";

  if (!teamId) {
    return NextResponse.json({ error: "teamId is required" }, { status: 400 });
  }

  const league_id = session.leagueId;

  if (session.leagueId !== league_id || session.rosterId !== teamId)
    return NextResponse.json({ error: "forbidden" }, { status: 403 });

  const { client, error: clientError } = getSupabaseAdminClient();
  if (!client) {
    return NextResponse.json({ error: clientError }, { status: 500 });
  }

  const { data, error } = await client
    .from("trade_threads")
    .select("*")
    .eq("league_id", league_id)
    .or(`team_a_id.eq.${teamId},team_b_id.eq.${teamId}`)
    .order("last_activity_at", { ascending: false });

  if (error) {
    return NextResponse.json({ error: error.message }, { status: 500 });
  }

  const threads = data ?? [];
  if (!includeLatest || threads.length === 0) {
    return NextResponse.json({ data: threads });
  }

  const threadIds = threads.map((t) => t.id);
  const [offersRes, messagesRes] = await Promise.all([
    client
      .from("trade_offers")
      .select("*")
      .eq("league_id", league_id)
      .in("thread_id", threadIds)
      .order("created_at", { ascending: false }),
    client
      .from("trade_messages")
      .select("*")
      .eq("league_id", league_id)
      .in("thread_id", threadIds)
      .order("created_at", { ascending: false }),
  ]);

  if (offersRes.error) {
    return NextResponse.json({ error: offersRes.error.message }, { status: 500 });
  }
  if (messagesRes.error) {
    return NextResponse.json({ error: messagesRes.error.message }, { status: 500 });
  }

  // Rows arrive newest-first, so the first row seen per thread is the latest.
  // The full per-thread history rides along (oldest-first) — the negotiation
  // card's version chips flip through every revision of the deal.
  const latestOffer = new Map<string, unknown>();
  const offerHistory = new Map<string, unknown[]>();
  for (const o of (offersRes.data ?? []).map(normalizeTradeOffer)) {
    if (!latestOffer.has(o.thread_id)) latestOffer.set(o.thread_id, o);
    const hist = offerHistory.get(o.thread_id) ?? [];
    hist.unshift(o);
    offerHistory.set(o.thread_id, hist);
  }
  const latestMessage = new Map<string, unknown>();
  for (const m of messagesRes.data ?? []) {
    if (!latestMessage.has(m.thread_id)) latestMessage.set(m.thread_id, m);
  }

  return NextResponse.json({
    data: threads.map((t) => ({
      ...t,
      latest_offer: latestOffer.get(t.id) ?? null,
      latest_message: latestMessage.get(t.id) ?? null,
      offers: offerHistory.get(t.id) ?? [],
      offer_count: (offerHistory.get(t.id) ?? []).length,
    })),
  });
}
