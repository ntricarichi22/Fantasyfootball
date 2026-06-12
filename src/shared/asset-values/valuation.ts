import { getSupabaseAdminClient } from "@/infrastructure/supabase/admin";
import { ttlMemo } from "@/infrastructure/ttlCache";
import {
  getLeagueData,
  getPickValues,
  getValues,
  type PickLadder,
} from "@/shared/league-data";
import { buildTeamProfiles, type Tier } from "@/shared/team-profiles";
import { TIER_TO_SLOT, yearDiscount } from "./modifiers";

export type AssetRef =
  | { type: "player"; sleeperPlayerId: string }
  | { type: "pick"; key: string };

// Built once, then reused to value many assets without re-hitting the network.
export type ValuationContext = {
  cfcYear: number;
  playerBase: Map<string, number>; // sleeper_player_id -> consensus value
  ladder: PickLadder; // "R.SS" (padded) -> slot value
  tierByRoster: Map<string, Tier>; // rosterId -> current tier
  adjusted: Map<string, number>; // `${teamId}:${assetId}` -> stored final_value
};

function cfcYearNow(): number {
  const n = new Date();
  return n.getMonth() >= 2 ? n.getFullYear() : n.getFullYear() - 1;
}

const pad = (n: number): string => String(n).padStart(2, "0");

// Parse a canonical pick key. Mirrors the trade-engine format:
//   current: pick:YYYY-R-SS-RID   (4 parts; slot raw, "tbd" if unknown)
//   future:  pick:YYYY-R-RID      (3 parts; no slot)
// The trailing segment is always the ORIGINAL roster id.
type ParsedPickKey = { season: number; round: number; slot: number | null; originalRosterId: string };
function parsePickKey(key: string): ParsedPickKey | null {
  if (!key.startsWith("pick:")) return null;
  const parts = key.slice(5).split("-");
  if (parts.length !== 3 && parts.length !== 4) return null;
  const season = parseInt(parts[0], 10);
  const round = parseInt(parts[1], 10);
  if (Number.isNaN(season) || Number.isNaN(round)) return null;
  const originalRosterId = parts[parts.length - 1];
  let slot: number | null = null;
  if (parts.length === 4) {
    const s = parseInt(parts[2], 10);
    slot = Number.isNaN(s) ? null : s;
  }
  return { season, round, slot, originalRosterId };
}

// Stored team-adjusted values (players AND picks live here once rebuilt).
async function loadAdjusted(leagueId: string): Promise<Map<string, number>> {
  const map = new Map<string, number>();
  if (!leagueId) return map;
  const admin = getSupabaseAdminClient();
  if (!admin.client) return map;
  const { data } = await admin.client
    .from("cfc_team_trade_values_current")
    .select("team_id, sleeper_player_id, final_value")
    .eq("league_id", leagueId);
  for (const row of (data ?? []) as Array<{
    team_id: string;
    sleeper_player_id: string;
    final_value: number | null;
  }>) {
    if (row.team_id && row.sleeper_player_id && typeof row.final_value === "number") {
      map.set(`${row.team_id}:${row.sleeper_player_id}`, row.final_value);
    }
  }
  return map;
}

// Cached briefly — the door/editor endpoints each rebuilt this per request.
export function buildValuationContext(): Promise<ValuationContext> {
  return ttlMemo("asset-values:context", 60_000, buildValuationContextUncached);
}

async function buildValuationContextUncached(): Promise<ValuationContext> {
  const league = await getLeagueData();
  const [values, ladder] = await Promise.all([getValues(), getPickValues()]);

  const tierByRoster = new Map<string, Tier>();
  let cfcYear = cfcYearNow();
  let leagueId = "";
  if (!("error" in league)) {
    cfcYear = league.cfcYear;
    leagueId = league.leagueId;
    for (const p of buildTeamProfiles(league)) tierByRoster.set(p.rosterId, p.tier);
  }

  const adjusted = await loadAdjusted(leagueId);
  return { cfcYear, playerBase: values.value, ladder, tierByRoster, adjusted };
}

// Cheap, synchronous valuation given a prebuilt context.
export function valueAsset(
  asset: AssetRef,
  ctx: ValuationContext,
  opts?: { perspective?: string }
): number {
  const assetId = asset.type === "player" ? asset.sleeperPlayerId : asset.key;

  // 1. Stored team-adjusted value wins, when asking from a team's perspective.
  if (opts?.perspective) {
    const adj = ctx.adjusted.get(`${opts.perspective}:${assetId}`);
    if (typeof adj === "number") return adj;
  }

  // 2. Base value.
  if (asset.type === "player") {
    return ctx.playerBase.get(asset.sleeperPlayerId) ?? 0;
  }

  const p = parsePickKey(asset.key);
  if (!p) return 0;

  if (p.season <= ctx.cfcYear) {
    // current-year: exact slot, falling back to the round's .06 anchor
    if (p.slot != null) {
      const exact = ctx.ladder.get(`${p.round}.${pad(p.slot)}`);
      if (typeof exact === "number") return exact;
    }
    return ctx.ladder.get(`${p.round}.06`) ?? 0;
  }

  // future: original owner's tier -> slot -> ladder, then the year discount
  const tier = ctx.tierByRoster.get(p.originalRosterId) ?? "retooling";
  const base = ctx.ladder.get(`${p.round}.${pad(TIER_TO_SLOT[tier])}`) ?? 0;
  return Math.round(base * yearDiscount(p.season - ctx.cfcYear));
}

// Single-shot convenience: builds a context, then values one asset.
export async function getAssetValue(
  asset: AssetRef,
  opts?: { perspective?: string }
): Promise<number> {
  const ctx = await buildValuationContext();
  return valueAsset(asset, ctx, opts);
}