export type RosterValue = { value: number; source: "team" | "league" | "unpriced" };

/** Never drops a rostered player: team value, then league base, then tagged zero. */
export function completeRosterValues(
  playerIds: Iterable<string>, teamId: string, adjusted: Map<string, number>, leagueBase: Map<string, number>,
): Map<string, RosterValue> {
  const result = new Map<string, RosterValue>();
  for (const playerId of playerIds) {
    const teamValue = adjusted.get(`${teamId}:${playerId}`);
    if (typeof teamValue === "number") result.set(playerId, { value: teamValue, source: "team" });
    else {
      const base = leagueBase.get(playerId);
      result.set(playerId, typeof base === "number" ? { value: base, source: "league" } : { value: 0, source: "unpriced" });
    }
  }
  return result;
}
