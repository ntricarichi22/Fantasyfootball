export type FinalizeMembership = { league_id: string; roster_id: string; role: "member" | "commissioner" | "admin" };
type DbResult<T> = { data: T | null; error: { code?: string; message?: string } | null };

export type FinalizeAccessStore = {
  membership(userId: string, leagueId: string): Promise<DbResult<FinalizeMembership>>;
  acceptInvitation(userId: string, email: string, leagueId: string): Promise<DbResult<FinalizeMembership>>;
};

export type FinalizeAccessResult =
  | { membership: FinalizeMembership; accepted: boolean; error: null }
  | { membership: null; accepted: false; error: "forbidden" | "unavailable" };

export async function resolveFinalizeAccess(
  store: FinalizeAccessStore,
  userId: string,
  email: string,
  leagueId: string,
): Promise<FinalizeAccessResult> {
  const current = await store.membership(userId, leagueId);
  if (current.data) return { membership: current.data, accepted: false, error: null };

  if (current.error) return { membership: null, accepted: false, error: "unavailable" };

  // Once memberships exist, the legacy map cannot grant access. Only an unused,
  // explicit invitation may atomically create a membership. Consumed/revoked
  // invitations return no row, so deleting membership is a durable revocation.
  const accepted = await store.acceptInvitation(userId, email, leagueId);
  if (accepted.error) return { membership: null, accepted: false, error: "unavailable" };
  if (!accepted.data) return { membership: null, accepted: false, error: "forbidden" };
  return { membership: accepted.data, accepted: true, error: null };
}

export function sessionClaimsForAccess(access: FinalizeAccessResult, userId: string, sessionId: string) {
  if (access.error || !access.membership) return null;
  return {
    userId, sessionId, leagueId: access.membership.league_id,
    rosterId: access.membership.roster_id, role: access.membership.role,
  };
}
