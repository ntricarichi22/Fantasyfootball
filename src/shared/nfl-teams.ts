// NFL-team-by-player map, for stack / concentration logic in the trade engine.
// Built from the Sleeper player universe (cached); the canonical PlayerInfo
// doesn't carry an NFL team, so consumers that need "who plays for the same NFL
// team" pull it from here.
import { fetchPlayers } from "@/shared/league-data/sleeper";
import { ttlMemo } from "@/infrastructure/ttlCache";

export function buildNflTeams(): Promise<Map<string, string>> {
  return ttlMemo("nfl-teams", 3_600_000, async () => {
    const dict = await fetchPlayers();
    const m = new Map<string, string>();
    for (const id of Object.keys(dict)) {
      const t = dict[id]?.team;
      if (t) m.set(id, t);
    }
    return m;
  });
}
