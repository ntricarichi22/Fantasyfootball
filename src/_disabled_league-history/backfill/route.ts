/**
 * POST /api/admin/league-history/backfill
 *
 * Walks the full `previous_league_id` chain from the configured (or supplied)
 * league ID and syncs every historical season into the Supabase warehouse.
 *
 * Safe to rerun — all writes are idempotent UPSERTs.
 *
 * Auth: x-admin-secret header  OR  ?secret= query param  OR  Bearer CRON_SECRET
 *
 * Query params:
 *   league_id  – override the starting league (default: NEXT_PUBLIC_SLEEPER_LEAGUE_ID)
 *   full_chain – "false" to sync only the supplied league_id, default "true"
 */

import { NextRequest, NextResponse } from "next/server";
import { getSupabaseAdminClient } from "@/lib/supabaseAdmin";
import { fetchLeagueChain, type DebugCall } from "@/lib/sleeperApi";
import { syncLeagueSeason } from "@/lib/leagueHistorySync";
import { LEAGUE_ID } from "@/lib/config";

export const dynamic = "force-dynamic";
export const runtime = "nodejs";
export const maxDuration = 300;

function isAuthorized(request: NextRequest): boolean {
  const cronSecret = process.env.CRON_SECRET;
  const authHeader = request.headers.get("authorization");
  const isVercelCron = !!(cronSecret && authHeader === `Bearer ${cronSecret}`);

  const secret =
    request.headers.get("x-admin-secret") ??
    request.nextUrl.searchParams.get("secret");
  const expected = process.env.ADMIN_REFRESH_SECRET;
  const isAdmin = !!(expected && secret === expected);

  return isVercelCron || isAdmin;
}

async function handler(request: NextRequest) {
  if (!isAuthorized(request)) {
    return NextResponse.json({ error: "Unauthorized" }, { status: 401 });
  }

  const { client, error: clientError } = getSupabaseAdminClient();
  if (!client) {
    return NextResponse.json(
      { error: clientError ?? "Missing Supabase configuration" },
      { status: 500 },
    );
  }

  const queryLeagueId = request.nextUrl.searchParams.get("league_id")?.trim() ?? null;
  const envLeagueId = process.env.NEXT_PUBLIC_SLEEPER_LEAGUE_ID?.trim() ?? null;
  const configLeagueId = LEAGUE_ID || null;
  const startingLeagueId = queryLeagueId ?? envLeagueId;

  console.log(
    `[league-history/backfill] query_league_id="${queryLeagueId}" env_league_id="${envLeagueId}" config_league_id="${configLeagueId}" resolved_league_id="${startingLeagueId}"`,
  );

  if (request.nextUrl.searchParams.get("debug") === "1") {
    return NextResponse.json({
      query_league_id: queryLeagueId,
      env_league_id: envLeagueId,
      config_league_id: configLeagueId,
      resolved_league_id: startingLeagueId ?? null,
    });
  }

  if (request.nextUrl.searchParams.get("debug") === "2") {
    if (!startingLeagueId) {
      return NextResponse.json({ error: "Missing league_id" }, { status: 400 });
    }
    const debugCalls: DebugCall[] = [];
    const chain = await fetchLeagueChain(startingLeagueId, debugCalls);
    return NextResponse.json({
      route_resolved_league_id: startingLeagueId,
      chain_length: chain.length,
      league_ids_in_chain: chain.map((l) => l.league_id),
      calls: debugCalls,
    });
  }

  if (!startingLeagueId) {
    return NextResponse.json(
      { error: "Missing league_id" },
      { status: 400 },
    );
  }

  const fullChain =
    (request.nextUrl.searchParams.get("full_chain") ?? "true") !== "false";

  try {
    // Collect league IDs to sync.
    let leagueIds: string[];

    if (fullChain) {
      const chain = await fetchLeagueChain(startingLeagueId);
      leagueIds = chain.map((l) => l.league_id);
    } else {
      leagueIds = [startingLeagueId];
    }

    // Sync each season sequentially to avoid hammering the Sleeper API.
    const results = [];
    for (const leagueId of leagueIds) {
      const summary = await syncLeagueSeason(client, leagueId);
      results.push(summary);
    }

    const errors = results.filter((r) => r.error);
    return NextResponse.json({
      ok: errors.length === 0,
      seasons_synced: results.length,
      results,
      ...(errors.length > 0 ? { partial_errors: errors.length } : {}),
    });
  } catch (err) {
    console.error("[league-history/backfill] unexpected error:", err);
    return NextResponse.json(
      { error: err instanceof Error ? err.message : "Unexpected error" },
      { status: 500 },
    );
  }
}

export const GET = handler;
export const POST = handler;
