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
/*  Types + constants                                                   */
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

// Starter-level cutoffs (top-N by value at position, league-wide), mirroring
// the engine's classification. A non-stud player outside the top-N is "below
// starter" and, if not young, a scrub.
const STARTER_LEVEL_TOPN: Record<string, number> = { QB: 30, RB: 30, WR: 40, TE: 10 };

const LEAGUE_ID_ENV = process.env.NEXT_PUBLIC_SLEEPER_LEAGUE_ID?.trim() || "";

type Quality = { value: number; isStud: boolean; isYouth: boolean };

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

// A team's tradeable assets, each valued from `perspective`'s seat.
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
    assets.push({
      key: `player:${id}`,
      label: info?.full_name || [info?.first_name, info?.last_name].filter(Boolean).join(" ") || id,
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
    assets.push({ key, label: `${tp.season} Round ${tp.round} Pick`, type: "pick", value });
  }
  return assets;
}

// League-wide starter-level keys: top-N non-studs at each position by value.
function computeStarterKeys(data: SleeperData, quality: Record<string, Quality>): Set<string> {
  const byPos = new Map<string, { id: string; value: number }[]>();
  for (const roster of data.rosters) {
    for (const pid of roster.players ?? []) {
      const id = String(pid);
      const q = quality[id];
      if (!q || q.isStud) continue;
      const pos = (data.playerDict[id]?.position ?? "").toUpperCase();
      if (!STARTER_LEVEL_TOPN[pos]) continue;
      if (!byPos.has(pos)) byPos.set(pos, []);
      byPos.get(pos)!.push({ id, value: q.value });
    }
  }
  const keys = new Set<string>();
  for (const [pos, list] of byPos) {
    list.sort((a, b) => b.value - a.value);
    for (let i = 0; i < Math.min(STARTER_LEVEL_TOPN[pos], list.length); i++) keys.add(list[i].id);
  }
  return keys;
}

/* ------------------------------------------------------------------ */
/*  POST /api/inbox/ai-counter                                          */
/* ------------------------------------------------------------------ */

export async function POST(request: NextRequest) {
  let body: Record<string, unknown>;
  try {
    body = await request.json();
  } catch {
    return NextResponse.json({ error: "Invalid JSON body" }, { status: 400 });
  }

  const { thread_id, counter_team_id } = body as { thread_id?: string; counter_team_id?: string };
  if (!thread_id || !counter_team_id) {
    return NextResponse.json({ error: "thread_id and counter_team_id are required" }, { status: 400 });
  }

  const league_id = LEAGUE_ID;
  if (!league_id) return NextResponse.json({ error: "League ID not configured" }, { status: 500 });

  const { client, error: clientError } = getSupabaseAdminClient();
  if (!client) return NextResponse.json({ error: clientError }, { status: 500 });

  const { data: offers, error: offersError } = await client
    .from("trade_offers")
    .select("*")
    .eq("thread_id", thread_id)
    .eq("league_id", league_id)
    .eq("status", "pending")
    .order("created_at", { ascending: false })
    .limit(1);

  if (offersError || !offers?.length) {
    return NextResponse.json({ error: "No pending offer found in thread" }, { status: 404 });
  }

  const latestOffer = offers[0];
  const partnerTeamId =
    String(latestOffer.from_team_id) === String(counter_team_id)
      ? String(latestOffer.to_team_id)
      : String(latestOffer.from_team_id);

  const [{ data: stratRows }, sleeper, ctx] = await Promise.all([
    client
      .from("cfc_team_strategy_profiles")
      .select("team_id, gm_persona, qb_market, rb_market, pc_market")
      .eq("league_id", league_id)
      .in("team_id", [partnerTeamId, counter_team_id]),
    fetchSleeperData(),
    buildValuationContext(),
  ]);

  // eslint-disable-next-line @typescript-eslint/no-explicit-any
  const stratFor = (teamId: string) => (stratRows ?? []).find((r: any) => String(r.team_id) === String(teamId));
  const their_persona = normalizePersona(stratFor(partnerTeamId)?.gm_persona);
  const their_band = bandFor(their_persona);
  const our_persona = normalizePersona(stratFor(counter_team_id)?.gm_persona);
  const our_band = bandFor(our_persona);

  // Our buy markets gate which young-but-not-yet-starter players survive the
  // scrub cut on the demand side.
  const ourStrat = stratFor(counter_team_id);
  const buyPositions = new Set<string>();
  if (ourStrat?.qb_market === "buy") buyPositions.add("QB");
  if (ourStrat?.rb_market === "buy") buyPositions.add("RB");
  if (ourStrat?.pc_market === "buy") { buyPositions.add("WR"); buyPositions.add("TE"); }

  // Stud/youth flags for every rostered player (cheap: one values query).
  const quality: Record<string, Quality> = {};
  if (sleeper) {
    const allIds = Array.from(
      new Set(sleeper.rosters.flatMap((r) => (r.players ?? []).map((p: unknown) => String(p)))),
    );
    if (allIds.length > 0) {
      const { data: qRows } = await client
        .from("cfc_trade_values_current")
        .select("sleeper_player_id, cfc_value, elite_multiplier_applied, age_multiplier_applied")
        .in("sleeper_player_id", allIds);
      for (const p of qRows ?? []) {
        if (!p.sleeper_player_id) continue;
        quality[String(p.sleeper_player_id)] = {
          value: typeof p.cfc_value === "number" ? p.cfc_value : 0,
          isStud: typeof p.elite_multiplier_applied === "number" && p.elite_multiplier_applied > 1.0,
          isYouth: p.age_multiplier_applied === 1.0,
        };
      }
    }
  }
  const starterKeys = sleeper ? computeStarterKeys(sleeper, quality) : new Set<string>();

  // The scrub gate (engine's buildPartnerPool rule): keep picks, studs, and
  // starter-level players unconditionally; keep youth only at our buy positions;
  // drop everything else. So a counter NEVER pulls in a scrub.
  const keepForDemand = (a: OfferAsset): boolean => {
    if (a.type === "pick") return true;
    const id = a.key.replace("player:", "");
    const q = quality[id];
    if (!q) return false;
    if (q.isStud || starterKeys.has(id)) return true;
    if (q.isYouth) return buyPositions.has((a.position ?? "").toUpperCase());
    return false;
  };

  const existingKeys = new Set([
    ...(latestOffer.assets_from ?? []).map((a: OfferAsset) => a.key),
    ...(latestOffer.assets_to ?? []).map((a: OfferAsset) => a.key),
  ]);

  let their_pool: OfferAsset[] = [];
  let our_pool: OfferAsset[] = [];
  if (sleeper) {
    their_pool = buildRosterAssets(partnerTeamId, sleeper, ctx, counter_team_id)
      .filter((a) => !existingKeys.has(a.key) && keepForDemand(a));
    // Our own roster (manual + add) is left unfiltered — the user can add anything.
    our_pool = buildRosterAssets(counter_team_id, sleeper, ctx, counter_team_id).filter(
      (a) => !existingKeys.has(a.key),
    );
  }

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
