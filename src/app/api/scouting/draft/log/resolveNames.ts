export function resolveDraftLogNames(
  row: { roster_id: string | null; player_id: string | null; team_name?: string | null; player_name?: string | null },
  teams: Array<{ rosterId: string; teamName: string }>,
  players: Map<string, { name: string }>,
) {
  return {
    ...row,
    team_name: teams.find(team => team.rosterId === String(row.roster_id))?.teamName
      ?? row.team_name ?? `Team ${row.roster_id ?? "?"}`,
    player_name: (row.player_id ? players.get(String(row.player_id))?.name : undefined)
      ?? row.player_name ?? "Unknown Player",
  };
}
