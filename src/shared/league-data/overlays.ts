import type { OwnedPick, RosteredTeam } from "./types";

export type PendingTradeOverlay = {
  offerId: string; fromTeamId: string; toTeamId: string;
  assetsFrom: Array<{ key?: string; type?: string }>;
  assetsTo: Array<{ key?: string; type?: string }>;
};

export function applyPendingTradeOverlays(
  inputTeams: RosteredTeam[], inputOwnership: Map<string, OwnedPick[]>, overlays: PendingTradeOverlay[],
): { teams: RosteredTeam[]; ownership: Map<string, OwnedPick[]> } {
  const teams = inputTeams.map(team => ({ ...team, playerIds: [...team.playerIds], players: [...team.players], starterIds: [...team.starterIds] }));
  const ownership = new Map([...inputOwnership].map(([id, picks]) => [id, picks.map(pick => ({ ...pick }))]));
  const move = (asset: { key?: string; type?: string }, from: string, to: string) => {
    const key = String(asset.key ?? "");
    if (!key) return;
    if (asset.type === "pick" || key.startsWith("pick:")) {
      const source = ownership.get(from) ?? [];
      const index = source.findIndex(pick => pick.key === key);
      if (index < 0) return;
      const [pick] = source.splice(index, 1);
      ownership.set(from, source);
      const target = ownership.get(to) ?? [];
      if (!target.some(item => item.key === key)) target.push({ ...pick, currentRosterId: to });
      ownership.set(to, target);
      return;
    }
    const playerId = key.replace(/^player:/, "");
    const source = teams.find(team => team.rosterId === from);
    const target = teams.find(team => team.rosterId === to);
    if (!source || !target) return;
    const player = source.players.find(item => item.id === playerId);
    if (!player) return;
    source.players = source.players.filter(item => item.id !== playerId);
    source.playerIds = source.playerIds.filter(id => id !== playerId);
    source.starterIds = source.starterIds.filter(id => id !== playerId);
    if (!target.playerIds.includes(playerId)) { target.playerIds.push(playerId); target.players.push(player); }
  };
  for (const overlay of overlays) {
    for (const asset of overlay.assetsFrom) move(asset, overlay.fromTeamId, overlay.toTeamId);
    for (const asset of overlay.assetsTo) move(asset, overlay.toTeamId, overlay.fromTeamId);
  }
  return { teams, ownership };
}
