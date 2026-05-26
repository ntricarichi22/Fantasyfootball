// POST /api/pro-personnel/trade-studio/generate
//
// Trade Studio generation — now on the unified engine. Request contract is
// unchanged (team_id + shop_list_keys + optional anchor_partner_id; rosters are
// still accepted but ignored, since the engine reads roster truth from shared).
// All engine inputs load SERVER-SIDE here; the engine touches no database.
//
// Response shape is frozen: { offers: StudioOffer[], totalCandidatesEvaluated,
// isFallback }, where StudioOffer = { id, partnerTeamId, partnerTeamName,
// persona, send, receive, sendValue, receiveValue, valueGap, gradeLabel,
// gradeColor }. The chip is always OUR view (ourScoreboard); the partner side
// lives in the advisor prose.

import { NextResponse } from "next/server";
import { getLeagueData, type LeagueData } from "@/shared/league-data";
import { buildTeamProfiles, computeNeeds } from "@/shared/team-profiles";
import { buildTeamDossiers } from "@/shared/team-dossier";
import {
  buildValuationContext,
  valueAsset,
  type AssetRef,
  type ValuationContext,
} from "@/shared/asset-values";
import { runStudio, type EngineContext } from "@/pro-personnel/engine";

export const dynamic = "force-dynamic";

// Per-asset display value on OUR scoreboard: our assets at our perspective,
// their assets at neutral base — consistent with the offer's sendValue/
// receiveValue totals.
function assetValue(
  key: string,
  type: "player" | "pick",
  side: "send" | "receive",
  ourTeamId: string,
  ctx: ValuationContext,
): number {
  const ref: AssetRef = type === "pick" ? { type: "pick", key } : { type: "player", sleeperPlayerId: key };
  return side === "send" ? valueAsset(ref, ctx, { perspective: ourTeamId }) : valueAsset(ref, ctx);
}

function positionOf(key: string, data: LeagueData): string | undefined {
  return data.players.get(key)?.position;
}

export async function POST(req: Request) {
  try {
    const body = await req.json();
    const teamId = String(body.team_id ?? "").trim();
    const shopKeys: string[] = Array.isArray(body.shop_list_keys) ? body.shop_list_keys : [];
    const anchorPartnerId = body.anchor_partner_id ? String(body.anchor_partner_id) : undefined;

    if (!teamId) return NextResponse.json({ error: "team_id required" }, { status: 400 });
    if (shopKeys.length === 0) {
      return NextResponse.json({ offers: [], totalCandidatesEvaluated: 0, isFallback: false });
    }

    const data = await getLeagueData();
    if ("error" in data) return NextResponse.json({ error: data.error }, { status: 500 });

    const profiles = buildTeamProfiles(data);
    const needs = computeNeeds(data);
    const dossiers = buildTeamDossiers(profiles, data);
    const ctx = await buildValuationContext();

    const ec: EngineContext = { data, profiles, dossiers, needs, ctx };
    const slate = runStudio(ec, teamId, shopKeys, {
      counterpartyTeamIds: anchorPartnerId ? [anchorPartnerId] : undefined,
    });

    const offers = slate.offers.map((o) => {
      const send = o.assets
        .filter((a) => a.side === "send")
        .map((a) => ({
          key: a.key,
          name: a.name,
          type: a.type,
          position: positionOf(a.key, data),
          value: assetValue(a.key, a.type, "send", teamId, ctx),
        }));
      const receive = o.assets
        .filter((a) => a.side === "receive")
        .map((a) => ({
          key: a.key,
          name: a.name,
          type: a.type,
          position: positionOf(a.key, data),
          value: assetValue(a.key, a.type, "receive", teamId, ctx),
        }));
      const sb = o.ourScoreboard;
      return {
        id: o.id,
        partnerTeamId: o.partnerTeamId,
        partnerTeamName: o.partnerTeamName,
        persona: o.partnerPersona,
        send,
        receive,
        sendValue: sb.sendValue,
        receiveValue: sb.receiveValue,
        valueGap: {
          sendValue: sb.sendValue,
          receiveValue: sb.receiveValue,
          ratio: sb.ratio,
          delta: sb.receiveValue - sb.sendValue,
          verdict: sb.verdict,
          hasSend: sb.sendValue > 0,
          hasReceive: sb.receiveValue > 0,
        },
        gradeLabel: o.grade.label,
        gradeColor: o.grade.color,
      };
    });

    return NextResponse.json({ offers, totalCandidatesEvaluated: offers.length, isFallback: false });
  } catch (err) {
    const message = err instanceof Error ? err.message : "Unknown error";
    return NextResponse.json({ error: message }, { status: 500 });
  }
}