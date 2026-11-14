import type { LeagueData } from "./types";

type AssetLeague = Pick<LeagueData, "teams" | "players" | "pickOwnership">;
export type TradeAsset = { key: string; label: string; type: "player" | "pick"; value?: number };

// Validate against current ownership and derive labels/types from canonical
// league data. A client cannot dress an unowned or low-value asset as a star.
export function canonicalTradeAssets(input: unknown, teamId: string, league: AssetLeague): TradeAsset[] | null {
  if (!Array.isArray(input) || !input.length || input.length > 100) return null;
  const team = league.teams.find((candidate) => candidate.rosterId === teamId);
  if (!team) return null;
  const seen = new Set<string>();
  const output: TradeAsset[] = [];
  for (const value of input) {
    if (!value || typeof value !== "object" || typeof value.key !== "string" || value.key.length > 128 || seen.has(value.key)) return null;
    seen.add(value.key);
    if (value.key.startsWith("player:")) {
      const id = value.key.slice(7);
      const player = league.players.get(id);
      if (!player || !team.playerIds.includes(id)) return null;
      output.push({ key: value.key, label: player.name, type: "player" });
    } else if (value.key.startsWith("pick:")) {
      const pick = league.pickOwnership.get(teamId)?.find((candidate) => candidate.key === value.key);
      if (!pick) return null;
      const label = pick.slot == null ? `${pick.season} Rd ${pick.round}` : `${pick.season} ${pick.round}.${String(pick.slot).padStart(2, "0")}`;
      output.push({ key: value.key, label, type: "pick" });
    } else return null;
  }
  return output;
}

export function offerTransition(value: unknown): { allowed: string[]; role: "sender" | "receiver" } | null {
  if (value === "accepted" || value === "declined") return { allowed: ["pending"], role: "receiver" };
  if (value === "withdrawn") return { allowed: ["pending"], role: "sender" };
  return null;
}
