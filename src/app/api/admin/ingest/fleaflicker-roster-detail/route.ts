import { NextRequest, NextResponse } from "next/server";
import { createClient } from "@supabase/supabase-js";
import crypto from "node:crypto";

export const runtime = "nodejs";
export const dynamic = "force-dynamic";

const FLEA_BASE_URL = "https://www.fleaflicker.com/api";
const FLEA_SPORT = process.env.FLEAFLICKER_SPORT ?? "NFL";

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

function buildUrl(path: string, params: Record<string, string | number | boolean | undefined>) {
  const url = new URL(`${FLEA_BASE_URL}${path}`);
  for (const [key, value] of Object.entries(params)) {
    if (value === undefined || value === null) continue;
    url.searchParams.append(key, String(value));
  }
  return url.toString();
}

async function fetchFleaflicker(
  path: string,
  params: Record<string, string | number | boolean | undefined>
) {
  const merged = {
    sport: FLEA_SPORT,
    ...params,
  };

  const requestUrl = buildUrl(path, merged);

  const res = await fetch(requestUrl, {
    method: "GET",
    headers: { accept: "application/json" },
    cache: "no-store",
  });

  const bodyText = await res.text();
  const bodyJson = safeJsonParse(bodyText);

  return {
    ok: res.ok,
    status: res.status,
    requestUrl,
    requestParams: Object.fromEntries(
      Object.entries(merged).filter(([, v]) => v !== undefined && v !== null)
    ) as Record<string, string | number | boolean>,
    bodyText,
    bodyJson,
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
    payload_json?: any | null;
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

async function getSeasonTeamIds(
  supabase: ReturnType<typeof getSupabaseAdmin>,
  seasonYear: number,
  sourceLeagueId: string
) {
  const { data, error } = await supabase
    .from("flea_mirror_teams")
    .select("source_team_id")
    .eq("season_year", seasonYear)
    .eq("source_league_id", sourceLeagueId)
    .order("source_team_id", { ascending: true });

  if (error) {
    throw new Error(`Failed to load Flea team ids from flea_mirror_teams: ${error.message}`);
  }

  const ids = [...new Set((data ?? []).map((x: any) => Number(x.source_team_id)).filter(Boolean))];

  if (ids.length === 0) {
    throw new Error(
      `No team ids found in flea_mirror_teams for season ${seasonYear} league ${sourceLeagueId}`
    );
  }

  return ids;
}

async function runRosterDetailJob(
  supabase: ReturnType<typeof getSupabaseAdmin>,
  seasonYear: number,
  sourceLeagueId: string,
  maxScoringPeriod: number
) {
  const ingestRunId = crypto.randomUUID();

  const smokeInsert = await supabase
    .from("flea_raw_smoke")
    .insert({
      ingest_run_id: ingestRunId,
      season_year: seasonYear,
      source_league_id: sourceLeagueId,
      job_name: "fleaflicker_fetch_roster_detail_ingest",
      status: "running",
      started_at: new Date().toISOString(),
      summary_json: {
        requested_job: { seasonYear, sourceLeagueId, maxScoringPeriod },
      },
    })
    .select("smoke_id")
    .single();

  if (smokeInsert.error || !smokeInsert.data) {
    throw new Error(`Failed to create flea_raw_smoke row: ${smokeInsert.error?.message}`);
  }

  const smokeId = smokeInsert.data.smoke_id as string;
  const teamIds = await getSeasonTeamIds(supabase, seasonYear, sourceLeagueId);

  let fetchRosterCount = 0;

  try {
    for (let week = 1; week <= maxScoringPeriod; week++) {
      for (const teamId of teamIds) {
        const result = await fetchFleaflicker("/FetchRoster", {
          league_id: sourceLeagueId,
          team_id: teamId,
          season: seasonYear,
          scoring_period: week,
          external_id_type: "SPORTRADAR",
        });

        const sourceKey = `${seasonYear}:${sourceLeagueId}:fetch_roster:week:${week}:team:${teamId}`;

        await upsertRawGlobalRow(supabase, {
          smoke_id: smokeId,
          ingest_run_id: ingestRunId,
          season_year: seasonYear,
          source_league_id: sourceLeagueId,
          endpoint_group: "roster_detail",
          endpoint_name: "FetchRoster",
          request_url: result.requestUrl,
          request_params: result.requestParams,
          source_key: sourceKey,
          entity_id: String(teamId),
          week,
          payload_json: result.bodyJson,
          payload_text: result.bodyText,
          http_status: result.status,
          notes: "Team-by-team weekly roster detail for lineup slot / starter-bench extraction",
        });

        if (!result.ok) {
          throw new Error(`FetchRoster failed (${result.status}) for week ${week}, team ${teamId}`);
        }

        fetchRosterCount += 1;
      }
    }

    const summary = {
      ingest_run_id: ingestRunId,
      season_year: seasonYear,
      source_league_id: sourceLeagueId,
      max_scoring_period: maxScoringPeriod,
      team_ids_found: teamIds,
      counts_by_endpoint: {
        FetchRoster: fetchRosterCount,
      },
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
  } catch (error: any) {
    await supabase
      .from("flea_raw_smoke")
      .update({
        status: "error",
        completed_at: new Date().toISOString(),
        error_text: error?.message ?? "Unknown Flea FetchRoster ingest error",
        summary_json: {
          ingest_run_id: ingestRunId,
          season_year: seasonYear,
          source_league_id: sourceLeagueId,
          max_scoring_period: maxScoringPeriod,
          team_ids_found: teamIds,
          counts_by_endpoint: {
            FetchRoster: fetchRosterCount,
          },
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
    const summary = await runRosterDetailJob(
      supabase,
      seasonYear,
      sourceLeagueId,
      maxScoringPeriod
    );

    return NextResponse.json({ ok: true, summary });
  } catch (error: any) {
    return NextResponse.json(
      { ok: false, error: error?.message ?? "Unknown Flea FetchRoster ingest error" },
      { status: 500 }
    );
  }
}
