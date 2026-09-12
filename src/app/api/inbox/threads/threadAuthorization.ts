import type { AppSession } from "@/infrastructure/auth/session";

export function canCreateThread(
  session: AppSession,
  leagueId: string,
  teamA: string,
  teamB: string,
  claimedCreator: string,
) {
  return session.leagueId === leagueId && teamA !== teamB &&
    claimedCreator === session.rosterId &&
    (teamA === session.rosterId || teamB === session.rosterId);
}
