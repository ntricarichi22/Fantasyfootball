// POST /api/pro-personnel/trade-studio/generate
//
// Thin door over the Studio offer engine. The Studio shows what OTHER teams
// would realistically offer for the assets we put on the block — a GM lens where
// the partner comes out ahead. All engine inputs load SERVER-SIDE here; the
// engine itself touches no database.
//
// Request contract is unchanged (team_id + shop_list_keys + optional
// anchor_partner_id; rosters are still accepted but ignored — the engine reads
// roster truth from shared). Response shape is frozen: { offers: StudioOffer[],
// totalCandidatesEvaluated, isFallback }.

import { NextResponse } from "next/server";
import { getLeagueData } from "@/shared/league-data";
import { buildValuationContext } from "@/shared/asset-values";
import { buildDepthData, generateStudioOffers } from "@/pro-personnel/engine/studio/offers";

export const dynamic = "force-dynamic";

// The roster UI (and /api/pro-personnel/targets) emit player keys prefixed
// "player:<sleeperId>", but the engine keys players by the raw Sleeper id and
// picks by "pick:<season>-<round>[-<slot>]-<origRid>". Normalize at the door.
function toEngineKey(key: string): string {
  return key.startsWith("player:") ? key.slice("player:".length) : key;
}

export async function POST(req: Request) {
  try {
    const body = await req.json();
    const teamId = String(body.team_id ?? "").trim();
    const shopKeys: string[] = (Array.isArray(body.shop_list_keys) ? body.shop_list_keys : []).map(toEngineKey);

    if (!teamId) return NextResponse.json({ error: "team_id required" }, { status: 400 });
    if (shopKeys.length === 0) {
      return NextResponse.json({ offers: [], totalCandidatesEvaluated: 0, isFallback: false });
    }

    const data = await getLeagueData();
    if ("error" in data) return NextResponse.json({ error: data.error }, { status: 500 });

    const ctx = await buildValuationContext();
    const depth = await buildDepthData(ctx.playerBase);

    const offers = generateStudioOffers({ ourTeamId: teamId, shopKeys, data, ctx, depth });

    return NextResponse.json({ offers, totalCandidatesEvaluated: offers.length, isFallback: false });
  } catch (err) {
    const message = err instanceof Error ? err.message : "Unknown error";
    return NextResponse.json({ error: message }, { status: 500 });
  }
}
