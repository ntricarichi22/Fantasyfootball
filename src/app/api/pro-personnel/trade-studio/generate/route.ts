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
import { getLeagueData, getPlayoffHistory } from "@/shared/league-data";
import { buildValuationContext, valueAsset, type ValuationContext } from "@/shared/asset-values";
import { buildTeamProfiles, computeNeeds } from "@/shared/team-profiles";
import { buildTeamDossiers } from "@/shared/team-dossier";
import { buildTeamNarratives } from "@/shared/team-narratives";
import { runStudio, type EngineContext } from "@/pro-personnel/engine";
import { currentAppSessionFromRequest, currentSessionCanActForRoster } from "@/infrastructure/auth/currentSession";

export const dynamic = "force-dynamic";

// The roster UI (and /api/pro-personnel/targets) emit player keys prefixed
// "player:<sleeperId>", but the engine keys players by the raw Sleeper id and
// picks by "pick:<season>-<round>[-<slot>]-<origRid>". Normalize at the door.
function toEngineKey(key: string): string {
  return key.startsWith("player:") ? key.slice("player:".length) : key;
}

function valueAssetFor(key: string, type: "player" | "pick", ctx: ValuationContext, viewer: string) {
  return valueAsset(type === "pick" ? { type, key } : { type, sleeperPlayerId: key }, ctx, { perspective: viewer });
}

export async function POST(req: Request) {
  try {
    const body = await req.json();
    const teamId = String(body.team_id ?? "").trim();
    const shopKeys: string[] = (Array.isArray(body.shop_list_keys) ? body.shop_list_keys : []).map(toEngineKey);

    if (!teamId) return NextResponse.json({ error: "team_id required" }, { status: 400 });
    const { session } = await currentAppSessionFromRequest(req);
    if (!session) return NextResponse.json({ error: "not_authenticated" }, { status: 401 });
    if (shopKeys.length === 0) {
      return NextResponse.json({ offers: [], totalCandidatesEvaluated: 0, isFallback: false });
    }

    const data = await getLeagueData();
    if ("error" in data) return NextResponse.json({ error: data.error }, { status: 500 });
    if (!currentSessionCanActForRoster(session, data.leagueId, teamId)) return NextResponse.json({ error: "forbidden" }, { status: 403 });

    const profiles = buildTeamProfiles(data);
    const needs = computeNeeds(data);
    const dossiers = buildTeamDossiers(profiles, data);
    const playoffHistory = await getPlayoffHistory();
    const bundles = buildTeamNarratives(data, profiles, dossiers, needs, playoffHistory);

    const ctx = await buildValuationContext();
    const ec: EngineContext = { data, profiles, dossiers, needs, ctx, bundles };
    const slate = runStudio(ec, teamId, shopKeys, {
      counterpartyTeamIds: body.anchor_partner_id ? [String(body.anchor_partner_id)] : undefined,
    });
    const offers = slate.offers.map(offer => ({
      id: offer.id, partnerTeamId: offer.partnerTeamId, partnerTeamName: offer.partnerTeamName,
      persona: offer.partnerPersona,
      send: offer.assets.filter(asset => asset.side === "send").map(asset => ({ ...asset, value: valueAssetFor(asset.key, asset.type, ctx, teamId) })),
      receive: offer.assets.filter(asset => asset.side === "receive").map(asset => ({ ...asset, value: valueAssetFor(asset.key, asset.type, ctx, teamId) })),
      sendValue: offer.ourScoreboard.sendValue, receiveValue: offer.ourScoreboard.receiveValue,
      valueGap: { sendValue: offer.ourScoreboard.sendValue, receiveValue: offer.ourScoreboard.receiveValue,
        ratio: offer.ourScoreboard.ratio, delta: offer.ourScoreboard.receiveValue-offer.ourScoreboard.sendValue,
        verdict: offer.ourScoreboard.verdict, hasSend: true, hasReceive: true },
      gradeLabel: offer.grade.label, gradeColor: offer.grade.color,
    }));

    return NextResponse.json({ offers, totalCandidatesEvaluated: offers.length, isFallback: false });
  } catch (err) {
    const message = err instanceof Error ? err.message : "Unknown error";
    return NextResponse.json({ error: message }, { status: 500 });
  }
}
