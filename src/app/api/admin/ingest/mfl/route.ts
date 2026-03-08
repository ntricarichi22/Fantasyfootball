import { NextRequest, NextResponse } from "next/server";
import { createClient } from "@supabase/supabase-js";
import crypto from "node:crypto";

export const runtime = "nodejs";
export const dynamic = "force-dynamic";

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

function buildUrl(seasonYear: number, params: Record<string, string | number | boolean | undefined>) {
  const url = new URL(`http://football.myfantasyleague.com/${seasonYear}/export`);
  for (const [key, value] of Object.entries(params)) {
    if (value === undefined || value === null) continue;
    url.searchParams.append(key, String(value));
  }
  return url.toString();
}

async function fetchMfl(
  seasonYear: number,
  params: Record<string, string | number | boolean | undefined>
) {
  const requestUrl = buildUrl(seasonYear, params);

  const res = await fetch(requestUrl, {
    method: "GET",
    headers: {
      accept: "application/xml,text/xml,text/plain,*/*",
    },
    cache: "no-store",
  });

  const bodyText = await res.text();

  return {
    ok: res.ok,
    status: res.status,
    requestUrl,
    requestParams: Object.fromEntries(
      Object.entries(params).filter(([, v]) => v !== undefined && v !== null)
    ) as Record<string, string | number | boolean>,
    bodyText,
  };
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
      payload_format: "xml",
      payload_json: null,
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

async function recordFetch(
  supabase: ReturnType<typeof getSupabaseAdmin>,
  ctx: {
    smokeId: string;
    ingestRunId: string;
    seasonYear: number;
    sourceLeagueId: string;
    counters: Record<string, number>;
  },
  fetchResult: any,
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
    params: Record<string, string | number | boolean | undefined>;
    endpointGroup: string;
    endpointName: string;
    sourceKey: string;
    entityId?: string | null;
    week?: number | null;
    notes?: string | null;
  }
) {
  const result = await fetchMfl(ctx.seasonYear, config.params);

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

  return result.bodyText;
}

async function runMflJob(
  supabase: ReturnType<typeof getSupabaseAdmin>,
  seasonYear: number,
  sourceLeagueId: string,
  maxScoringPeriod: number
) {
  const ingestRunId = crypto.randomUUID();

  const smokeInsert = await supabase
    .from("mfl_raw_smoke")
    .insert({
      ingest_run_id: ingestRunId,
      season_year: seasonYear,
      source_league_id: sourceLeagueId,
      job_name: "mfl_raw_ingest",
      status: "running",
      started_at: new Date().toISOString(),
      summary_json: {
        requested_job: { seasonYear, sourceLeagueId, maxScoringPeriod },
      },
    })
    .select("smoke_id")
    .single();

  if (smokeInsert.error || !smokeInsert.data) {
    throw new Error(`Failed to create mfl_raw_smoke row: ${smokeInsert.error?.message}`);
  }

  const smokeId = smokeInsert.data.smoke_id as string;
  const counters: Record<string, number> = {};
  const ctx = { smokeId, ingestRunId, seasonYear, sourceLeagueId, counters };

  try {
    await fetchAndStore(supabase, ctx, {
      params: { TYPE: "league", L: sourceLeagueId },
      endpointGroup: "league",
      endpointName: "league",
      sourceKey: `${seasonYear}:${sourceLeagueId}:league`,
    });

    await fetchAndStore(supabase, ctx, {
      params: { TYPE: "leagueStandings", L: sourceLeagueId },
      endpointGroup: "league",
      endpointName: "leagueStandings",
      sourceKey: `${seasonYear}:${sourceLeagueId}:league_standings`,
    });

    await fetchAndStore(supabase, ctx, {
      params: { TYPE: "rosters", L: sourceLeagueId },
      endpointGroup: "rosters",
      endpointName: "rosters",
      sourceKey: `${seasonYear}:${sourceLeagueId}:rosters`,
    });

    await fetchAndStore(supabase, ctx, {
      params: { TYPE: "draftResults", L: sourceLeagueId },
      endpointGroup: "draft",
      endpointName: "draftResults",
      sourceKey: `${seasonYear}:${sourceLeagueId}:draft_results`,
    });

    await fetchAndStore(supabase, ctx, {
      params: { TYPE: "futureDraftPicks", L: sourceLeagueId },
      endpointGroup: "draft",
      endpointName: "futureDraftPicks",
      sourceKey: `${seasonYear}:${sourceLeagueId}:future_draft_picks`,
    });

    await fetchAndStore(supabase, ctx, {
      params: { TYPE: "playoffBrackets", L: sourceLeagueId },
      endpointGroup: "playoffs",
      endpointName: "playoffBrackets",
      sourceKey: `${seasonYear}:${sourceLeagueId}:playoff_brackets`,
    });

    await fetchAndStore(supabase, ctx, {
      params: { TYPE: "transactions", L: sourceLeagueId, COUNT: 5000 },
      endpointGroup: "transactions",
      endpointName: "transactions",
      sourceKey: `${seasonYear}:${sourceLeagueId}:transactions`,
      notes: "Requested COUNT=5000 as a high ceiling for single-season history",
    });

    for (let week = 1; week <= maxScoringPeriod; week++) {
      await fetchAndStore(supabase, ctx, {
        params: { TYPE: "weeklyResults", L: sourceLeagueId, W: week },
        endpointGroup: "weeklyResults",
        endpointName: "weeklyResults",
        sourceKey: `${seasonYear}:${sourceLeagueId}:weekly_results:week:${week}`,
        week,
      });
    }

    const summary = {
      ingest_run_id: ingestRunId,
      season_year: seasonYear,
      source_league_id: sourceLeagueId,
      max_scoring_period: maxScoringPeriod,
      counts_by_endpoint: counters,
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
        error_text: error?.message ?? "Unknown MFL raw ingest error",
        summary_json: {
          ingest_run_id: ingestRunId,
          season_year: seasonYear,
          source_league_id: sourceLeagueId,
          max_scoring_period: maxScoringPeriod,
          counts_by_endpoint: counters,
        },
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
    const maxScoringPeriod = Number(url.searchParams.get("maxScoringPeriod"));

    if (!seasonYear || !sourceLeagueId || !maxScoringPeriod) {
      return NextResponse.json(
        {
          ok: false,
          error: "Missing required query params: seasonYear, sourceLeagueId, maxScoringPeriod",
        },
        { status: 400 }
      );
    }

    const supabase = getSupabaseAdmin();

    const summary = await runMflJob(
      supabase,
      seasonYear,
      sourceLeagueId,
      maxScoringPeriod
    );

    return NextResponse.json({
      ok: true,
      summary,
    });
  } catch (error: any) {
    return NextResponse.json(
      {
        ok: false,
        error: error?.message ?? "Unknown MFL ingest error",
      },
      { status: 500 }
    );
  }
}
