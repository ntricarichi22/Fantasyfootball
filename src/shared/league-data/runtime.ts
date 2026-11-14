import "server-only";
import { requireSupabaseAdminClient } from "@/infrastructure/supabase/admin";
import { leagueCacheKey } from "@/infrastructure/identity/leagueScope";
import type { LeagueRuntime } from "./runtimeProjection";
export { runtimeDraftStatus, runtimePickOwnership, runtimeDraftSlots, runtimeDraftClock } from "./runtimeProjection";
export type { LeagueRuntime } from "./runtimeProjection";

/** One SQL snapshot excludes every unrevealed pick, including the caller's own.
 * Viewer-specific projections must never enter a league-wide cache. */
export async function getLeagueRuntime(leagueId: string): Promise<LeagueRuntime> {
  leagueCacheKey("runtime", leagueId);
  const { data, error } = await requireSupabaseAdminClient().rpc("cfc_get_league_runtime_public", { p_league_id: leagueId });
  if (error) throw new Error("League ownership is unavailable");
  if (!data || typeof data !== "object" || typeof data.initialized !== "boolean" || !Number.isSafeInteger(data.revision) || data.revision < 0
    || (data.initialized && (!Array.isArray(data.roster_ids) || !data.roster_ids.length || !Array.isArray(data.assets) || !Array.isArray(data.slots)))) {
    throw new Error("Invalid league ownership snapshot");
  }
  return data as LeagueRuntime;
}
