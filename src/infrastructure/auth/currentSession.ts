import "server-only";
import { getSupabaseAdminClient } from "@/infrastructure/supabase/admin";
import { appSessionFromRequest, type AppSession } from "./session";
import { resolveCurrentSession } from "./authorization";
export { currentSessionCanActForRoster, currentSessionCanAccessTeamPair } from "./authorization";

export type CurrentSessionResult =
  | { session: AppSession; error: null }
  | { session: null; error: "not_authenticated" | "auth_state_unavailable" };

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

  // Local-only impersonation identities deliberately have no auth/membership
  // rows. Never honor this escape hatch in production.
  if (process.env.NODE_ENV !== "production" && signed.userId.startsWith("dev:")) {
    return { session: { ...signed, role: "member" }, error: null };
  }

  const { client } = dependencies.getAdminClient();
  if (!client) return { session: null, error: "auth_state_unavailable" };

  const [{ data: userData, error: userError }, { data, error }] = await Promise.all([
    client.auth.admin.getUserById(signed.userId),
    client.from("league_memberships")
      .select("league_id, roster_id, role")
      .eq("user_id", signed.userId)
      .eq("league_id", signed.leagueId)
      .maybeSingle(),
  ]);
  return resolveCurrentSession(signed, Boolean(userData.user), data, !(userError || error));
}
