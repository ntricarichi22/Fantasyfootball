import { NextRequest, NextResponse } from "next/server";
import { getSupabaseAdminClient } from "@/infrastructure/supabase/admin";
import { LEAGUE_ID } from "@/infrastructure/config";
import { normalizePersona, bandFor } from "@/pro-personnel/engine/core/personas";
import {
  buildValuationContext,
  valueAsset,
  type AssetRef,
  type ValuationContext,
} from "@/shared/asset-values";

export const dynamic = "force-dynamic";
export const maxDuration = 30;

/* ------------------------------------------------------------------ */
/*  Types                                                               */
/* ------------------------------------------------------------------ */

interface OfferAsset {
  key: string;
  label: string;
  type: "player" | "pick";
  position?: string;
  team?: string;
  ageLabel?: string;
  value: number;
}

const LEAGUE_ID_ENV = process.env.NEXT_PUBLIC_SLEEPER_LEAGUE_ID?.trim() || "";

// trade_offers / roster keys → a valuation AssetRef.
function refFor(key: string): AssetRef {
  if (key.startsWith("pick:")) return { type: "pick", key };
  if (key.startsWith("player:")) return { type: "player", sleeperPlayerId: key.slice(7) };
  return { type: "player", sleeperPlayerId: key };
}

/* ------------------------------------------------------------------ */
/*  Sleeper roster loading (fetched once, shared by both teams)         */
/* ------------------------------------------------------------------ */

type SleeperData = {
  // eslint-disable-next-line @typescript-eslint/no-explicit-any
  rosters: any[];
  // eslint-disable-next-line @typescript-eslint/no-explicit-any
  playerDict: Record<string, any>;
  // eslint-disable-next-line @typescript-eslint/no-explicit-any
  traded: any[];
  teamCount: number;
};

async function fetchSleeperData(): Promise<SleeperData | null> {
  if (!LEAGUE_ID_ENV) return null;
  try {
    const [rosterRes, playerRes, tradedRes] = await Promise.all([
      fetch(`https://api.sleeper.app/v1/league/${LEAGUE_ID_ENV}/rosters`),
      fetch("https://api.sleeper.app/v1/players/nfl"),
      fetch(`https://api.sleeper.app/v1/league/${LEAGUE_ID_ENV}/traded_picks`),
    ]);
    if (!rosterRes.ok || !playerRes.ok) return null;
    const rosters = await rosterRes.json();
    const playerDict = await playerRes.json();
    const traded = tradedRes.ok ? await tradedRes.json() : [];
    return { rosters, playerDict, traded, teamCount: rosters.length || 12 };
  } catch {
    return null;
  }
}

// A team's tradeable assets, each valued from `perspective`'s seat — so the
// pool reflects what those pieces are worth to US (intent baked in).
function buildRosterAssets(
  rosterId: string,
  data: SleeperData,
  ctx: ValuationContext,
  perspective: string,
): OfferAsset[] {
  // eslint-disable-next-line @typescript-eslint/no-explicit-any
  const roster = data.rosters.find((r: any) => String(r.roster_id) === String(rosterId));
  if (!roster) return [];

  const assets: OfferAsset[] = [];

  for (const pid of roster.players ?? []) {
    const id = String(pid);
    const info = data.playerDict[id];
    const value = valueAsset({ type: "player", sleeperPlayerId: id }, ctx, { perspective });
    if (!value) continue;
    const name =
      info?.full_name ||
      [info?.first_name, info?.last_name].filter(Boolean).join(" ") ||
      id;
    assets.push({
      key: `player:${id}`,
      label: name,
      type: "player",
      position: info?.position?.toUpperCase() || "–",
      team: info?.team || "FA",
      ageLabel: info?.age ? String(info.age) : "–",
      value,
    });
  }

  for (const tp of data.traded) {
    if (String(tp.owner_id) !== String(rosterId)) continue;
    const key = `pick:${tp.season}-${tp.round}-${tp.roster_id}`;
    const value = valueAsset({ type: "pick", key }, ctx, { perspective });
    if (!value) continue;
    assets.push({
      key,
      label: `${tp.season} Round ${tp.round} Pick`,
      type: "pick",
      value,
    });
  }

  return assets;
}

/* ------------------------------------------------------------------ */
/*  POST /api/inbox/ai-counter                                          */
/*                                                                      */
/*  Data feed for the counter slider, all valued from OUR seat:         */
/*  the partner's demandable pieces, our own pool, the partner's        */
/*  persona band, and the on-the-table offer re-valued for us.          */
/*                                                                      */
/*  Body:    { thread_id, counter_team_id }                             */
/* ------------------------------------------------------------------ */

export async function POST(request: NextRequest) {
  let body: Record<string, unknown>;
  try {
    body = await request.json();
  } catch {
    return NextResponse.json({ error: "Invalid JSON body" }, { status: 400 });
  }

  const { thread_id, counter_team_id } = body as {
    thread_id?: string;
    counter_team_id?: string;
  };

  if (!thread_id || !counter_team_id) {
    return NextResponse.json(
      { error: "thread_id and counter_team_id are required" },
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

  // Latest pending offer in the thread → who's the partner.
  const { data: offers, error: offersError } = await client
    .from("trade_offers")
    .select("*")
    .eq("thread_id", thread_id)
    .eq("league_id", league_id)
    .eq("status", "pending")
    .order("created_at", { ascending: false })
    .limit(1);

  if (offersError || !offers?.length) {
    return NextResponse.json(
      { error: "No pending offer found in thread" },
      { status: 404 },
    );
  }

  const latestOffer = offers[0];
  const partnerTeamId =
    String(latestOffer.from_team_id) === String(counter_team_id)
      ? String(latestOffer.to_team_id)
      : String(latestOffer.from_team_id);

  // Partner persona, Sleeper data, and the valuation context (intent-aware,
  // ttl-cached) in parallel.
  const [{ data: stratRows }, sleeper, ctx] = await Promise.all([
    client
      .from("cfc_team_strategy_profiles")
      .select("team_id, gm_persona")
      .eq("league_id", league_id)
      .in("team_id", [partnerTeamId, counter_team_id]),
    fetchSleeperData(),
    buildValuationContext(),
  ]);

  const personaOf = (teamId: string) =>
    normalizePersona(
      (stratRows ?? []).find((r) => String(r.team_id) === String(teamId))?.gm_persona,
    );
  const their_persona = personaOf(partnerTeamId);
  const their_band = bandFor(their_persona);
  const our_persona = personaOf(counter_team_id);
  const our_band = bandFor(our_persona);

  const existingKeys = new Set([
    ...(latestOffer.assets_from ?? []).map((a: OfferAsset) => a.key),
    ...(latestOffer.assets_to ?? []).map((a: OfferAsset) => a.key),
  ]);

  let their_pool: OfferAsset[] = [];
  let our_pool: OfferAsset[] = [];
  if (sleeper) {
    their_pool = buildRosterAssets(partnerTeamId, sleeper, ctx, counter_team_id).filter(
      (a) => !existingKeys.has(a.key),
    );
    our_pool = buildRosterAssets(counter_team_id, sleeper, ctx, counter_team_id).filter(
      (a) => !existingKeys.has(a.key),
    );
  }

  // The on-the-table offer's assets, re-valued from OUR seat so the slider math
  // runs on the same intent-aware currency as the pool.
  const offer_values: Record<string, number> = {};
  for (const a of [
    ...(latestOffer.assets_from ?? []),
    ...(latestOffer.assets_to ?? []),
  ] as OfferAsset[]) {
    offer_values[a.key] = valueAsset(refFor(a.key), ctx, { perspective: counter_team_id });
  }

  return NextResponse.json({
    latest_offer_id: latestOffer.id,
    their_persona,
    their_band,
    our_persona,
    our_band,
    their_pool,
    our_pool,
    offer_values,
  });
}
