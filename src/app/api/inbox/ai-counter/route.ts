import { NextRequest, NextResponse } from "next/server";
import { getSupabaseAdminClient } from "@/infrastructure/supabase/admin";
import { LEAGUE_ID } from "@/infrastructure/config";
import { getPickValue } from "@/pro-personnel/trade-engine/value";
import type { DraftPick } from "@/infrastructure/picks";
import { normalizePersona, bandFor } from "@/pro-personnel/engine/core/personas";

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

/* ------------------------------------------------------------------ */
/*  Constants                                                           */
/* ------------------------------------------------------------------ */

const LEAGUE_ID_ENV = process.env.NEXT_PUBLIC_SLEEPER_LEAGUE_ID?.trim() || "";

/* ------------------------------------------------------------------ */
/*  Sleeper roster loading                                              */
/*                                                                      */
/*  The player dictionary is ~5MB, so we fetch league data ONCE and     */
/*  build assets for both teams off the shared payload.                 */
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

function buildRosterAssets(
  rosterId: string,
  data: SleeperData,
  cfcValues: Record<string, number>,
): OfferAsset[] {
  // eslint-disable-next-line @typescript-eslint/no-explicit-any
  const roster = data.rosters.find((r: any) => String(r.roster_id) === String(rosterId));
  if (!roster) return [];

  const assets: OfferAsset[] = [];

  for (const pid of roster.players ?? []) {
    const id = String(pid);
    const info = data.playerDict[id];
    const value = cfcValues[id] ?? 0;
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
    const pick: DraftPick = {
      season: tp.season,
      round: tp.round,
      roster_id: tp.owner_id,
      original_roster_id: tp.roster_id,
    };
    const value = getPickValue(pick, { teamCount: data.teamCount, cfcValues });
    if (!value) continue;
    assets.push({
      key: `pick:${tp.season}-${tp.round}-${tp.roster_id}`,
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
/*  Data feed for the counter-mode slider. Returns the partner's        */
/*  demandable pieces, our own pool (for manual add), and the partner's  */
/*  persona accept-band so the client can drive the posture math.        */
/*                                                                      */
/*  Body:    { thread_id, counter_team_id }                             */
/*  Returns: { latest_offer_id, their_persona, their_band,              */
/*             their_pool, our_pool }                                    */
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

  // CFC values, persona, and Sleeper data in parallel.
  const [{ data: pvData }, { data: stratRows }, sleeper] = await Promise.all([
    client
      .from("cfc_trade_values_current")
      .select("sleeper_player_id, asset_key, cfc_value"),
    client
      .from("cfc_team_strategy_profiles")
      .select("team_id, gm_persona")
      .eq("league_id", league_id)
      .eq("team_id", partnerTeamId),
    fetchSleeperData(),
  ]);

  const cfcValues: Record<string, number> = {};
  for (const row of pvData ?? []) {
    if (typeof row.cfc_value !== "number") continue;
    if (row.sleeper_player_id) cfcValues[row.sleeper_player_id] = row.cfc_value;
    if (row.asset_key?.startsWith("pick.")) cfcValues[row.asset_key] = row.cfc_value;
  }

  const their_persona = normalizePersona(stratRows?.[0]?.gm_persona);
  const their_band = bandFor(their_persona);

  const existingKeys = new Set([
    ...(latestOffer.assets_from ?? []).map((a: OfferAsset) => a.key),
    ...(latestOffer.assets_to ?? []).map((a: OfferAsset) => a.key),
  ]);

  let their_pool: OfferAsset[] = [];
  let our_pool: OfferAsset[] = [];
  if (sleeper) {
    their_pool = buildRosterAssets(partnerTeamId, sleeper, cfcValues).filter(
      (a) => !existingKeys.has(a.key),
    );
    our_pool = buildRosterAssets(counter_team_id, sleeper, cfcValues).filter(
      (a) => !existingKeys.has(a.key),
    );
  }

  return NextResponse.json({
    latest_offer_id: latestOffer.id,
    their_persona,
    their_band,
    their_pool,
    our_pool,
  });
}
