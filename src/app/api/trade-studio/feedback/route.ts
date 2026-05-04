// POST /api/trade-studio/feedback
//
// Body:
//   {
//     team_id: string,
//     partner_team_id: string,
//     persona: string,
//     shop_list: string[],     // asset keys on the block
//     offer_payload: object,   // full offer object that was passed
//     works_for_you: number,
//     works_for_them: number,
//   }
//
// Returns: { ok: true } or { error }

import { NextResponse } from "next/server";
import { createClient } from "@supabase/supabase-js";
import { isValidPersona } from "../../../../lib/trade/studio/persona";
import { getLeagueId } from "../../../../lib/config";

export const dynamic = "force-dynamic";

const SUPABASE_URL = process.env.NEXT_PUBLIC_SUPABASE_URL!;
const SUPABASE_KEY = process.env.SUPABASE_SERVICE_ROLE_KEY!;

function admin() {
  return createClient(SUPABASE_URL, SUPABASE_KEY, { auth: { persistSession: false } });
}

export async function POST(req: Request) {
  try {
    const body = await req.json();
    const teamId = String(body.team_id ?? "").trim();
    const partnerTeamId = String(body.partner_team_id ?? "").trim();
    const persona = String(body.persona ?? "").trim();
    const shopList = Array.isArray(body.shop_list) ? body.shop_list : [];
    const offerPayload = body.offer_payload ?? {};
    const worksForYou = typeof body.works_for_you === "number" ? body.works_for_you : null;
    const worksForThem = typeof body.works_for_them === "number" ? body.works_for_them : null;

    if (!teamId) return NextResponse.json({ error: "team_id required" }, { status: 400 });
    if (!partnerTeamId) return NextResponse.json({ error: "partner_team_id required" }, { status: 400 });
    if (!isValidPersona(persona)) return NextResponse.json({ error: "invalid persona" }, { status: 400 });

    const supabase = admin();
    const { error } = await supabase.from("cfc_studio_offer_feedback").insert({
      league_id: getLeagueId(),
      team_id: teamId,
      partner_team_id: partnerTeamId,
      persona,
      shop_list: shopList,
      offer_payload: offerPayload,
      works_for_you: worksForYou,
      works_for_them: worksForThem,
    });

    if (error) {
      return NextResponse.json({ error: error.message }, { status: 500 });
    }
    return NextResponse.json({ ok: true });
  } catch (err) {
    const message = err instanceof Error ? err.message : "Unknown error";
    return NextResponse.json({ error: message }, { status: 500 });
  }
}
