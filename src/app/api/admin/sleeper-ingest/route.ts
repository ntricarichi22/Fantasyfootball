/**
 * GET/POST /api/admin/sleeper-ingest
 *
 * Phase A — raw ingest only.
 *
 * Fetches the Sleeper league chain and all related endpoints, storing the full
 * API payloads into slp_raw_* tables.  Does NOT write to any flattened slp_*
 * tables.  Run /api/admin/sleeper-flatten (Phase B) after this succeeds.
 *
 * Query params:
 *   league_id   – override the starting league (default: NEXT_PUBLIC_SLEEPER_LEAGUE_ID)
 *   full_chain  – "false" to ingest only the supplied league_id (default "true")
 *   players     – "true" to also ingest the /players/nfl endpoint (default "false",
 *                 because that payload is ~5 MB and takes extra time)
 *   debug       – "1" to return a dry-run payload preview without writing
 *
 * Auth: x-admin-secret header  OR  ?secret= query param  OR  Bearer CRON_SECRET
 *
 * Safe to rerun — all writes are idempotent UPSERTs.
 */

import { NextRequest, NextResponse } from "next/server";
import { getSupabaseAdminClient } from "@/lib/supabaseAdmin";
import { LEAGUE_ID } from "@/lib/config";
import {
  rawIngestLeagueSeason,
  rawIngestLeagueChain,
  rawIngestNflPlayers,
  debugLeaguePayload,
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
  const ingestPlayers = params.get("players") === "true";
  const debugMode = params.get("debug") === "1";

  console.log(
    `[sleeper-ingest] phase=A starting_league_id="${startingLeagueId}" full_chain=${fullChain} ingest_players=${ingestPlayers} debug=${debugMode}`,
  );

  if (!startingLeagueId) {
    return NextResponse.json(
      { error: "Missing league_id. Set NEXT_PUBLIC_SLEEPER_LEAGUE_ID or pass ?league_id=." },
      { status: 400 },
    );
  }

  // ── Debug / dry-run mode ───────────────────────────────────────────────────
  if (debugMode) {
    try {
      const preview = await debugLeaguePayload(client, startingLeagueId);
      return NextResponse.json({
        ok: true,
        dry_run: true,
        phase: "A",
        note: "No data was written to Supabase. Remove ?debug=1 to run Phase A raw ingest.",
        ...preview,
      });
    } catch (err) {
      return NextResponse.json(
        { error: err instanceof Error ? err.message : "Unexpected debug error" },
        { status: 500 },
      );
    }
  }

  try {
    const leagueResults = fullChain
      ? await rawIngestLeagueChain(client, startingLeagueId)
      : [await rawIngestLeagueSeason(client, startingLeagueId)];

    const playerResult = ingestPlayers ? await rawIngestNflPlayers(client) : null;

    const errors = leagueResults.filter((r) => r.error);

    return NextResponse.json({
      ok: errors.length === 0,
      phase: "A",
      note: "Raw ingest complete. Run /api/admin/sleeper-flatten to populate flattened tables (Phase B).",
      leagues_ingested: leagueResults.length,
      leagues: leagueResults,
      players: playerResult,
      errors: errors.length > 0 ? errors : undefined,
    });
  } catch (err) {
    console.error("[sleeper-ingest] unexpected error:", err);
    return NextResponse.json(
      { error: err instanceof Error ? err.message : "Unexpected error" },
      { status: 500 },
    );
  }
}

export const GET = handler;
export const POST = handler;
