/**
 * GET/POST /api/admin/sleeper-flatten
 *
 * Phase B — flatten from raw.
 *
 * Reads the stored slp_raw_* payloads and transforms them into the queryable
 * slp_* mirror tables.  Does NOT call the Sleeper API.
 *
 * Run /api/admin/sleeper-ingest (Phase A) before this route.
 *
 * Query params:
 *   league_id   – override the starting league (default: NEXT_PUBLIC_SLEEPER_LEAGUE_ID)
 *   full_chain  – "false" to flatten only the supplied league_id (default "true")
 *   players     – "true" to also flatten the slp_raw_players_nfl snapshot into
 *                 slp_players (default "false")
 *   dry_run     – "1" to return a preflight report without writing anything
 *
 * Auth: x-admin-secret header  OR  ?secret= query param  OR  Bearer CRON_SECRET
 *
 * Safe to rerun — all writes are idempotent UPSERTs.
 */

import { NextRequest, NextResponse } from "next/server";
import { getSupabaseAdminClient } from "@/lib/supabaseAdmin";
import { LEAGUE_ID } from "@/lib/config";
import {
  flattenLeagueSeasonFromRaw,
  flattenLeagueChainFromRaw,
  flattenNflPlayersFromRaw,
  preflightFlattenFromRaw,
} from "@/lib/sleeperIngest";

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

  const params = request.nextUrl.searchParams;
  const queryLeagueId = params.get("league_id")?.trim() ?? null;
  const envLeagueId = process.env.NEXT_PUBLIC_SLEEPER_LEAGUE_ID?.trim() ?? null;
  const startingLeagueId = queryLeagueId ?? envLeagueId ?? (LEAGUE_ID || null);

  const fullChain = (params.get("full_chain") ?? "true") !== "false";
  const flattenPlayers = params.get("players") === "true";
  const dryRun = params.get("dry_run") === "1";

  console.log(
    `[sleeper-flatten] phase=B starting_league_id="${startingLeagueId}" full_chain=${fullChain} flatten_players=${flattenPlayers} dry_run=${dryRun}`,
  );

  if (!startingLeagueId) {
    return NextResponse.json(
      { error: "Missing league_id. Set NEXT_PUBLIC_SLEEPER_LEAGUE_ID or pass ?league_id=." },
      { status: 400 },
    );
  }

  // ── Dry-run / preflight mode ───────────────────────────────────────────────
  if (dryRun) {
    try {
      const preflight = await preflightFlattenFromRaw(client, startingLeagueId);
      return NextResponse.json({
        ok: preflight.ok,
        dry_run: true,
        phase: "B",
        note: "No data was written to Supabase. Remove ?dry_run=1 to run Phase B flatten.",
        preflight,
      });
    } catch (err) {
      return NextResponse.json(
        { error: err instanceof Error ? err.message : "Unexpected preflight error" },
        { status: 500 },
      );
    }
  }

  // ── Live flatten ───────────────────────────────────────────────────────────
  try {
    const leagueResults = fullChain
      ? await flattenLeagueChainFromRaw(client, startingLeagueId)
      : [await flattenLeagueSeasonFromRaw(client, startingLeagueId)];

    const playerResult = flattenPlayers ? await flattenNflPlayersFromRaw(client) : null;

    const errors = leagueResults.filter((r) => r.error);

    return NextResponse.json({
      ok: errors.length === 0,
      phase: "B",
      note: "Flatten complete. slp_* tables have been populated from slp_raw_* data.",
      leagues_flattened: leagueResults.length,
      leagues: leagueResults,
      players: playerResult,
      errors: errors.length > 0 ? errors : undefined,
    });
  } catch (err) {
    console.error("[sleeper-flatten] unexpected error:", err);
    return NextResponse.json(
      { error: err instanceof Error ? err.message : "Unexpected error" },
      { status: 500 },
    );
  }
}

export const GET = handler;
export const POST = handler;
