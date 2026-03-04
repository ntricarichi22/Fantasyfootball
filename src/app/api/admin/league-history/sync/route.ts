/**
 * POST /api/admin/league-history/sync
 *
 * Refreshes data for the current season only.  Use this for regular
 * ongoing updates (rosters, matchups, transactions, traded picks, etc.).
 *
 * Safe to rerun — all writes are idempotent UPSERTs.
 *
 * Auth: x-admin-secret header  OR  ?secret= query param  OR  Bearer CRON_SECRET
 *
 * Query params:
 *   league_id – override the league to sync (default: NEXT_PUBLIC_SLEEPER_LEAGUE_ID)
 */

import { NextRequest, NextResponse } from "next/server";
import { getSupabaseAdminClient } from "@/lib/supabaseAdmin";
import { fetchLeague } from "@/lib/sleeperApi";
import { syncLeagueSeason } from "@/lib/leagueHistorySync";
import { LEAGUE_ID } from "@/lib/config";

export const dynamic = "force-dynamic";
export const runtime = "nodejs";
export const maxDuration = 120;

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
  const leagueId = queryLeagueId ?? envLeagueId;

  console.log(
    `[league-history/sync] query_league_id="${queryLeagueId}" env_league_id="${envLeagueId}" config_league_id="${configLeagueId}" resolved_league_id="${leagueId}"`,
  );

  if (request.nextUrl.searchParams.get("debug") === "1") {
    return NextResponse.json({
      query_league_id: queryLeagueId,
      env_league_id: envLeagueId,
      config_league_id: configLeagueId,
      resolved_league_id: leagueId ?? null,
    });
  }

  if (request.nextUrl.searchParams.get("debug") === "2") {
    if (!leagueId) {
      return NextResponse.json({ error: "Missing league_id" }, { status: 400 });
    }
    const endpoint = `/league/${leagueId}`;
    console.log(`[league-history/sync debug=2] fetchLeague league_id="${leagueId}" endpoint="${endpoint}"`);
    const league = await fetchLeague(leagueId);
    return NextResponse.json({
      route_resolved_league_id: leagueId,
      calls: [
        { fn: "syncLeagueSeason→fetchLeague", league_id: leagueId, endpoint },
      ],
      league_name: league.name,
      league_season: league.season,
      league_status: league.status,
      previous_league_id: league.previous_league_id ?? null,
    });
  }

  if (!leagueId) {
    return NextResponse.json(
      { error: "Missing league_id" },
      { status: 400 },
    );
  }

  try {
    const summary = await syncLeagueSeason(client, leagueId);

    return NextResponse.json({
      ok: !summary.error,
      ...summary,
    });
  } catch (err) {
    console.error("[league-history/sync] unexpected error:", err);
    return NextResponse.json(
      { error: err instanceof Error ? err.message : "Unexpected error" },
      { status: 500 },
    );
  }
}

export const GET = handler;
export const POST = handler;
