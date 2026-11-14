import { createHash } from "node:crypto";
import { NextResponse } from "next/server";
import { registeredMachineLeague } from "@/infrastructure/auth/admin";
import { commandError } from "@/infrastructure/auth/leagueCommand";
import { getSupabaseAdminClient } from "@/infrastructure/supabase/admin";
import { buildRuntimeSourceSnapshot, invalidateLeagueData } from "@/shared/league-data";

export const dynamic = "force-dynamic";

/** Reconcile only an explicit, registered league from a fresh trusted source snapshot. */
export async function GET(request: Request) {
  const leagueId = await registeredMachineLeague(request);
  if (!leagueId) return NextResponse.json({ error: "registered_league_required" }, { status: 403 });
  const { client } = getSupabaseAdminClient();
  if (!client) return NextResponse.json({ error: "runtime_unavailable" }, { status: 503 });
  const before = await client.rpc("cfc_get_league_runtime_public", { p_league_id: leagueId });
  if (before.error) return commandError(before.error);
  const snapshot = await buildRuntimeSourceSnapshot(leagueId);
  const hash = createHash("sha256").update(JSON.stringify([leagueId, before.data.revision, snapshot.observed_at])).digest("hex");
  const requestId = `${hash.slice(0, 8)}-${hash.slice(8, 12)}-4${hash.slice(13, 16)}-8${hash.slice(17, 20)}-${hash.slice(20, 32)}`;
  const result = await client.rpc("cfc_refresh_runtime_snapshot_system", {
    p_league_id: leagueId, p_request_id: requestId, p_expected_revision: before.data.revision, p_snapshot: snapshot,
  });
  if (result.error) return commandError(result.error);
  invalidateLeagueData(leagueId);
  return NextResponse.json(result.data);
}
