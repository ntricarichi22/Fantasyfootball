import { NextRequest, NextResponse } from "next/server";
import { getSupabaseAdminClient } from "../../../../lib/supabaseAdmin";
import { LEAGUE_ID } from "../../../../lib/config";

export const dynamic = "force-dynamic";

const ALLOWED_TRANSITIONS: Record<string, { allowed: string[]; role: "sender" | "receiver" }> = {
  accepted: { allowed: ["pending"], role: "receiver" },
  declined: { allowed: ["pending"], role: "receiver" },
  withdrawn: { allowed: ["pending"], role: "sender" },
};

export async function POST(request: NextRequest) {
  let body: Record<string, unknown>;
  try {
    body = await request.json();
  } catch {
    return NextResponse.json({ error: "Invalid JSON body" }, { status: 400 });
  }

  const { offer_id, team_id, status } = body as {
    offer_id?: string;
    team_id?: string;
    status?: string;
  };

  if (!offer_id || !team_id || !status) {
    return NextResponse.json(
      { error: "offer_id, team_id, and status are required" },
      { status: 400 },
    );
  }

  const transition = ALLOWED_TRANSITIONS[status];
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

  const { client, error: clientError } = getSupabaseAdminClient();
  if (!client) {
    return NextResponse.json({ error: clientError }, { status: 500 });
  }

  // Fetch the offer to validate permissions
  const { data: offer, error: fetchError } = await client
    .from("trade_offers")
    .select("from_team_id, to_team_id, status")
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

  const { error: updateError } = await client
    .from("trade_offers")
    .update({ status, updated_at: new Date().toISOString() })
    .eq("id", offer_id)
    .eq("league_id", league_id);

  if (updateError) {
    return NextResponse.json({ error: updateError.message }, { status: 500 });
  }

  return NextResponse.json({ ok: true });
}
