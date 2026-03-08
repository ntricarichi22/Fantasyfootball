import { NextRequest, NextResponse } from "next/server";
import { createClient } from "@supabase/supabase-js";
import crypto from "node:crypto";

export const runtime = "nodejs";
export const dynamic = "force-dynamic";

const FLEA_BASE_URL = "https://www.fleaflicker.com/api";
const FLEA_SPORT = process.env.FLEAFLICKER_SPORT ?? "NFL";

type FleaJob = {
  seasonYear: number;
  sourceLeagueId: string;
  maxScoringPeriod: number; // include playoffs
  draftNumber?: number;     // optional, defaults to latest
};

type FleaFetchResult = {
  ok: boolean;
  status: number;
  requestUrl: string;
  requestParams: Record<string, string | number | boolean>;
  bodyText: string;
  bodyJson: any | null;
};

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
): Promise<FleaFetchResult> {
  const merged = {
    sport: FLEA_SPORT,
    ...params,
  };

  const requestUrl = buildUrl(path, merged);

  const res = await fetch(requestUrl, {
    method: "GET",
    headers: {
      accept: "application/json",
    },
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

function extractTeamIds(payload: any): number[] {
  const ids = new Set<number>();

  const walk = (node: any) => {
    if (!node || typeof node !== "object") return;

    if (
      typeof node.id === "number" &&
      typeof node.name === "string" &&
      (
        Array.isArray(node.owners) ||
        node.record_overall ||
        node.record_postseason ||
        node.logo_url
      )
    ) {
      ids.add(node.id);
    }

    if (Array.isArray(node)) {
      for (const item of node) walk(item);
      return;
    }

    for (const value of Object.values(node)) {
      walk(value);
    }
  };

  walk(payload);
  return [...ids];
}

function extractGameIdsFromScoreboard(payload: any): string[] {
  const ids = new Set<string>();

  const walk = (node: any) => {
    if (!node || typeof node !== "object") return;

    if (
      node &&
      typeof node.id !== "undefined" &&
      (node.away || node.home)
    ) {
      ids.add(String(node.id));
    }

    if (Array.isArray(node)) {
      for (const item of node) walk(item);
      return;
    }

    for (const value of Object.values(node)) {
      walk(value);
    }
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
    {
      onConflict: "source_key",
      ignoreDuplicates: false,
    }
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
  fetchResult: FleaFetchResult,
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

async function runFleaJob(
  supabase: ReturnType<typeof getSupabaseAdmin>,
  job: FleaJob
) {
  const ingestRunId = crypto.randomUUID();

  const smokeInsert = await supabase
    .from("flea_raw_smoke")
    .insert({
      ingest_run_id: ingestRunId,
      season_year: job.seasonYear,
      source_league_id: job.sourceLeagueId,
      job_name: "fleaflicker_raw_ingest",
      status: "running",
      started_at: new Date().toISOString(),
      summary_json: {
        requested_job: job,
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

  const ctx = {
    smokeId,
    ingestRunId,
    seasonYear: job.seasonYear,
    sourceLeagueId: job.sourceLeagueId,
    counters,
  };

  try {
    // 1) Rules
    await fetchAndStore(supabase, ctx, {
      path: "/FetchLeagueRules",
      params: {
        league_id: job.sourceLeagueId,
      },
      endpointGroup: "league",
      endpointName: "FetchLeagueRules",
      sourceKey: `${job.seasonYear}:${job.sourceLeagueId}:rules`,
    });

    // 2) Standings
    const standings = await fetchAndStore(supabase, ctx, {
      path: "/FetchLeagueStandings",
      params: {
        league_id: job.sourceLeagueId,
        season: job.seasonYear,
      },
      endpointGroup: "league",
      endpointName: "FetchLeagueStandings",
      sourceKey: `${job.seasonYear}:${job.sourceLeagueId}:standings`,
    });

    for (const id of extractTeamIds(standings)) {
      teamIds.add(id);
    }

    // 3) Draft board
    await fetchAndStore(supabase, ctx, {
      path: "/FetchLeagueDraftBoard",
      params: {
        league_id: job.sourceLeagueId,
        season: job.seasonYear,
        draft_number: job.draftNumber ?? 0,
      },
      endpointGroup: "draft",
      endpointName: "FetchLeagueDraftBoard",
      sourceKey: `${job.seasonYear}:${job.sourceLeagueId}:draft_board:${job.draftNumber ?? 0}`,
    });

    // 4) Weekly rosters + scoreboard + boxscores
    for (let week = 1; week <= job.maxScoringPeriod; week++) {
      const rosters = await fetchAndStore(supabase, ctx, {
        path: "/FetchLeagueRosters",
        params: {
          league_id: job.sourceLeagueId,
          season: job.seasonYear,
          scoring_period: week,
        },
        endpointGroup: "rosters",
        endpointName: "FetchLeagueRosters",
        sourceKey: `${job.seasonYear}:${job.sourceLeagueId}:rosters:week:${week}`,
        week,
      });

      for (const id of extractTeamIds(rosters)) {
        teamIds.add(id);
      }

      const scoreboard = await fetchAndStore(supabase, ctx, {
        path: "/FetchLeagueScoreboard",
        params: {
          league_id: job.sourceLeagueId,
          season: job.seasonYear,
          scoring_period: week,
        },
        endpointGroup: "scoreboard",
        endpointName: "FetchLeagueScoreboard",
        sourceKey: `${job.seasonYear}:${job.sourceLeagueId}:scoreboard:week:${week}`,
        week,
      });

      const gameIds = extractGameIdsFromScoreboard(scoreboard);

      for (const gameId of gameIds) {
        if (boxscoreIds.has(`${week}:${gameId}`)) continue;
        boxscoreIds.add(`${week}:${gameId}`);

        await fetchAndStore(supabase, ctx, {
          path: "/FetchLeagueBoxscore",
          params: {
            league_id: job.sourceLeagueId,
            fantasy_game_id: gameId,
            scoring_period: week,
          },
          endpointGroup: "boxscore",
          endpointName: "FetchLeagueBoxscore",
          sourceKey: `${job.seasonYear}:${job.sourceLeagueId}:boxscore:week:${week}:game:${gameId}`,
          entityId: gameId,
          week,
        });
      }
    }

    // 5) Team future picks
    for (const teamId of [...teamIds].sort((a, b) => a - b)) {
      await fetchAndStore(supabase, ctx, {
        path: "/FetchTeamPicks",
        params: {
          league_id: job.sourceLeagueId,
          team_id: teamId,
        },
        endpointGroup: "draft",
        endpointName: "FetchTeamPicks",
        sourceKey: `${job.seasonYear}:${job.sourceLeagueId}:team_picks:team:${teamId}`,
        entityId: String(teamId),
      });
    }

    // 6) Paginated transactions
    let offset = 0;

    while (true) {
      const result = await fetchFleaflicker("/FetchLeagueTransactions", {
        league_id: job.sourceLeagueId,
        result_offset: offset,
      });

      await recordFetch(supabase, ctx, result, {
        endpointGroup: "transactions",
        endpointName: "FetchLeagueTransactions",
        sourceKey: `${job.seasonYear}:${job.sourceLeagueId}:transactions:offset:${offset}`,
        notes: "Paginated raw transaction page",
      });

      if (!result.ok) {
        throw new Error(`FetchLeagueTransactions failed (${result.status}) at offset ${offset}`);
      }

      const items = Array.isArray(result.bodyJson?.items) ? result.bodyJson.items : [];
      if (items.length === 0) break;

      offset += items.length;

      // defensive stop
      if (offset > 50000) {
        throw new Error("Transaction pagination exceeded 50,000 rows; stopping defensively.");
      }
    }

    const summary = {
      ingest_run_id: ingestRunId,
      season_year: job.seasonYear,
      source_league_id: job.sourceLeagueId,
      max_scoring_period: job.maxScoringPeriod,
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
  } catch (error: any) {
    await supabase
      .from("flea_raw_smoke")
      .update({
        status: "error",
        completed_at: new Date().toISOString(),
        error_text: error?.message ?? "Unknown FleaFlicker raw ingest error",
        summary_json: {
          ingest_run_id: ingestRunId,
          season_year: job.seasonYear,
          source_league_id: job.sourceLeagueId,
          max_scoring_period: job.maxScoringPeriod,
          counts_by_endpoint: counters,
          team_ids_found: [...teamIds].sort((a, b) => a - b),
        },
      })
      .eq("smoke_id", smokeId);

    throw error;
  }
}

export async function POST(req: NextRequest) {
  try {
    const adminToken = process.env.INGEST_ADMIN_TOKEN;
    if (adminToken) {
      const provided = req.headers.get("x-admin-token");
      if (provided !== adminToken) {
        return NextResponse.json({ error: "Unauthorized" }, { status: 401 });
      }
    }

    const body = await req.json();
    const jobs = Array.isArray(body?.jobs) ? (body.jobs as FleaJob[]) : [];

    if (jobs.length === 0) {
      return NextResponse.json(
        { error: "Body must include jobs[]" },
        { status: 400 }
      );
    }

    for (const job of jobs) {
      if (!job.seasonYear || !job.sourceLeagueId || !job.maxScoringPeriod) {
        return NextResponse.json(
          {
            error:
              "Each job must include seasonYear, sourceLeagueId, and maxScoringPeriod",
          },
          { status: 400 }
        );
      }
    }

    const supabase = getSupabaseAdmin();
    const summaries = [];

    for (const job of jobs) {
      const summary = await runFleaJob(supabase, job);
      summaries.push(summary);
    }

    return NextResponse.json({
      ok: true,
      summaries,
    });
  } catch (error: any) {
    return NextResponse.json(
      {
        ok: false,
        error: error?.message ?? "Unknown FleaFlicker ingest error",
      },
      { status: 500 }
    );
  }
}
