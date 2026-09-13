import { isMissingDatabaseRelation } from "./session.ts";

export type FinalizeMembership = { league_id: string; roster_id: string; role: "member" | "commissioner" | "admin" };
type DbResult<T> = { data: T | null; error: { code?: string; message?: string } | null };

export type FinalizeAccessStore = {
  membership(userId: string, leagueId: string): Promise<DbResult<FinalizeMembership>>;
  legacyInvitation(email: string): Promise<DbResult<{ roster_id: string }>>;
  acceptInvitation(userId: string, email: string, leagueId: string): Promise<DbResult<FinalizeMembership>>;
};

export type FinalizeAccessResult =
  | { membership: FinalizeMembership; accepted: boolean; compatibility: boolean; error: null }
  | { membership: null; accepted: false; compatibility: false; error: "forbidden" | "unavailable" };

export async function resolveFinalizeAccess(
  store: FinalizeAccessStore,
  userId: string,
  email: string,
  leagueId: string,
): Promise<FinalizeAccessResult> {
  const current = await store.membership(userId, leagueId);
  if (current.data) return { membership: current.data, accepted: false, compatibility: false, error: null };

  if (isMissingDatabaseRelation(current.error, "league_memberships")) {
    const legacy = await store.legacyInvitation(email);
    if (legacy.error) return { membership: null, accepted: false, compatibility: false, error: "unavailable" };
    if (!legacy.data) return { membership: null, accepted: false, compatibility: false, error: "forbidden" };
    return { membership: { league_id: leagueId, roster_id: String(legacy.data.roster_id), role: "member" },
      accepted: false, compatibility: true, error: null };
  }
  if (current.error) return { membership: null, accepted: false, compatibility: false, error: "unavailable" };

  // Once memberships exist, the legacy map cannot grant access. Only an unused,
  // explicit invitation may atomically create a membership. Consumed/revoked
  // invitations return no row, so deleting membership is a durable revocation.
  const accepted = await store.acceptInvitation(userId, email, leagueId);
  if (accepted.error) return { membership: null, accepted: false, compatibility: false, error: "unavailable" };
  if (!accepted.data) return { membership: null, accepted: false, compatibility: false, error: "forbidden" };
  return { membership: accepted.data, accepted: true, compatibility: false, error: null };
}

export function sessionClaimsForAccess(access: FinalizeAccessResult, userId: string) {
  if (access.error || !access.membership) return null;
  return {
    userId, leagueId: access.membership.league_id,
    rosterId: access.membership.roster_id, role: access.membership.role,
  };
}
