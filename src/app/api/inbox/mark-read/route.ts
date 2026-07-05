import { NextRequest, NextResponse } from "next/server";
import { getSupabaseAdminClient } from "@/infrastructure/supabase/admin";
import { LEAGUE_ID } from "@/infrastructure/config";

export const dynamic = "force-dynamic";

export async function POST(request: NextRequest) {
  let body: Record<string, unknown>;
  try {
    body = await request.json();
  } catch {
    return NextResponse.json({ error: "Invalid JSON body" }, { status: 400 });
  }

  const { offer_id, team_id } = body as { offer_id?: string; team_id?: string };

  if (!offer_id || !team_id) {
    return NextResponse.json(
      { error: "offer_id and team_id are required" },
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

  // Who may stamp read_at depends on the offer's state: while pending it's
  // the recipient reading the offer; once resolved it's the NON-ACTOR
  // acknowledging the outcome — accept/decline are answered by the recipient
  // so the SENDER acks, withdraw is pulled by the sender so the RECIPIENT acks.
  const { data: offer, error: fetchError } = await client
    .from("trade_offers")
    .select("from_team_id, to_team_id, status, read_at")
    .eq("id", offer_id)
    .eq("league_id", league_id)
    .single();

  if (fetchError || !offer) {
    return NextResponse.json({ error: "Offer not found" }, { status: 404 });
  }

  const isPendingRecipient = offer.status === "pending" && offer.to_team_id === team_id;
  const isClosureRecipient =
    ((offer.status === "accepted" || offer.status === "declined") &&
      offer.from_team_id === team_id) ||
    (offer.status === "withdrawn" && offer.to_team_id === team_id);

  if ((!isPendingRecipient && !isClosureRecipient) || offer.read_at) {
    return NextResponse.json({ ok: true, updated: false });
  }

  const { error } = await client
    .from("trade_offers")
    .update({ read_at: new Date().toISOString() })
    .eq("id", offer_id)
    .eq("league_id", league_id)
    .is("read_at", null);

  if (error) {
    return NextResponse.json({ error: error.message }, { status: 500 });
  }

  return NextResponse.json({ ok: true, updated: true });
}
