import type { AppSession } from "./session";

export type MembershipSnapshot = { league_id?: unknown; roster_id?: unknown; role?: unknown } | null;

export function resolveCurrentSession(
  signed: AppSession,
  userExists: boolean,
  membership: MembershipSnapshot,
  stateAvailable = true,
  providerSessionActive = false,
  request?: Request,
) {
  if (!stateAvailable) return { session: null, error: "auth_state_unavailable" as const };
  if (!userExists || !membership || !providerSessionActive) return { session: null, error: "not_authenticated" as const };
  if (typeof membership.league_id !== "string" ||
      (typeof membership.roster_id !== "string" && typeof membership.roster_id !== "number") ||
      !["member", "commissioner", "admin"].includes(String(membership.role))) {
    return { session: null, error: "auth_state_unavailable" as const };
  }
  const session: AppSession = {
    ...signed,
    leagueId: membership.league_id,
    rosterId: String(membership.roster_id),
    role: String(membership.role) as AppSession["role"],
  };
  if (request && !requestMatchesActiveIdentity(request, session)) return { session: null, error: "identity_context_changed" as const };
  return { session, error: null };

}

export const currentSessionCanActForRoster = (session: AppSession, leagueId: string, rosterId: string) =>
  session.leagueId === leagueId && session.rosterId === rosterId;

export const currentSessionCanAccessTeamPair = (
  session: AppSession,
  leagueId: string,
  teamA: string,
  teamB: string,
) => session.leagueId === leagueId && (session.rosterId === teamA || session.rosterId === teamB);

/** The client context asserts which open league UI issued a request; it never grants membership. */
export function requestMatchesActiveLeague(request: Request, session: AppSession): boolean {
  const expected = request.headers.get("x-cfc-league-id");
  if (expected !== null && expected !== session.leagueId) return false;
  const url = new URL(request.url);
  const mutation = !["GET", "HEAD", "OPTIONS"].includes(request.method);
  return !mutation || !url.pathname.startsWith("/api/") || url.pathname.startsWith("/api/auth/") || expected === session.leagueId;
}

/** Compare the open UI's identity with LIVE membership, including roster changes. */
export function requestMatchesActiveIdentity(request: Request, session: AppSession): boolean {
  if (!requestMatchesActiveLeague(request, session)) return false;
  const userId = request.headers.get("x-cfc-user-id");
  const rosterId = request.headers.get("x-cfc-roster-id");
  if ((userId !== null && userId !== session.userId) || (rosterId !== null && rosterId !== session.rosterId)) return false;
  const path = new URL(request.url).pathname;
  const required = !["GET", "HEAD", "OPTIONS"].includes(request.method) && path.startsWith("/api/") && !path.startsWith("/api/auth/");
  return !required || (userId === session.userId && rosterId === session.rosterId);
}
