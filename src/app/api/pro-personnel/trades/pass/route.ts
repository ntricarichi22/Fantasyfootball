// /api/pro-personnel/trades/pass
//
// Durable "I passed on this director-suggested deal" memory. PASS in the
// office offer drawer is, by itself, ephemeral React state (gone on reload);
// this persists it so the same EXACT package never gets re-surfaced.
//
// Scope (locked decision): EXACT deal only. The engine's offer id is already a
// deterministic fingerprint of the deal — `partnerId:sortedSendKeys>sortedReceiveKeys`
// (see engine/construct.ts) — so storing the id IS storing "that exact package,"
// and it survives slate regeneration. The extra columns (partner / send /
// receive keys) are recorded for a future broaden-the-scope pass; the read path
// here only needs the ids.
//
//   GET  ?team_id=X            → { offer_ids: string[] }  (hydrate the drawer)
//   POST { team_id, offer_id, partner_team_id?, send_keys?, receive_keys? }
//                              → upsert one pass (idempotent on the exact deal)
//
// This is the user's OWN pass memory — distinct from the partner accept/decline
// history that feeds empirical bands (that lives in trade_offers). A pass is
// not a league event; it never writes to trade_offers.

import { NextResponse } from "next/server";
import { getSupabaseAdminClient } from "@/infrastructure/supabase/admin";
import { LEAGUE_ID } from "@/infrastructure/config";

export const dynamic = "force-dynamic";

export async function GET(req: Request) {
  const { client, error } = getSupabaseAdminClient();
  if (!client) return NextResponse.json({ error }, { status: 500 });

  const teamId = new URL(req.url).searchParams.get("team_id")?.trim();
  if (!teamId) return NextResponse.json({ error: "team_id required" }, { status: 400 });

  const { data, error: qErr } = await client
    .from("cfc_trade_passes")
    .select("offer_id")
    .eq("league_id", LEAGUE_ID)
    .eq("user_team_id", teamId);
  if (qErr) return NextResponse.json({ error: qErr.message }, { status: 500 });

  return NextResponse.json({ offer_ids: (data ?? []).map((r) => r.offer_id) });
}

export async function POST(req: Request) {
  let body: {
    team_id?: string;
    offer_id?: string;
    partner_team_id?: string | null;
    send_keys?: string[];
    receive_keys?: string[];
  };
  try {
    body = await req.json();
  } catch {
    return NextResponse.json({ error: "Invalid JSON" }, { status: 400 });
  }
  const teamId = String(body.team_id ?? "").trim();
  const offerId = String(body.offer_id ?? "").trim();
  if (!teamId || !offerId) {
    return NextResponse.json({ error: "team_id and offer_id required" }, { status: 400 });
  }

  const { client, error } = getSupabaseAdminClient();
  if (!client) return NextResponse.json({ error }, { status: 500 });

  const { error: insErr } = await client
    .from("cfc_trade_passes")
    .upsert(
      {
        league_id: LEAGUE_ID,
        user_team_id: teamId,
        offer_id: offerId,
        partner_team_id: body.partner_team_id ?? null,
        send_keys: Array.isArray(body.send_keys) ? body.send_keys : null,
        receive_keys: Array.isArray(body.receive_keys) ? body.receive_keys : null,
      },
      { onConflict: "league_id,user_team_id,offer_id", ignoreDuplicates: true },
    );
  if (insErr) return NextResponse.json({ error: insErr.message }, { status: 500 });

  return NextResponse.json({ ok: true });
}
