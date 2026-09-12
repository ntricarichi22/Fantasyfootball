import type { AppSession } from "./session";

export type MembershipSnapshot = { league_id?: unknown; roster_id?: unknown; role?: unknown } | null;

export function resolveCurrentSession(
  signed: AppSession,
  userExists: boolean,
  membership: MembershipSnapshot,
  stateAvailable = true,
) {
  if (!stateAvailable) return { session: null, error: "auth_state_unavailable" as const };
  if (!userExists || !membership) return { session: null, error: "not_authenticated" as const };
  if (typeof membership.league_id !== "string" ||
      (typeof membership.roster_id !== "string" && typeof membership.roster_id !== "number") ||
      !["member", "commissioner", "admin"].includes(String(membership.role))) {
    return { session: null, error: "auth_state_unavailable" as const };
  }
  return {
    session: {
      ...signed,
      leagueId: membership.league_id,
      rosterId: String(membership.roster_id),
      role: String(membership.role) as AppSession["role"],
    },
    error: null,
  };
}

export const currentSessionCanActForRoster = (session: AppSession, leagueId: string, rosterId: string) =>
  session.leagueId === leagueId && session.rosterId === rosterId;

export const currentSessionCanAccessTeamPair = (
  session: AppSession,
  leagueId: string,
  teamA: string,
  teamB: string,
) => session.leagueId === leagueId && (session.rosterId === teamA || session.rosterId === teamB);
