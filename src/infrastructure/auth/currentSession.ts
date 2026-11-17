import "server-only";
import { getSupabaseAdminClient } from "../supabase/admin.ts";
import { appSessionFromRequest, type AppSession } from "./session.ts";
import { resolveCurrentSession, requestMatchesActiveLeague, requestMatchesActiveIdentity } from "./authorization.ts";
import { currentFailoverConfig, failoverSessionAllowed } from "../failover/config.ts";
export { currentSessionCanActForRoster, currentSessionCanAccessTeamPair } from "./authorization.ts";

export type CurrentSessionResult =
  | { session: AppSession; error: null }
  | { session: null; error: "not_authenticated" | "auth_state_unavailable" | "league_context_changed" | "identity_context_changed" };

export type CurrentSessionDependencies = {
  readSignedSession: typeof appSessionFromRequest;
  getAdminClient: typeof getSupabaseAdminClient;
};

const defaultDependencies: CurrentSessionDependencies = {
  readSignedSession: appSessionFromRequest,
  getAdminClient: getSupabaseAdminClient,
};

/**
 * Revalidate mutable authorization state on every protected server operation.
 * The signed cookie proves who originally authenticated; the membership row is
 * authoritative for the user's current league, roster and role.
 */
export async function currentAppSessionFromRequest(
  request: Request,
  dependencies: CurrentSessionDependencies = defaultDependencies,
): Promise<CurrentSessionResult> {
  const signed = await dependencies.readSignedSession(request);
  if (!signed) return { session: null, error: "not_authenticated" };
  if (!failoverSessionAllowed(currentFailoverConfig(), signed)) return { session: null, error: "auth_state_unavailable" };
  if (!requestMatchesActiveLeague(request, signed)) return { session: null, error: "league_context_changed" };

  // Local-only impersonation identities deliberately have no auth/membership
  // rows. Never honor this escape hatch in production.
  if (process.env.NODE_ENV !== "production" && signed.userId.startsWith("dev:")) {
    return requestMatchesActiveIdentity(request, signed)
      ? { session: { ...signed, role: "member" }, error: null }
      : { session: null, error: "identity_context_changed" };
  }

  const { client } = dependencies.getAdminClient();
  if (!client) return { session: null, error: "auth_state_unavailable" };

  const [{ data: userData, error: userError }, { data, error }, providerSession] = await Promise.all([
    client.auth.admin.getUserById(signed.userId),
    client.from("league_memberships")
      .select("league_id, roster_id, role")
      .eq("user_id", signed.userId)
      .eq("league_id", signed.leagueId)
      .maybeSingle(),
    client.rpc("is_auth_session_active", { p_session_id: signed.sessionId, p_user_id: signed.userId }),
  ]);
  const resolved = resolveCurrentSession(signed, Boolean(userData.user), data, !(userError || error || providerSession.error), providerSession.data === true, request);
  if (resolved.session && !failoverSessionAllowed(currentFailoverConfig(), resolved.session)) return { session: null, error: "auth_state_unavailable" };
  return resolved;
}
