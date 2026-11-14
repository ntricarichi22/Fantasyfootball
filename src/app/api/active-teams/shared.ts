import { currentAppSessionFromRequest } from "@/infrastructure/auth/currentSession";
import { boundedJson } from "@/infrastructure/auth/boundedJson";
import { ACTIVE_TEAM_TIMEOUT_MS } from "@/infrastructure/identity/activeTeams";
export { getSupabaseAdminClient } from "@/infrastructure/supabase/admin";

export const SESSION_TIMEOUT_MS = ACTIVE_TEAM_TIMEOUT_MS;

export const activeCutoffIso = () => new Date(Date.now() - SESSION_TIMEOUT_MS).toISOString();

export async function presenceIdentity(request: Request) {
  const { session } = await currentAppSessionFromRequest(request);
  if (!session) return null;
  const body = await boundedJson<{ leagueId?: unknown; rosterId?: unknown; sessionId?: unknown }>(request, 4096);
  if (!body || typeof body.sessionId !== "string" || !body.sessionId || body.sessionId.length > 128) return null;
  if ((body.leagueId !== undefined && body.leagueId !== session.leagueId) ||
      (body.rosterId !== undefined && String(body.rosterId) !== session.rosterId)) return null;
  return { leagueId: session.leagueId, rosterId: session.rosterId, sessionId: body.sessionId };
}
