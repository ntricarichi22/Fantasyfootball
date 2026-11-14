import { NextRequest, NextResponse } from "next/server";
import { currentAppSessionFromRequest } from "@/infrastructure/auth/currentSession";
import { boundedJson } from "@/infrastructure/auth/boundedJson";
import { commandEnvelope, commandError, executeLeagueCommand } from "@/infrastructure/auth/leagueCommand";
import { getSupabaseAdminClient } from "@/infrastructure/supabase/admin";
import { getLeagueData } from "@/shared/league-data";
import { resolveDraftLogNames } from "./resolveNames";

export const dynamic = "force-dynamic";

export async function GET(request: NextRequest) {
  const { session } = await currentAppSessionFromRequest(request);
  if (!session) return NextResponse.json({ error: "not_authenticated" }, { status: 401 });
  const includeUnannounced = request.nextUrl.searchParams.get("includeUnannounced") === "1";
  if (includeUnannounced && !["commissioner", "admin"].includes(session.role)) return NextResponse.json({ error: "forbidden" }, { status: 403 });
  const requestedSeason = request.nextUrl.searchParams.get("season");
  const season = requestedSeason === null ? null : Number(requestedSeason);
  if (season !== null && (!Number.isSafeInteger(season) || season < 2000 || season > 2200)) {
    return NextResponse.json({ error: "invalid_draft_season" }, { status: 400 });
  }
  const { client } = getSupabaseAdminClient();
  if (!client) return NextResponse.json({ error: "runtime_unavailable" }, { status: 503 });
  // Rows and revision come from one database snapshot, including the visibility predicate.
  const { data, error } = await client.rpc("cfc_get_draft_log", {
    p_league_id: session.leagueId, p_actor_user_id: session.userId, p_session_id: session.sessionId,
    p_draft_season: season, p_include_unannounced: includeUnannounced,
  });
  if (error) return commandError(error);
  if (!data || !Array.isArray(data.data)) return NextResponse.json({ error: "draft_log_unavailable" }, { status: 503 });
  const league = await getLeagueData(session.leagueId);
  const resolved = "error" in league ? data.data : data.data.map((row: Parameters<typeof resolveDraftLogNames>[0]) => resolveDraftLogNames(row, league.teams, league.players));
  return NextResponse.json({ data: resolved, revision: data.revision });

}

export async function POST(request: Request) {
  const { session } = await currentAppSessionFromRequest(request);
  if (!session) return NextResponse.json({ error: "not_authenticated" }, { status: 401 });
  const body = await boundedJson<Record<string, unknown>>(request, 16384);
  if (!body || typeof body !== "object" || Array.isArray(body)) return NextResponse.json({ error: "invalid_json" }, { status: 400 });
  const envelope = commandEnvelope(body);
  if (!envelope || !Number.isSafeInteger(body.pickIndex) || Number(body.pickIndex) < 0 ||
      !Number.isSafeInteger(body.draft_season) || typeof body.playerId !== "string" || !/^[A-Za-z0-9_-]{1,64}$/.test(body.playerId) ||
      typeof body.rosterId !== "string") return NextResponse.json({ error: "invalid_draft_command" }, { status: 400 });
  return executeLeagueCommand(session, "cfc_submit_draft_pick", envelope, {
    p_draft_season: body.draft_season, p_pick_index: body.pickIndex, p_acting_roster_id: body.rosterId, p_player_id: body.playerId,
  });
}

export async function DELETE(request: Request) {
  const { session } = await currentAppSessionFromRequest(request);
  if (!session) return NextResponse.json({ error: "not_authenticated" }, { status: 401 });
  const body = await boundedJson<Record<string, unknown>>(request, 8192);
  const envelope = body && commandEnvelope(body);
  if (!body || !envelope || !Number.isSafeInteger(body.pickIndex) || Number(body.pickIndex) < 0) return NextResponse.json({ error: "invalid_draft_command" }, { status: 400 });
  return executeLeagueCommand(session, "cfc_draft_command", envelope, { p_action: "undo", p_options: { pick_index: body.pickIndex } });
}
