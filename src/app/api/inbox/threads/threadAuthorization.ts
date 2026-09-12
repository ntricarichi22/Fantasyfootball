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

export async function authorizeThreadCreation(
  session: AppSession, leagueId: string, teamA: string, teamB: string, creator: string,
  lookupParticipants: (leagueId: string, teamIds: string[]) => Promise<string[] | null>,
) {
  if (!canCreateThread(session, leagueId, teamA, teamB, creator)) return false;
  const participants = await lookupParticipants(leagueId, [teamA, teamB]);
  return Boolean(participants && participants.includes(teamA) && participants.includes(teamB));
}
