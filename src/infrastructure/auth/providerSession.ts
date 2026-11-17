import "server-only";
import { getSupabaseAdminClient } from "../supabase/admin.ts";
import { providerSessionIdFromVerifiedToken } from "./session.ts";
import { currentFailoverConfig, failoverIdentityAllowed } from "../failover/config.ts";

/** Verify the provider token and current session before selecting an application league. */
export async function verifiedProviderSession(request: Request) {
  const failover = currentFailoverConfig();
  if (failover.mode === "blocked" || failover.mode === "maintenance") return { error: "maintenance", status: 503 } as const;
  const authorization = request.headers.get("authorization") ?? "";
  const token = authorization.startsWith("Bearer ") ? authorization.slice(7) : "";
  if (!token) return { error: "reauthentication_required", status: 401 } as const;
  const { client } = getSupabaseAdminClient();
  if (!client) return { error: "auth_state_unavailable", status: 503 } as const;
  const { data, error } = await client.auth.getUser(token);
  if (error || !data.user) return { error: "invalid_session", status: 401 } as const;
  if (!failoverIdentityAllowed(failover, data.user.id)) return { error: "maintenance", status: 503 } as const;
  const sessionId = providerSessionIdFromVerifiedToken(token, data.user.id);
  if (!sessionId) return { error: "invalid_session", status: 401 } as const;
  const active = await client.rpc("is_auth_session_active", { p_session_id: sessionId, p_user_id: data.user.id });
  if (active.error) return { error: "auth_state_unavailable", status: 503 } as const;
  if (active.data !== true) return { error: "invalid_session", status: 401 } as const;
  return { error: null, client, user: data.user, sessionId, token } as const;
}

export async function availableLeagueChoices(provider: Extract<Awaited<ReturnType<typeof verifiedProviderSession>>, { error: null }>) {
  const email = provider.user.email?.trim().toLowerCase();
  const [memberships, invitations] = await Promise.all([
    provider.client.from("league_memberships").select("league_id,roster_id,role").eq("user_id", provider.user.id),
    provider.client.from("league_invitations").select("league_id,roster_id").eq("email", email ?? "")
      .eq("state", "active").is("accepted_by", null),
  ]);
  if (memberships.error || invitations.error) return null;
  const choices = new Map<string, { leagueId: string; rosterId: string; role: string }>();
  for (const row of invitations.data ?? []) choices.set(row.league_id, { leagueId: row.league_id, rosterId: row.roster_id, role: "member" });
  for (const row of memberships.data ?? []) choices.set(row.league_id, { leagueId: row.league_id, rosterId: row.roster_id, role: row.role });
  const failover = currentFailoverConfig();
  return [...choices.values()].filter((choice) => failoverIdentityAllowed(failover, provider.user.id, choice.leagueId))
    .sort((a, b) => a.leagueId.localeCompare(b.leagueId));
}
