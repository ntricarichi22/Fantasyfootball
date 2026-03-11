import { NextRequest, NextResponse } from "next/server";
import { createClient } from "@supabase/supabase-js";
import crypto from "node:crypto";

export const runtime = "nodejs";
export const dynamic = "force-dynamic";

const MFL_BATCH_SIZE = 200;

function getSupabaseAdmin() {
  const url = process.env.NEXT_PUBLIC_SUPABASE_URL;
  const key = process.env.SUPABASE_SERVICE_ROLE_KEY;

  if (!url || !key) {
    throw new Error("Missing NEXT_PUBLIC_SUPABASE_URL or SUPABASE_SERVICE_ROLE_KEY");
  }

  return createClient(url, key, {
    auth: { persistSession: false, autoRefreshToken: false },
  });
}

function sha256(input: string) {
  return crypto.createHash("sha256").update(input).digest("hex");
}

function safeJsonParse(text: string) {
  try {
    return JSON.parse(text);
  } catch {
    return null;
  }
}

function buildUrl(
  seasonYear: number,
  params: Record<string, string | number | boolean | undefined>
) {
  const url = new URL(`https://api.myfantasyleague.com/${seasonYear}/export`);

  for (const [key, value] of Object.entries(params)) {
    if (value === undefined || value === null) continue;
    url.searchParams.append(key, String(value));
  }

  url.searchParams.append("JSON", "1");

  return url.toString();
}

async function fetchMfl(
  seasonYear: number,
  params: Record<string, string | number | boolean | undefined>
) {
  const requestUrl = buildUrl(seasonYear, params);

  const controller = new AbortController();
  const timeout = setTimeout(() => controller.abort(), 30000);

  try {
    const res = await fetch(requestUrl, {
      method: "GET",
      headers: {
        accept: "application/json,text/plain,*/*",
      },
      cache: "no-store",
      signal: controller.signal,
    });

    const bodyText = await res.text();
    const bodyJson = safeJsonParse(bodyText);

    return {
      ok: res.ok,
      status: res.status,
      requestUrl,
      requestParams: {
        ...Object.fromEntries(
          Object.entries(params).filter(([, v]) => v !== undefined && v !== null)
        ),
        JSON: 1,
      } as Record<string, string | number | boolean>,
      bodyText,
      bodyJson,
    };
  } finally {
    clearTimeout(timeout);
  }
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
    request_params: Record<string, any>;
    source_key: string;
    entity_id?: string | null;
    week?: number | null;
    payload_json?: any | null;
    payload_text?: string | null;
    http_status: number;
    notes?: string | null;
  }
) {
  const { error } = await supabase.from("mfl_raw_global").upsert(
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
    throw new Error(`mfl_raw_global upsert failed for ${row.source_key}: ${error.message}`);
  }
}

function chunkArray<T>(items: T[], size: number): T[][] {
  const out: T[][] = [];
  for (let i = 0; i < items.length; i += size) {
    out.push(items.slice(i, i + size));
  }
  return out;
}

async function getLeaguePlayerIds(
  supabase: ReturnType<typeof getSupabaseAdmin>,
  seasonYear: number,
  sourceLeagueId: string
) {
  const lineup = await supabase
    .from("mfl_mirror_lineup_entries")
    .select("source_player_id")
    .eq("season_year", seasonYear)
    .eq("source_league_id", sourceLeagueId);

  if (lineup.error) {
    throw new Error(`Failed to read mfl_mirror_lineup_entries: ${lineup.error.message}`);
  }

  const roster = await supabase
    .from("mfl_mirror_rosters_current")
    .select("source_player_id")
    .eq("season_year", seasonYear)
    .eq("source_league_id", sourceLeagueId);

  if (roster.error) {
    throw new Error(`Failed to read mfl_mirror_rosters_current: ${roster.error.message}`);
  }

  const ids = new Set<string>();

  for (const row of lineup.data ?? []) {
    if (row?.source_player_id) ids.add(String(row.source_player_id));
  }

  for (const row of roster.data ?? []) {
    if (row?.source_player_id) ids.add(String(row.source_player_id));
  }

  const sorted = [...ids].sort((a, b) => {
    const an = Number(a);
    const bn = Number(b);
    if (!Number.isNaN(an) && !Number.isNaN(bn)) return an - bn;
    return a.localeCompare(b);
  });

  if (sorted.length === 0) {
    throw new Error(`No MFL player ids found for season ${seasonYear} league ${sourceLeagueId}`);
  }

  return sorted;
}

async function runMflPlayersJob(
  supabase: ReturnType<typeof getSupabaseAdmin>,
  seasonYear: number,
  sourceLeagueId: string
) {
  const ingestRunId = crypto.randomUUID();

  const smokeInsert = await supabase
    .from("mfl_raw_smoke")
    .insert({
      ingest_run_id: ingestRunId,
      season_year: seasonYear,
      source_league_id: sourceLeagueId,
      job_name: "mfl_players_ingest",
      status: "running",
      started_at: new Date().toISOString(),
      summary_json: {
        requested_job: { seasonYear, sourceLeagueId },
      },
    })
    .select("smoke_id")
    .single();

  if (smokeInsert.error || !smokeInsert.data) {
    throw new Error(`Failed to create mfl_raw_smoke row: ${smokeInsert.error?.message}`);
  }

  const smokeId = smokeInsert.data.smoke_id as string;

  try {
    const playerIds = await getLeaguePlayerIds(supabase, seasonYear, sourceLeagueId);
    const batches = chunkArray(playerIds, MFL_BATCH_SIZE);

    let playersBatchCount = 0;

    for (let i = 0; i < batches.length; i++) {
      const batch = batches[i];
      const batchNo = i + 1;

      const result = await fetchMfl(seasonYear, {
        TYPE: "players",
        PLAYERS: batch.join(","),
        DETAILS: 1,
      });

      const sourceKey = `${seasonYear}:${sourceLeagueId}:players:batch:${batchNo}`;

      await upsertRawGlobalRow(supabase, {
        smoke_id: smokeId,
        ingest_run_id: ingestRunId,
        season_year: seasonYear,
        source_league_id: sourceLeagueId,
        endpoint_group: "players",
        endpoint_name: "players",
        request_url: result.requestUrl,
        request_params: result.requestParams,
        source_key: sourceKey,
        entity_id: null,
        week: null,
        payload_json: result.bodyJson,
        payload_text: result.bodyText,
        http_status: result.status,
        notes: `MFL players metadata batch ${batchNo} of ${batches.length}`,
      });

      if (!result.ok) {
        throw new Error(`MFL players batch ${batchNo} failed (${result.status})`);
      }

      playersBatchCount += 1;
    }

    const summary = {
      ingest_run_id: ingestRunId,
      season_year: seasonYear,
      source_league_id: sourceLeagueId,
      distinct_player_ids: playerIds.length,
      batch_size: MFL_BATCH_SIZE,
      counts_by_endpoint: {
        players: playersBatchCount,
      },
    };

    const smokeUpdate = await supabase
      .from("mfl_raw_smoke")
      .update({
        status: "success",
        completed_at: new Date().toISOString(),
        summary_json: summary,
      })
      .eq("smoke_id", smokeId);

    if (smokeUpdate.error) {
      throw new Error(`Failed to finalize mfl_raw_smoke row: ${smokeUpdate.error.message}`);
    }

    return summary;
  } catch (error: any) {
    await supabase
      .from("mfl_raw_smoke")
      .update({
        status: "error",
        completed_at: new Date().toISOString(),
        error_text: error?.message ?? "Unknown MFL players ingest error",
      })
      .eq("smoke_id", smokeId);

    throw error;
  }
}

export async function GET(req: NextRequest) {
  try {
    const url = new URL(req.url);

    const token = url.searchParams.get("token");
    const adminSecret = process.env.ADMIN_SECRET;

    if (!adminSecret || token !== adminSecret) {
      return NextResponse.json({ ok: false, error: "Unauthorized" }, { status: 401 });
    }

    const seasonYear = Number(url.searchParams.get("seasonYear"));
    const sourceLeagueId = url.searchParams.get("sourceLeagueId");

    if (!seasonYear || !sourceLeagueId) {
      return NextResponse.json(
        {
          ok: false,
          error: "Missing required query params: seasonYear, sourceLeagueId",
        },
        { status: 400 }
      );
    }

    const supabase = getSupabaseAdmin();
    const summary = await runMflPlayersJob(
      supabase,
      seasonYear,
      sourceLeagueId
    );

    return NextResponse.json({
      ok: true,
      summary,
    });
  } catch (error: any) {
    return NextResponse.json(
      {
        ok: false,
        error: error?.message ?? "Unknown MFL players ingest error",
      },
      { status: 500 }
    );
  }
}
