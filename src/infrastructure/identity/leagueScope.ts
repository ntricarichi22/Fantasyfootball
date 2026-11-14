export function leagueCacheKey(namespace: string, leagueId: string): string {
  if (!leagueId || leagueId.trim() !== leagueId) throw new Error("An explicit league ID is required");
  return `${namespace}:${encodeURIComponent(leagueId)}`;
}
