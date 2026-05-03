// src/app/api/internal/refresh-values/route.ts
//
// Nightly cron job that refreshes player values from external sources.
// Triggered by Vercel cron at 4am ET (configured in vercel.json).
//
// Flow:
//   1. Fetch from FantasyCalc, KTC, DynastyProcess (Superflex)
//   2. Normalize source names → sleeper_player_id (alias map)
//   3. Compute league-101 multiples (raw_value / max_value)
//   4. Upsert cfc_assets (player metadata) + populate years_exp from Sleeper
//   5. Replace cfc_asset_source_values for today's batch
//   6. Compute per-player scoring factors from Sleeper season stats
//   7. Run cfc_rebuild_value_layers() to recompute composite + multipliers
//   8. Rebuild team-adjusted values for all 12 teams
//
// Failure mode: skip + log + continue. If <2 of 3 sources succeed,
// abort and keep yesterday's values intact (the rebuild step is skipped).

import { NextRequest, NextResponse } from "next/server";
import { getSupabaseAdminClient } from "@/lib/supabaseAdmin";
import { LEAGUE_ID } from "@/lib/config";
import { fetchFantasyCalc } from "@/lib/values/sources/fantasycalc";
import { fetchKeepTradeCut } from "@/lib/values/sources/keeptradecut";
import { fetchDynastyProcess } from "@/lib/values/sources/dynastyprocess";
import { normalizeRows, type SourceRow } from "@/lib/values/normalize";
import { rebuildTeamTradeValuesForTeam } from "@/lib/team-hq/service";

export const dynamic = "force-dynamic";
export const maxDuration = 300; // 5 minutes — value pipeline can take a bit

type SourceResult = {
  source_key: string;
  ok: boolean;
  rows_fetched: number;
  rows_resolved: number;
  rows_unmapped: number;
  error?: string;
};

type SleeperPlayerMeta = {
  full_name?: string | null;
  position?: string | null;
  birth_date?: string | null;
  years_exp?: number | null;
};

type SleeperStat = {
  pts_ppr?: number;
  rec?: number;
  rec_fd?: number;
  rush_fd?: number;
  pass_yd?: number;
};

const SLEEPER_PLAYERS_URL = "https://api.sleeper.app/v1/players/nfl";
const SLEEPER_STATS_URL = (season: number) =>
  `https://api.sleeper.app/v1/stats/nfl/regular/${season}`;

// ──────────────────────────────────────────────────────────────────────
// Auth check
// ──────────────────────────────────────────────────────────────────────

function isAuthorized(request: NextRequest): boolean {
  const auth = request.headers.get("authorization") ?? "";
  // Vercel cron sends Bearer ${CRON_SECRET} automatically
  if (process.env.CRON_SECRET && auth === `Bearer ${process.env.CRON_SECRET}`) {
    return true;
  }
  // Manual runs use ADMIN_SECRET (header or query param)
  if (process.env.ADMIN_SECRET) {
    if (auth === `Bearer ${process.env.ADMIN_SECRET}`) return true;
    const querySecret = request.nextUrl.searchParams.get("secret");
    if (querySecret === process.env.ADMIN_SECRET) return true;
  }
  return false;
}

// ──────────────────────────────────────────────────────────────────────
// Source fetching with skip+log+continue resilience
// ──────────────────────────────────────────────────────────────────────

type FetcherResult = { rows: SourceRow[]; pick_101_value: number | null };

async function fetchSourceSafely(
  sourceKey: string,
  fetcher: () => Promise<FetcherResult>,
): Promise<{ source_key: string; rows: SourceRow[]; pick_101_value: number | null; error?: string }> {
  try {
    const result = await fetcher();
    return { source_key: sourceKey, rows: result.rows, pick_101_value: result.pick_101_value };
  } catch (e) {
    const error = e instanceof Error ? e.message : String(e);
    console.error(`[refresh-values] ${sourceKey} fetch failed:`, error);
    return { source_key: sourceKey, rows: [], pick_101_value: null, error };
  }
}

// ──────────────────────────────────────────────────────────────────────
// Scoring factor computation (CFC league-specific)
// ──────────────────────────────────────────────────────────────────────

/**
 * Computes the per-player scoring factor: (CFC points) / (standard PPR points).
 * Standard PPR = Sleeper's pts_ppr (1.0 per reception, 0.04/passing yard, etc).
 * CFC scoring = standard PPR
 *   - 1.0 × receptions   (we don't reward receptions, only first downs)
 *   + 1.0 × rec_fd       (1 pt per receiving first down)
 *   + 0.5 × rush_fd      (0.5 pt per rushing first down)
 *   + 0.01 × pass_yd     (0.05 - 0.04 = 0.01 bonus per passing yard)
 */
function computeFactorFromStats(stat: SleeperStat | undefined): number | null {
  if (!stat || typeof stat.pts_ppr !== "number") return null;
  const standard = stat.pts_ppr;
  if (standard <= 0) return null;

  const cfc =
    standard
    - 1.0 * (stat.rec ?? 0)
    + 1.0 * (stat.rec_fd ?? 0)
    + 0.5 * (stat.rush_fd ?? 0)
    + 0.01 * (stat.pass_yd ?? 0);

  // Floor at 50% and cap at 150% to prevent extreme outliers from one bad/great season
  const factor = Math.max(0.5, Math.min(1.5, cfc / standard));
  return Math.round(factor * 10000) / 10000;
}

async function fetchSleeperStats(season: number): Promise<Record<string, SleeperStat>> {
  const res = await fetch(SLEEPER_STATS_URL(season), { cache: "no-store" });
  if (!res.ok) throw new Error(`Sleeper stats ${season} failed: ${res.status}`);
  return (await res.json()) as Record<string, SleeperStat>;
}

async function computeAndStoreScoringFactors(
  // eslint-disable-next-line @typescript-eslint/no-explicit-any
  supabase: any,
  sleeperPlayers: Record<string, SleeperPlayerMeta>,
): Promise<{ count: number }> {
  const now = new Date();
  const lastSeason = now.getMonth() >= 2 ? now.getFullYear() - 1 : now.getFullYear() - 2;
  const priorSeason = lastSeason - 1;

  const emptyStats: Record<string, SleeperStat> = {};
  const [statsLast, statsPrior] = await Promise.all([
    fetchSleeperStats(lastSeason).catch(() => emptyStats),
    fetchSleeperStats(priorSeason).catch(() => emptyStats),
  ]);

  const rows: {
    sleeper_player_id: string;
    scoring_factor: number;
    factor_last_season: number | null;
    factor_prior_season: number | null;
    source_count: number;
  }[] = [];

  for (const [pid, meta] of Object.entries(sleeperPlayers)) {
    if (!meta.position) continue;
    const isRookie = meta.years_exp === 0;

    if (isRookie) {
      rows.push({
        sleeper_player_id: pid,
        scoring_factor: 1.0,
        factor_last_season: null,
        factor_prior_season: null,
        source_count: 0,
      });
      continue;
    }

    const fLast = computeFactorFromStats(statsLast[pid]);
    const fPrior = computeFactorFromStats(statsPrior[pid]);

    let blended: number;
    let count: number;
    if (fLast !== null && fPrior !== null) {
      blended = fLast * 0.7 + fPrior * 0.3;
      count = 2;
    } else if (fLast !== null) {
      blended = fLast;
      count = 1;
    } else if (fPrior !== null) {
      blended = fPrior;
      count = 1;
    } else {
      // No stats — default 1.0 (no adjustment)
      blended = 1.0;
      count = 0;
    }

    rows.push({
      sleeper_player_id: pid,
      scoring_factor: Math.round(blended * 10000) / 10000,
      factor_last_season: fLast,
      factor_prior_season: fPrior,
      source_count: count,
    });
  }

  // Replace the entire table (no need to incrementally upsert — this is a daily snapshot)
  await supabase.from("cfc_player_scoring_factors").delete().neq("sleeper_player_id", "__never__");

  // Insert in batches to avoid request size limits
  const BATCH = 500;
  for (let i = 0; i < rows.length; i += BATCH) {
    const batch = rows.slice(i, i + BATCH);
    const { error } = await supabase.from("cfc_player_scoring_factors").insert(batch);
    if (error) throw new Error(`Scoring factor insert failed: ${error.message}`);
  }

  return { count: rows.length };
}

// ──────────────────────────────────────────────────────────────────────
// Main handler
// ──────────────────────────────────────────────────────────────────────

export async function GET(request: NextRequest) {
  if (!isAuthorized(request)) {
    return NextResponse.json({ error: "unauthorized" }, { status: 401 });
  }

  const { client, error: clientErr } = getSupabaseAdminClient();
  if (!client) return NextResponse.json({ error: clientErr }, { status: 500 });

  const importBatch = `auto-${new Date().toISOString().slice(0, 10)}`;
  const summary: SourceResult[] = [];

  // 1. Fetch from all three sources in parallel (each independently)
  const fetched = await Promise.all([
    fetchSourceSafely("fantasycalc", fetchFantasyCalc),
    fetchSourceSafely("keeptradecut", fetchKeepTradeCut),
    fetchSourceSafely("dynastyprocess", fetchDynastyProcess),
  ]);

  // 2. Check resilience threshold — if fewer than 2 of 3 sources succeeded, abort
  const successfulSources = fetched.filter(f => f.rows.length > 0);
  if (successfulSources.length < 2) {
    return NextResponse.json({
      ok: false,
      reason: "Insufficient sources succeeded — keeping yesterday's values",
      sources: fetched.map(f => ({
        source_key: f.source_key,
        rows_fetched: f.rows.length,
        error: f.error,
      })),
    }, { status: 503 });
  }

  // 3. Fetch Sleeper players dictionary (used for years_exp + name normalization fallback)
  let sleeperPlayers: Record<string, SleeperPlayerMeta> = {};
  try {
    const res = await fetch(SLEEPER_PLAYERS_URL, { cache: "no-store" });
    if (res.ok) sleeperPlayers = await res.json();
  } catch (e) {
    console.error("[refresh-values] Sleeper players fetch failed:", e);
  }

  // 4. Normalize each source's rows, build asset metadata to upsert
  const allResolvedRows: { source_key: string; sleeper_player_id: string; raw_value: number }[] = [];
  for (const { source_key, rows, error } of fetched) {
    if (rows.length === 0) {
      summary.push({ source_key, ok: false, rows_fetched: 0, rows_resolved: 0, rows_unmapped: 0, error });
      continue;
    }
    try {
      const { resolved, unmapped } = await normalizeRows(client, source_key, rows, importBatch, sleeperPlayers);
      for (const r of resolved) {
        allResolvedRows.push({
          source_key,
          sleeper_player_id: r.sleeper_player_id,
          raw_value: r.raw_value,
        });
      }
      summary.push({
        source_key, ok: true,
        rows_fetched: rows.length,
        rows_resolved: resolved.length,
        rows_unmapped: unmapped.length,
      });
    } catch (e) {
      const err = e instanceof Error ? e.message : String(e);
      summary.push({ source_key, ok: false, rows_fetched: rows.length, rows_resolved: 0, rows_unmapped: 0, error: err });
    }
  }

  if (allResolvedRows.length === 0) {
    return NextResponse.json({
      ok: false,
      reason: "All sources resolved 0 rows after name normalization",
      summary,
    }, { status: 500 });
  }

  // 5. Build pick_101_value lookup per source. This is the denominator
  // for multiple_101: source_player_value / source_1.01_value gives a ratio
  // that, multiplied by our $300 anchor, yields the player's CFC composite.
  const pick101BySource: Record<string, number | null> = {};
  for (const f of fetched) {
    pick101BySource[f.source_key] = f.pick_101_value;
  }

  // Sources without a 1.01 anchor cannot be used (no denominator).
  // Filter resolved rows accordingly so we don't pollute the composite.
  const usableSources = new Set(
    Object.entries(pick101BySource)
      .filter(([, v]) => typeof v === "number" && v > 0)
      .map(([k]) => k),
  );
  const filteredResolvedRows = allResolvedRows.filter(r => usableSources.has(r.source_key));

  // 6. Upsert cfc_assets — collect distinct sleeper_player_ids
  const distinctPlayerIds = new Set(filteredResolvedRows.map(r => r.sleeper_player_id));
  const assetRows: {
    asset_key: string;
    asset_type: string;
    display_name: string;
    sleeper_player_id: string;
    position: string | null;
    birth_date: string | null;
    years_exp: number | null;
    is_active: boolean;
  }[] = [];
  for (const pid of distinctPlayerIds) {
    const meta = sleeperPlayers[pid];
    if (!meta) continue;
    assetRows.push({
      asset_key: `player.${pid}`,
      asset_type: "player",
      display_name: meta.full_name ?? pid,
      sleeper_player_id: pid,
      position: meta.position ?? null,
      birth_date: meta.birth_date ?? null,
      years_exp: typeof meta.years_exp === "number" ? meta.years_exp : null,
      is_active: true,
    });
  }
  if (assetRows.length > 0) {
    const BATCH = 500;
    for (let i = 0; i < assetRows.length; i += BATCH) {
      const batch = assetRows.slice(i, i + BATCH);
      const { error } = await client.from("cfc_assets").upsert(batch, { onConflict: "asset_key" });
      if (error) {
        return NextResponse.json({ error: `cfc_assets upsert failed: ${error.message}` }, { status: 500 });
      }
    }
  }

  // 7. Replace cfc_asset_source_values for the enabled sources we just fetched
  const enabledSources = summary.filter(s => s.ok).map(s => s.source_key);
  await client
    .from("cfc_asset_source_values")
    .delete()
    .in("source_key", enabledSources);

  // Insert fresh source values — dedupe by (asset_key, source_key) first.
  // Two source rows can resolve to the same Sleeper ID (e.g. KTC listing a
  // player under two names); keep the highest raw_value.
  // Also filter to only players we have asset rows for (prevents FK violations
  // when a source returns a Sleeper ID that isn't in Sleeper's current dict).
  const validPlayerIds = new Set(assetRows.map(a => a.sleeper_player_id));
  const dedupeMap = new Map<string, typeof filteredResolvedRows[number]>();
  for (const r of filteredResolvedRows) {
    if (!validPlayerIds.has(r.sleeper_player_id)) continue;
    const key = `${r.source_key}|player.${r.sleeper_player_id}`;
    const existing = dedupeMap.get(key);
    if (!existing || r.raw_value > existing.raw_value) {
      dedupeMap.set(key, r);
    }
  }
  const dedupedRows = Array.from(dedupeMap.values());

  const sourceValueRows = dedupedRows.map(r => {
    const anchor = pick101BySource[r.source_key];
    if (typeof anchor !== "number" || anchor <= 0) {
      throw new Error(`Source ${r.source_key} has no 1.01 anchor — should have been filtered earlier`);
    }
    return {
      import_batch: importBatch,
      asset_key: `player.${r.sleeper_player_id}`,
      source_key: r.source_key,
      raw_value: r.raw_value,
      source_101_value: anchor,
      multiple_101: r.raw_value / anchor,
    };
  });

  const SVBATCH = 500;
  for (let i = 0; i < sourceValueRows.length; i += SVBATCH) {
    const batch = sourceValueRows.slice(i, i + SVBATCH);
    const { error } = await client
      .from("cfc_asset_source_values")
      .upsert(batch, { onConflict: "asset_key,source_key" });
    if (error) {
      return NextResponse.json({ error: `cfc_asset_source_values upsert failed: ${error.message}` }, { status: 500 });
    }
  }

  // 8. Compute and store per-player scoring factors
  let scoringFactorCount = 0;
  try {
    const { count } = await computeAndStoreScoringFactors(client, sleeperPlayers);
    scoringFactorCount = count;
  } catch (e) {
    console.error("[refresh-values] Scoring factor computation failed:", e);
    // Don't abort — rebuild will use 1.0 default for missing players
  }

  // 9. Run the rebuild function (computes composite + applies all multipliers)
  const { error: rebuildErr } = await client.rpc("cfc_rebuild_value_layers");
  if (rebuildErr) {
    return NextResponse.json({ error: `Rebuild failed: ${rebuildErr.message}`, summary }, { status: 500 });
  }

  // 10. Rebuild team-adjusted values for all 12 teams
  const teamRebuildResults: { team_id: string; ok: boolean; error?: string }[] = [];
  for (let i = 1; i <= 12; i++) {
    const teamId = String(i);
    try {
      await rebuildTeamTradeValuesForTeam(LEAGUE_ID, teamId);
      teamRebuildResults.push({ team_id: teamId, ok: true });
    } catch (e) {
      const error = e instanceof Error ? e.message : String(e);
      teamRebuildResults.push({ team_id: teamId, ok: false, error });
    }
  }

  return NextResponse.json({
    ok: true,
    import_batch: importBatch,
    summary,
    pick_101_by_source: pick101BySource,
    distinct_players: distinctPlayerIds.size,
    scoring_factors_computed: scoringFactorCount,
    team_rebuilds: teamRebuildResults,
  });
}

// Vercel cron jobs invoke endpoints with GET. Keep POST as a manual-trigger alias.
export async function POST(request: NextRequest) {
  return GET(request);
}
