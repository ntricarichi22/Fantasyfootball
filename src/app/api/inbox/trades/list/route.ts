import { NextRequest, NextResponse } from "next/server";
import { getSupabaseAdminClient } from "@/infrastructure/supabase/admin";
import { LEAGUE_ID } from "@/infrastructure/config";
import { currentAppSessionFromRequest } from "@/infrastructure/auth/currentSession";
import { buildValuationContext } from "@/shared/asset-values";
import { priceDeal } from "@/pro-personnel/engine/pricing";
import { personaAwareGrade } from "@/pro-personnel/engine/core/gap";
import { normalizePersona } from "@/pro-personnel/engine/core/personas";

export const dynamic = "force-dynamic";

export async function GET(request: NextRequest) {
  try {
  const teamId = request.nextUrl.searchParams.get("teamId")?.trim();
  const rawTab = request.nextUrl.searchParams.get("tab");
  const tab = rawTab === null ? "inbox" : rawTab.trim();
  const offerId = request.nextUrl.searchParams.get("offerId")?.trim();
  if (!offerId && tab !== "inbox" && tab !== "sent") {
    return NextResponse.json({ error: "invalid_tab" }, { status: 400 });
  }

  const league_id = LEAGUE_ID;
  if (!league_id) {
    return NextResponse.json({ error: "League ID not configured" }, { status: 500 });
  }
  const { session } = await currentAppSessionFromRequest(request);
  if (!session || session.leagueId !== league_id) return NextResponse.json({ error: "forbidden" }, { status: 403 });

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
      .or(`from_team_id.eq.${session.rosterId},to_team_id.eq.${session.rosterId}`)
      .maybeSingle();

    if (error || !data) return NextResponse.json({ error: "offer_unavailable" }, { status: 404 });
    const ctx = await buildValuationContext();
    const fromViewer = session.rosterId === data.from_team_id;
    const send = (fromViewer ? data.assets_from : data.assets_to) ?? [];
    const receive = (fromViewer ? data.assets_to : data.assets_from) ?? [];
    const priced = priceDeal({ ourTeamId: session.rosterId,
      partnerTeamId: fromViewer ? data.to_team_id : data.from_team_id,
      assets: [...send.map((a: { key: string; type?: string }) => ({ key: a.key.replace(/^player:/,""), name: a.key,
        type: a.type === "pick" || a.key.startsWith("pick:") ? "pick" as const : "player" as const, side: "send" as const })),
      ...receive.map((a: { key: string; type?: string }) => ({ key: a.key.replace(/^player:/,""), name: a.key,
        type: a.type === "pick" || a.key.startsWith("pick:") ? "pick" as const : "player" as const, side: "receive" as const }))], ctx });
    const strategy = await client.from("cfc_team_strategy_profiles").select("gm_persona")
      .eq("league_id",league_id).eq("team_id",session.rosterId).maybeSingle();
    const gap = { ...priced.ours, delta: priced.ours.receiveValue-priced.ours.sendValue,
      hasSend: send.length>0, hasReceive: receive.length>0 };
    return NextResponse.json({ data, live_grade: personaAwareGrade(gap, normalizePersona(strategy.data?.gm_persona)) });
  }

  if (!teamId) {
    return NextResponse.json({ error: "teamId is required" }, { status: 400 });
  }
  if (teamId !== session.rosterId) return NextResponse.json({ error: "forbidden" }, { status: 403 });

  // Every list query is explicitly participant-scoped. The validated tab only
  // controls which side/status is selected; it can never remove ownership.
  let query = client
    .from("trade_offers")
    .select("*")
    .eq("league_id", league_id)
    .order("created_at", { ascending: false });

  if (tab === "inbox") {
    query = query.eq("to_team_id", teamId).eq("status", "pending");
  } else {
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
