import { NextRequest, NextResponse } from "next/server";
import { getSupabaseAdminClient } from "../../../../lib/supabaseAdmin";
import { LEAGUE_ID } from "../../../../lib/config";

export const dynamic = "force-dynamic";

export async function POST(request: NextRequest) {
  let body: Record<string, unknown>;
  try {
    body = await request.json();
  } catch {
    return NextResponse.json({ error: "Invalid JSON body" }, { status: 400 });
  }

  const {
    from_team_id,
    to_team_id,
    assets_from,
    assets_to,
    from_value,
    to_value,
    grade_label,
    parent_offer_id,
  } = body as {
    from_team_id?: string;
    to_team_id?: string;
    assets_from?: unknown[];
    assets_to?: unknown[];
    from_value?: number;
    to_value?: number;
    grade_label?: string;
    parent_offer_id?: string;
  };

  if (!from_team_id || !to_team_id) {
    return NextResponse.json(
      { error: "from_team_id and to_team_id are required" },
      { status: 400 },
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

  // If this is a counter, mark the original offer as countered
  if (parent_offer_id) {
    const { error: counterError } = await client
      .from("trade_offers")
      .update({ status: "countered", updated_at: new Date().toISOString() })
      .eq("id", parent_offer_id)
      .eq("league_id", league_id)
      .eq("status", "pending");

    if (counterError) {
      return NextResponse.json(
        { error: "Failed to update parent offer: " + counterError.message },
        { status: 500 },
      );
    }
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
      parent_offer_id: parent_offer_id || null,
      created_at: new Date().toISOString(),
      updated_at: new Date().toISOString(),
    })
    .select("id")
    .single();

  if (error) {
    return NextResponse.json({ error: error.message }, { status: 500 });
  }

  return NextResponse.json({ ok: true, id: data?.id });
}
