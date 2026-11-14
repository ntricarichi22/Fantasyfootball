import { dueDraftDeadline } from "@/infrastructure/auth/draftDeadline";
import { createHash } from "node:crypto";
import { NextResponse } from "next/server";
import { registeredMachineLeague } from "@/infrastructure/auth/admin";
import { commandError } from "@/infrastructure/auth/leagueCommand";
import { getSupabaseAdminClient } from "@/infrastructure/supabase/admin";
import { invalidateLeagueData } from "@/shared/league-data";

export const dynamic = "force-dynamic";

async function tick(request: Request) {
  const leagueId = await registeredMachineLeague(request);
  if (!leagueId) return NextResponse.json({ error: "registered_league_required" }, { status: 403 });
  const { client } = getSupabaseAdminClient();
  if (!client) return NextResponse.json({ error: "runtime_unavailable" }, { status: 503 });
  const snapshot = await client.rpc("cfc_get_league_runtime_public", { p_league_id: leagueId });
  if (snapshot.error) return commandError(snapshot.error);
  const state = snapshot.data?.draft_state;
  const deadline = dueDraftDeadline(state);
  if (deadline === null) {
    return NextResponse.json({ ok: true, data: state ?? null, revision: snapshot.data?.revision ?? 0, status: "not_ready", steps: 0 });
  }
  // Retries of the same observed due revision use the same command identity.
  const hash = createHash("sha256").update(JSON.stringify([leagueId, snapshot.data.revision, deadline])).digest("hex");
  const requestId = `${hash.slice(0, 8)}-${hash.slice(8, 12)}-4${hash.slice(13, 16)}-8${hash.slice(17, 20)}-${hash.slice(20, 32)}`;
  const result = await client.rpc("cfc_tick_due_draft", {
    p_league_id: leagueId, p_request_id: requestId, p_expected_revision: snapshot.data.revision,
  });
  if (result.error) return commandError(result.error);
  invalidateLeagueData(leagueId);
  return NextResponse.json(result.data);
}

export const GET = tick;
export const POST = tick;
