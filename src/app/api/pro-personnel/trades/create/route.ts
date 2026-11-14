import { tradeAssetKeys } from "@/shared/trade-offers/normalize";
import { boundedJson } from "@/infrastructure/auth/boundedJson";
import { commandEnvelope, executeLeagueCommand } from "@/infrastructure/auth/leagueCommand";
import { isCfcLeague } from "@/shared/league-data/capabilities";
import { NextRequest, NextResponse } from "next/server";
import { getSupabaseAdminClient } from "@/infrastructure/supabase/admin";
import { isYoung, buildValuationContext, valueAsset, type AssetRef } from "@/shared/asset-values";
import { getPlayerDictionary, getValues, parsePickKey } from "@/shared/league-data";
import { priceDeal } from "@/pro-personnel/engine/pricing";
import { personaAwareGrade } from "@/pro-personnel/engine/core/gap";
import { normalizePersona } from "@/pro-personnel/engine/core/personas";
import type { Gap } from "@/pro-personnel/engine/core/types";
import type { EngineOfferAsset } from "@/pro-personnel/engine/types";
import { currentAppSessionFromRequest, currentSessionCanActForRoster } from "@/infrastructure/auth/currentSession";

export const dynamic = "force-dynamic";

// Threading model (v2):
//
//   ONE thread per deal proposal. A deal = the original offer + any
//   counter-offers chained via parent_offer_id. Two separate proposals
//   between the same teams = two separate threads = two separate cards
//   in the inbox.
//
//   Resolution:
//     - parent_offer_id present  → use parent offer's thread_id
//                                  (counter stays in the same chain)
//     - parent_offer_id absent   → always create a new thread
//
//   The previous behavior — find-or-create one open thread per team-pair —
//   is gone. No find-existing-by-pair query. The body's `thread_id` field
//   (if any caller still passes it) is ignored; thread is fully derived
//   from parent_offer_id.
//
//   Existing multi-offer threads in the DB remain as legacy data and
//   continue to read/write correctly through the other routes.

type IncomingAsset = { key: string; label?: string; type?: string; value?: number };
type AssetSummary = { studs: number; youth: number; picks_1st: number; picks_2nd: number; picks_3rd: number; depth: number };

type PlayerInfo = { value: number; isStud: boolean; isYouth: boolean };

async function lookupBaseValues(leagueId: string, assets: IncomingAsset[]): Promise<{
  playerMap: Record<string, PlayerInfo>;
  pickValueMap: Record<string, number>;
}> {
  const playerMap: Record<string, PlayerInfo> = {};
  const pickValueMap: Record<string, number> = {};
  const [ctx, dict, values] = await Promise.all([buildValuationContext(leagueId), getPlayerDictionary(), getValues(leagueId)]);
  for (const asset of assets) {
    if (asset.key.startsWith("player:")) {
      const id = asset.key.slice(7); const info = dict.get(id);
      playerMap[id] = { value: valueAsset({ type: "player", sleeperPlayerId: id }, ctx),
        isStud: values.isStud.get(id) ?? false,
        isYouth: info ? isYoung(info.position, info.age, info.exp) : false };
    } else if (asset.key.startsWith("pick:")) {
      pickValueMap[asset.key] = valueAsset({ type: "pick", key: asset.key }, ctx);
    }
  }

  return { playerMap, pickValueMap };
}

function summarizeAssets(assets: IncomingAsset[], playerMap: Record<string, PlayerInfo>, pickValueMap: Record<string, number>): { totalValue: number; summary: AssetSummary } {
  let totalValue = 0;
  const summary: AssetSummary = { studs: 0, youth: 0, picks_1st: 0, picks_2nd: 0, picks_3rd: 0, depth: 0 };

  for (const a of assets) {
    if (a.key.startsWith("player:")) {
      const id = a.key.replace("player:", "");
      const info = playerMap[id];
      if (!info) continue;
      totalValue += info.value;
      if (info.isStud) summary.studs++;
      else if (info.isYouth) summary.youth++;
      else summary.depth++;
    } else if (a.key.startsWith("pick:")) {
      const parsed = parsePickKey(a.key);
      if (!parsed) continue;
      totalValue += pickValueMap[a.key] ?? 0;
      if (parsed.round === 1) summary.picks_1st++;
      else if (parsed.round === 2) summary.picks_2nd++;
      else if (parsed.round === 3) summary.picks_3rd++;
    }
  }

  return { totalValue, summary };
}

export async function POST(request: NextRequest) {
  const { session } = await currentAppSessionFromRequest(request);
  if (!session) return NextResponse.json({ error: "not_authenticated" }, { status: 401 });
  const body = await boundedJson<Record<string, unknown>>(request, 64 * 1024);
  if (!body || typeof body !== "object" || Array.isArray(body)) return NextResponse.json({ error: "invalid_json" }, { status: 400 });
  const envelope = commandEnvelope(body);
  const from = typeof body.from_team_id === "string" ? body.from_team_id : "";
  const to = typeof body.to_team_id === "string" ? body.to_team_id : "";
  if (!envelope || !from || !to || from === to || (body.parent_offer_id !== undefined && body.parent_offer_id !== null && typeof body.parent_offer_id !== "string")) {
    return NextResponse.json({ error: "invalid_trade_command" }, { status: 400 });
  }
  if (!currentSessionCanActForRoster(session, session.leagueId, from)) return NextResponse.json({ error: "forbidden" }, { status: 403 });
  const fromKeys = tradeAssetKeys(body.assets_from);
  const toKeys = tradeAssetKeys(body.assets_to);
  if (!fromKeys || !toKeys || fromKeys.some((key) => toKeys.includes(key))) return NextResponse.json({ error: "invalid_trade_assets" }, { status: 400 });
  const dictionary = [...fromKeys, ...toKeys].some((key) => key.startsWith("player:")) ? await getPlayerDictionary() : new Map();
  const canonical = (keys: string[]): IncomingAsset[] => keys.map((key) => {
    const pick = key.startsWith("pick:") ? parsePickKey(key) : null;
    return { key, type: pick ? "pick" : "player", label: pick ? `${pick.season} Rd ${pick.round}` : dictionary.get(key.slice(7))?.name ?? key.slice(7) };
  });
  const assetsFrom = canonical(fromKeys);
  const assetsTo = canonical(toKeys);
  const payload: Record<string, unknown> = {
    from_team_id: from, to_team_id: to, assets_from: assetsFrom, assets_to: assetsTo,
    parent_offer_id: body.parent_offer_id ?? null, from_value: null, to_value: null,
    from_base_value: null, to_base_value: null, grade_label: "Not rated", asset_summary: null,
  };
  if (isCfcLeague(session.leagueId)) {
    const { client } = getSupabaseAdminClient();
    if (!client) return NextResponse.json({ error: "valuation_unavailable" }, { status: 503 });
    const [ctx, base, strategy] = await Promise.all([
      buildValuationContext(session.leagueId), lookupBaseValues(session.leagueId, [...assetsFrom, ...assetsTo]),
      client.from("cfc_team_strategy_profiles").select("gm_persona").eq("league_id", session.leagueId).eq("team_id", from).maybeSingle(),
    ]);
    if (strategy.error) return NextResponse.json({ error: "valuation_unavailable" }, { status: 503 });
    const fromSummary = summarizeAssets(assetsFrom, base.playerMap, base.pickValueMap);
    const toSummary = summarizeAssets(assetsTo, base.playerMap, base.pickValueMap);
    const engineAsset = (asset: IncomingAsset, side: "send" | "receive"): EngineOfferAsset => ({
      key: asset.key.startsWith("player:") ? asset.key.slice(7) : asset.key,
      name: asset.label ?? asset.key, type: asset.key.startsWith("pick:") ? "pick" : "player", side,
    });
    const { ours } = priceDeal({ ourTeamId: from, partnerTeamId: to,
      assets: [...assetsFrom.map((asset) => engineAsset(asset, "send")), ...assetsTo.map((asset) => engineAsset(asset, "receive"))], ctx });
    const gap: Gap = { sendValue: ours.sendValue, receiveValue: ours.receiveValue, ratio: ours.ratio,
      delta: ours.receiveValue - ours.sendValue, verdict: ours.verdict, hasSend: true, hasReceive: true };
    const stamp = (assets: IncomingAsset[]) => assets.map((asset) => {
      const ref: AssetRef = asset.key.startsWith("pick:") ? { type: "pick", key: asset.key } : { type: "player", sleeperPlayerId: asset.key.slice(7) };
      return { ...asset, value: Math.round(valueAsset(ref, ctx)) };
    });
    Object.assign(payload, { from_value: Math.round(ours.sendValue), to_value: Math.round(ours.receiveValue),
      from_base_value: Math.round(fromSummary.totalValue), to_base_value: Math.round(toSummary.totalValue),
      asset_summary: { from: fromSummary.summary, to: toSummary.summary },
      grade_label: personaAwareGrade(gap, normalizePersona(strategy.data?.gm_persona)).label,
      assets_from: stamp(assetsFrom), assets_to: stamp(assetsTo) });
  }
  // The RPC replays before checking mutable ownership and commits the entire offer/thread transition.
  return executeLeagueCommand(session, "cfc_create_trade_offer", envelope, { p_payload: payload });
}
