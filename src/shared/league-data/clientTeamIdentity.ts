// League-scoped client identity. Provider failures cannot substitute another league.
import { ttlMemo } from "@/infrastructure/ttlCache";
import { leagueCacheKey } from "@/infrastructure/identity/leagueScope";
import { leagueFetch } from "@/infrastructure/identity/leagueRequest";

export type ClientTeamIdentity = {
  rosterId: string; teamName: string; baseSlug: string; crestUrl: string;
  gmAvatarUrl: string; hasCustomLogo: boolean; color: string | null;
};
const snapshots = new Map<string, ClientTeamIdentity[]>();
export function fetchTeamIdentities(leagueId: string): Promise<ClientTeamIdentity[]> {
  return ttlMemo(leagueCacheKey("client-identity", leagueId), 30_000, async () => {
    const response = await leagueFetch(leagueId, "/api/team-identity");
    if (!response.ok) throw new Error("Team identity is unavailable");
    const json = await response.json();
    if (!Array.isArray(json.teams)) throw new Error("Invalid team identity response");
    const teams = (json.teams as ClientTeamIdentity[]).map(team => ({ ...team, rosterId: String(team.rosterId) }));
    snapshots.set(leagueId, teams);
    return teams;
  });
}
export function teamColorForName(teamName: string, leagueId: string): string {
  return snapshots.get(leagueId)?.find(team => team.teamName === teamName)?.color || "#4b5563";
}
export async function fetchRosterNameMap(leagueId: string): Promise<Record<string, string>> {
  return Object.fromEntries((await fetchTeamIdentities(leagueId)).map(team => [team.rosterId, team.teamName]));
}
