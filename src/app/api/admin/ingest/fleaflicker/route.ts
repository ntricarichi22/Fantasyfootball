import { asRecord } from "@/infrastructure/json";
import { fetchFleaflicker, type SourceFetchResult } from "@/infrastructure/ingest/source-http";
import { isAdminRequest } from "@/infrastructure/auth/admin";
import { NextRequest, NextResponse } from "next/server";
import { requireSupabaseAdminClient as getSupabaseAdmin } from "@/infrastructure/supabase/admin";
import crypto from "node:crypto";

export const runtime = "nodejs";
export const dynamic = "force-dynamic";



function sha256(input: string) {
  return crypto.createHash("sha256").update(input).digest("hex");
}

function extractTeamIds(payload: unknown): number[] {
  const ids = new Set<number>();

  const walk = (value: unknown) => {
    if (Array.isArray(value)) {
      value.forEach(walk);
      return;
    }
    const node = asRecord(value);

    if (
      typeof node.id === "number" &&
      typeof node.name === "string" &&
      (Array.isArray(node.owners) || node.logo_url || node.recordOverall || node.record_overall)
    ) {
      ids.add(node.id);
    }

    for (const value of Object.values(node)) walk(value);
  };

  walk(payload);
  return [...ids];
}

function extractGameIdsFromScoreboard(payload: unknown): string[] {
  const ids = new Set<string>();

  const walk = (value: unknown) => {
    if (Array.isArray(value)) {
      value.forEach(walk);
      return;
    }
    const node = asRecord(value);

    if (typeof node.id !== "undefined" && (node.home || node.away)) {
      ids.add(String(node.id));
    }

    for (const value of Object.values(node)) walk(value);
  };

  walk(payload);
  return [...ids];
}

async function upsertRawGlobalRow(
  supabase: ReturnType<typeof getSupabaseAdmin>,
  row: {
    smoke_id: string;
    ingest_run_id: string;
    season_year: number;
    source_league_id: string;
    endpoint_group: string;
    endpoint_name: string;
    request_url: string;
    request_params: Record<string, unknown>;
    source_key: string;
    entity_id?: string | null;
    week?: number | null;
    payload_json?: unknown;
    payload_text?: string | null;
    http_status: number;
    notes?: string | null;
  }
) {
  const { error } = await supabase.from("flea_raw_global").upsert(
    {
      smoke_id: row.smoke_id,
      ingest_run_id: row.ingest_run_id,
      season_year: row.season_year,
      source_league_id: row.source_league_id,
      endpoint_group: row.endpoint_group,
      endpoint_name: row.endpoint_name,
      request_url: row.request_url,
      request_params: row.request_params ?? {},
      source_key: row.source_key,
      entity_id: row.entity_id ?? null,
      week: row.week ?? null,
      payload_format: "json",
      payload_json: row.payload_json ?? null,
      payload_text: row.payload_text ?? null,
      http_status: row.http_status,
      fetched_at: new Date().toISOString(),
      body_hash: sha256(row.payload_text ?? ""),
      notes: row.notes ?? null,
    },
    { onConflict: "source_key", ignoreDuplicates: false }
  );

  if (error) {
    throw new Error(`flea_raw_global upsert failed for ${row.source_key}: ${error.message}`);
  }
}

async function recordFetch(
  supabase: ReturnType<typeof getSupabaseAdmin>,
  ctx: {
    smokeId: string;
    ingestRunId: string;
    seasonYear: number;
    sourceLeagueId: string;
    counters: Record<string, number>;
  },
  fetchResult: SourceFetchResult,
  meta: {
    endpointGroup: string;
    endpointName: string;
    sourceKey: string;
    entityId?: string | null;
    week?: number | null;
    notes?: string | null;
  }
) {
  await upsertRawGlobalRow(supabase, {
    smoke_id: ctx.smokeId,
    ingest_run_id: ctx.ingestRunId,
    season_year: ctx.seasonYear,
    source_league_id: ctx.sourceLeagueId,
    endpoint_group: meta.endpointGroup,
    endpoint_name: meta.endpointName,
    request_url: fetchResult.requestUrl,
    request_params: fetchResult.requestParams,
    source_key: meta.sourceKey,
    entity_id: meta.entityId ?? null,
    week: meta.week ?? null,
    payload_json: fetchResult.bodyJson,
    payload_text: fetchResult.bodyText,
    http_status: fetchResult.status,
    notes: meta.notes ?? null,
  });

  ctx.counters[meta.endpointName] = (ctx.counters[meta.endpointName] ?? 0) + 1;
}

async function fetchAndStore(
  supabase: ReturnType<typeof getSupabaseAdmin>,
  ctx: {
    smokeId: string;
    ingestRunId: string;
    seasonYear: number;
    sourceLeagueId: string;
    counters: Record<string, number>;
  },
  config: {
    path: string;
    params: Record<string, string | number | boolean | undefined>;
    endpointGroup: string;
    endpointName: string;
    sourceKey: string;
    entityId?: string | null;
    week?: number | null;
    notes?: string | null;
  }
) {
  const result = await fetchFleaflicker(config.path, config.params);

  await recordFetch(supabase, ctx, result, {
    endpointGroup: config.endpointGroup,
    endpointName: config.endpointName,
    sourceKey: config.sourceKey,
    entityId: config.entityId,
    week: config.week,
    notes: config.notes,
  });

  if (!result.ok) {
    throw new Error(`${config.endpointName} failed (${result.status}) for ${config.sourceKey}`);
  }

  return result.bodyJson;
}

async function ingestPlayerListingPages(
  supabase: ReturnType<typeof getSupabaseAdmin>,
  ctx: {
    smokeId: string;
    ingestRunId: string;
    seasonYear: number;
    sourceLeagueId: string;
    counters: Record<string, number>;
  },
  week: number
) {
  let offset = 0;

  while (true) {
    const result = await fetchFleaflicker("/FetchPlayerListing", {
      league_id: ctx.sourceLeagueId,
      sort: "SORT_SCORING_PERIOD",
      sort_season: ctx.seasonYear,
      sort_period: week,
      result_offset: offset,
      external_id_type: "SPORTRADAR",
    });

    await recordFetch(supabase, ctx, result, {
      endpointGroup: "player_scores",
      endpointName: "FetchPlayerListing",
      sourceKey: `${ctx.seasonYear}:${ctx.sourceLeagueId}:player_listing:week:${week}:offset:${offset}`,
      week,
      notes: "Weekly player scoring listing paginated by result_offset",
    });

    if (!result.ok) {
      throw new Error(`FetchPlayerListing failed (${result.status}) at week ${week}, offset ${offset}`);
    }

    const body = asRecord(result.bodyJson);
    const players = Array.isArray(body.players) ? body.players : [];
    const nextOffset =
      typeof body.resultOffsetNext === "number"
        ? body.resultOffsetNext
        : typeof body.result_offset_next === "number"
        ? body.result_offset_next
        : null;

    if (players.length === 0) break;
    if (nextOffset === null || nextOffset <= offset) break;

    offset = nextOffset;

    if (offset > 200000) {
      throw new Error(`FetchPlayerListing pagination exceeded 200000 rows at week ${week}`);
    }
  }
}

async function runFleaJob(
  supabase: ReturnType<typeof getSupabaseAdmin>,
  seasonYear: number,
  sourceLeagueId: string,
  maxScoringPeriod: number,
  draftNumber?: number
) {
  const ingestRunId = crypto.randomUUID();

  const smokeInsert = await supabase
    .from("flea_raw_smoke")
    .insert({
      ingest_run_id: ingestRunId,
      season_year: seasonYear,
      source_league_id: sourceLeagueId,
      job_name: "fleaflicker_raw_ingest",
      status: "running",
      started_at: new Date().toISOString(),
      summary_json: {
        requested_job: { seasonYear, sourceLeagueId, maxScoringPeriod, draftNumber: draftNumber ?? null },
      },
    })
    .select("smoke_id")
    .single();

  if (smokeInsert.error || !smokeInsert.data) {
    throw new Error(`Failed to create flea_raw_smoke row: ${smokeInsert.error?.message}`);
  }

  const smokeId = smokeInsert.data.smoke_id as string;
  const counters: Record<string, number> = {};
  const teamIds = new Set<number>();
  const boxscoreIds = new Set<string>();

  const ctx = { smokeId, ingestRunId, seasonYear, sourceLeagueId, counters };

  try {
    await fetchAndStore(supabase, ctx, {
      path: "/FetchLeagueRules",
      params: { league_id: sourceLeagueId },
      endpointGroup: "league",
      endpointName: "FetchLeagueRules",
      sourceKey: `${seasonYear}:${sourceLeagueId}:rules`,
    });

    const standings = await fetchAndStore(supabase, ctx, {
      path: "/FetchLeagueStandings",
      params: { league_id: sourceLeagueId, season: seasonYear },
      endpointGroup: "league",
      endpointName: "FetchLeagueStandings",
      sourceKey: `${seasonYear}:${sourceLeagueId}:standings`,
    });

    for (const id of extractTeamIds(standings)) teamIds.add(id);

    await fetchAndStore(supabase, ctx, {
      path: "/FetchLeagueDraftBoard",
      params: { league_id: sourceLeagueId, season: seasonYear, draft_number: draftNumber ?? 0 },
      endpointGroup: "draft",
      endpointName: "FetchLeagueDraftBoard",
      sourceKey: `${seasonYear}:${sourceLeagueId}:draft_board:${draftNumber ?? 0}`,
    });

    for (let week = 1; week <= maxScoringPeriod; week++) {
      const rosters = await fetchAndStore(supabase, ctx, {
        path: "/FetchLeagueRosters",
        params: { league_id: sourceLeagueId, season: seasonYear, scoring_period: week },
        endpointGroup: "rosters",
        endpointName: "FetchLeagueRosters",
        sourceKey: `${seasonYear}:${sourceLeagueId}:rosters:week:${week}`,
        week,
      });

      for (const id of extractTeamIds(rosters)) teamIds.add(id);

      const scoreboard = await fetchAndStore(supabase, ctx, {
        path: "/FetchLeagueScoreboard",
        params: { league_id: sourceLeagueId, season: seasonYear, scoring_period: week },
        endpointGroup: "scoreboard",
        endpointName: "FetchLeagueScoreboard",
        sourceKey: `${seasonYear}:${sourceLeagueId}:scoreboard:week:${week}`,
        week,
      });

      const gameIds = extractGameIdsFromScoreboard(scoreboard);

      for (const gameId of gameIds) {
        if (boxscoreIds.has(`${week}:${gameId}`)) continue;
        boxscoreIds.add(`${week}:${gameId}`);

        await fetchAndStore(supabase, ctx, {
          path: "/FetchLeagueBoxscore",
          params: { league_id: sourceLeagueId, fantasy_game_id: gameId, scoring_period: week },
          endpointGroup: "boxscore",
          endpointName: "FetchLeagueBoxscore",
          sourceKey: `${seasonYear}:${sourceLeagueId}:boxscore:week:${week}:game:${gameId}`,
          entityId: gameId,
          week,
        });
      }

      await ingestPlayerListingPages(supabase, ctx, week);
    }

    for (const teamId of [...teamIds].sort((a, b) => a - b)) {
      await fetchAndStore(supabase, ctx, {
        path: "/FetchTeamPicks",
        params: { league_id: sourceLeagueId, team_id: teamId },
        endpointGroup: "draft",
        endpointName: "FetchTeamPicks",
        sourceKey: `${seasonYear}:${sourceLeagueId}:team_picks:team:${teamId}`,
        entityId: String(teamId),
      });
    }

    let offset = 0;
    while (true) {
      const result = await fetchFleaflicker("/FetchLeagueTransactions", {
        league_id: sourceLeagueId,
        result_offset: offset,
      });

      await recordFetch(supabase, ctx, result, {
        endpointGroup: "transactions",
        endpointName: "FetchLeagueTransactions",
        sourceKey: `${seasonYear}:${sourceLeagueId}:transactions:offset:${offset}`,
        notes: "Paginated raw transaction page",
      });

      if (!result.ok) {
        throw new Error(`FetchLeagueTransactions failed (${result.status}) at offset ${offset}`);
      }

      const body = asRecord(result.bodyJson);
      const items = Array.isArray(body.items) ? body.items : [];
      if (items.length === 0) break;

      offset += items.length;
      if (offset > 50000) {
        throw new Error("Transaction pagination exceeded 50,000 rows; stopping defensively.");
      }
    }

    const summary = {
      ingest_run_id: ingestRunId,
      season_year: seasonYear,
      source_league_id: sourceLeagueId,
      max_scoring_period: maxScoringPeriod,
      team_ids_found: [...teamIds].sort((a, b) => a - b),
      counts_by_endpoint: counters,
    };

    const smokeUpdate = await supabase
      .from("flea_raw_smoke")
      .update({
        status: "success",
        completed_at: new Date().toISOString(),
        summary_json: summary,
      })
      .eq("smoke_id", smokeId);

    if (smokeUpdate.error) {
      throw new Error(`Failed to finalize flea_raw_smoke row: ${smokeUpdate.error.message}`);
    }

    return summary;
  } catch (error: unknown) {
    await supabase
      .from("flea_raw_smoke")
      .update({
        status: "error",
        completed_at: new Date().toISOString(),
        error_text: error instanceof Error ? error.message : "Unknown FleaFlicker raw ingest error",
        summary_json: {
          ingest_run_id: ingestRunId,
          season_year: seasonYear,
          source_league_id: sourceLeagueId,
          max_scoring_period: maxScoringPeriod,
          counts_by_endpoint: counters,
          team_ids_found: [...teamIds].sort((a, b) => a - b),
        },
      })
      .eq("smoke_id", smokeId);

    throw error;
  }
}

export async function GET(req: NextRequest) {
  if (!(await isAdminRequest(req))) return NextResponse.json({ ok: false, error: "Unauthorized" }, { status: 401 });
  try {
    const url = new URL(req.url);

    const seasonYear = Number(url.searchParams.get("seasonYear"));
    const sourceLeagueId = url.searchParams.get("sourceLeagueId");
    const maxScoringPeriod = Number(url.searchParams.get("maxScoringPeriod"));
    const draftNumberRaw = url.searchParams.get("draftNumber");
    const draftNumber = draftNumberRaw ? Number(draftNumberRaw) : undefined;

    if (!Number.isInteger(seasonYear) || seasonYear < 1900 || seasonYear > 2100 || !sourceLeagueId || !/^\d{1,24}$/.test(sourceLeagueId) || !Number.isInteger(maxScoringPeriod) || maxScoringPeriod < 1 || maxScoringPeriod > 30) {
      return NextResponse.json(
        { ok: false, error: "Invalid or missing query params: seasonYear, sourceLeagueId, maxScoringPeriod" },
        { status: 400 }
      );
    }

    const supabase = getSupabaseAdmin();
    const summary = await runFleaJob(supabase, seasonYear, sourceLeagueId, maxScoringPeriod, draftNumber);

    return NextResponse.json({ ok: true, summary });
  } catch (error: unknown) {
    return NextResponse.json(
      { ok: false, error: error instanceof Error ? error.message : "Unknown FleaFlicker ingest error" },
      { status: 500 }
    );
  }
}
