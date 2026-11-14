import { fetchFleaflicker } from "@/infrastructure/ingest/source-http";
import { isAdminRequest } from "@/infrastructure/auth/admin";
import { NextRequest, NextResponse } from "next/server";
import { requireSupabaseAdminClient as getSupabaseAdmin } from "@/infrastructure/supabase/admin";
import crypto from "node:crypto";

export const runtime = "nodejs";
export const dynamic = "force-dynamic";



function sha256(input: string) {
  return crypto.createHash("sha256").update(input).digest("hex");
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

  const ids = [...new Set((data ?? []).map((x) => Number(x.source_team_id)).filter(Boolean))];

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
  } catch (error: unknown) {
    await supabase
      .from("flea_raw_smoke")
      .update({
        status: "error",
        completed_at: new Date().toISOString(),
        error_text: error instanceof Error ? error.message : "Unknown Flea FetchRoster ingest error",
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
  if (!(await isAdminRequest(req))) return NextResponse.json({ ok: false, error: "Unauthorized" }, { status: 401 });
  try {
    const url = new URL(req.url);

    const seasonYear = Number(url.searchParams.get("seasonYear"));
    const sourceLeagueId = url.searchParams.get("sourceLeagueId");
    const maxScoringPeriod = Number(url.searchParams.get("maxScoringPeriod"));

    if (!Number.isInteger(seasonYear) || seasonYear < 1900 || seasonYear > 2100 || !sourceLeagueId || !/^\d{1,24}$/.test(sourceLeagueId) || !Number.isInteger(maxScoringPeriod) || maxScoringPeriod < 1 || maxScoringPeriod > 30) {
      return NextResponse.json(
        {
          ok: false,
          error: "Invalid or missing query params: seasonYear, sourceLeagueId, maxScoringPeriod",
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
  } catch (error: unknown) {
    return NextResponse.json(
      { ok: false, error: error instanceof Error ? error.message : "Unknown Flea FetchRoster ingest error" },
      { status: 500 }
    );
  }
}
