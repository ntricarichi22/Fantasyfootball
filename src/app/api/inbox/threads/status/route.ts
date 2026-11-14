import { boundedJson } from "@/infrastructure/auth/boundedJson";
import { canonicalTradeAssets, offerTransition } from "@/shared/league-data/tradeAssets";
import { NextRequest, NextResponse } from "next/server";
import { getSupabaseAdminClient } from "@/infrastructure/supabase/admin";
import { LEAGUE_ID } from "@/infrastructure/config";
import { currentAppSessionFromRequest, currentSessionCanActForRoster } from "@/infrastructure/auth/currentSession";
import { invalidateLeagueData, getLeagueData } from "@/shared/league-data";

export const dynamic = "force-dynamic";

export async function POST(request: NextRequest) {
  const body = await boundedJson<Record<string, unknown>>(request, 16 * 1024);
  if (!body || typeof body !== "object" || Array.isArray(body)) {
    return NextResponse.json({ error: "Invalid JSON body" }, { status: 400 });
  }

  const { offer_id, team_id, status } = body as {
    offer_id?: string;
    team_id?: string;
    status?: string;
  };

  if (typeof offer_id !== "string" || typeof team_id !== "string" || typeof status !== "string" || !offer_id || !team_id) {
    return NextResponse.json(
      { error: "offer_id, team_id, and status are required" },
      { status: 400 },
    );
  }

  const transition = offerTransition(status);
  if (!transition) {
    return NextResponse.json(
      { error: `Invalid status transition: ${status}` },
      { status: 400 },
    );
  }

  const league_id = LEAGUE_ID;
  if (!league_id) {
    return NextResponse.json({ error: "League ID not configured" }, { status: 500 });
  }
  const { session } = await currentAppSessionFromRequest(request);
  if (!session) return NextResponse.json({ error: "not_authenticated" }, { status: 401 });
  if (!currentSessionCanActForRoster(session, league_id, team_id))
    return NextResponse.json({ error: "forbidden" }, { status: 403 });

  const { client, error: clientError } = getSupabaseAdminClient();
  if (!client) {
    return NextResponse.json({ error: clientError }, { status: 500 });
  }

  // Fetch the offer to validate permissions
  const { data: offer, error: fetchError } = await client
    .from("trade_offers")
    .select("from_team_id, to_team_id, status, thread_id, assets_from, assets_to")
    .eq("id", offer_id)
    .eq("league_id", league_id)
    .single();

  if (fetchError || !offer) {
    return NextResponse.json({ error: "Offer not found" }, { status: 404 });
  }

  if (!transition.allowed.includes(offer.status)) {
    return NextResponse.json(
      { error: `Cannot transition from '${offer.status}' to '${status}'` },
      { status: 400 },
    );
  }

  // Verify the team has the right role for this transition
  const teamField = transition.role === "sender" ? "from_team_id" : "to_team_id";
  if (offer[teamField] !== team_id) {
    return NextResponse.json({ error: "Not authorized for this action" }, { status: 403 });
  }

  const now = new Date().toISOString();

  // Stage the overlay before changing the offer. Readers require accepted_at,
  // so a failed status update cannot expose an unaccepted trade.
  if (status === "accepted") {
    invalidateLeagueData();
    const league = await getLeagueData();
    if ("error" in league) return NextResponse.json({ error: "League data unavailable" }, { status: 503 });
    if (!canonicalTradeAssets(offer.assets_from, offer.from_team_id, league) ||
        !canonicalTradeAssets(offer.assets_to, offer.to_team_id, league)) {
      return NextResponse.json({ error: "Asset ownership changed; rebuild the offer" }, { status: 409 });
    }
    const { error: overlayError } = await client.from("cfc_pending_trade_overlays").upsert({
      offer_id, league_id, from_team_id: offer.from_team_id, to_team_id: offer.to_team_id,
      assets_from: offer.assets_from, assets_to: offer.assets_to, accepted_at: null, reconciled_at: null,
    }, { onConflict: "offer_id", ignoreDuplicates: true });
    if (overlayError) return NextResponse.json({ error: "Failed to stage trade" }, { status: 500 });
  }

  // All resolutions are SOFT — the thread survives so the negotiation board
  // can show WITHDRAWN cards and the full version history stays browsable.
  //
  // read_at tracks whoever needs to see the offer's latest state. While
  // pending that's the recipient; once resolved it flips to the NON-ACTOR
  // (accept/decline → the sender; withdraw → the recipient), whose card
  // pulses until they open the thread — so clear it here.
  const { data: updated, error: updateError } = await client
    .from("trade_offers")
    .update({ status, updated_at: now, read_at: null })
    .eq("id", offer_id)
    .eq("league_id", league_id)
    .eq("status", "pending").select("id").maybeSingle();

  if (updateError) {
    return NextResponse.json({ error: "Failed to update offer" }, { status: 500 });
  }
  if (!updated) return NextResponse.json({ error: "Offer changed; reload and retry" }, { status: 409 });
  if (status === "accepted") {
    const { error: activateError } = await client.from("cfc_pending_trade_overlays")
      .update({ accepted_at: now }).eq("offer_id", offer_id).eq("league_id", league_id);
    if (activateError) return NextResponse.json({ error: "Failed to activate trade" }, { status: 500 });
    invalidateLeagueData();
  }

  // Propagate terminal statuses to the thread
  if (offer.thread_id) {
    await client
      .from("trade_threads")
      .update({ status, last_activity_at: now, updated_at: now })
      .eq("id", offer.thread_id)
      .eq("league_id", league_id);
  }

  return NextResponse.json({ ok: true, thread_id: offer.thread_id ?? null });
}
