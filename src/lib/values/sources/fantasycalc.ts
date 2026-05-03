// src/lib/values/sources/fantasycalc.ts
//
// Fetches dynasty trade values from FantasyCalc using their public API.
// Uses Superflex/2QB endpoint (numQbs=2). Each row natively includes
// player.sleeperId, so no name mapping needed.
//
// Returns players only — picks are filtered out (they have no sleeperId).

import type { SourceRow } from "../normalize";

const ENDPOINT =
  "https://api.fantasycalc.com/values/current?isDynasty=true&numQbs=2&numTeams=12&ppr=1";

type FantasyCalcRow = {
  player: {
    id: number;
    name: string;
    sleeperId: string | null;
    position: string;
    maybeTeam?: string | null;
  };
  value: number;
  overallRank: number;
  positionRank: number;
};

export async function fetchFantasyCalc(): Promise<SourceRow[]> {
  const res = await fetch(ENDPOINT, {
    headers: { "User-Agent": "CFC-Front-Office/1.0" },
    next: { revalidate: 0 },
  });

  if (!res.ok) {
    throw new Error(`FantasyCalc fetch failed: ${res.status} ${res.statusText}`);
  }

  const data = (await res.json()) as FantasyCalcRow[];
  if (!Array.isArray(data) || data.length === 0) {
    throw new Error("FantasyCalc returned empty or invalid data");
  }

  const rows: SourceRow[] = [];
  for (const row of data) {
    // Skip rows without a sleeperId (picks, defenses, etc.)
    if (!row.player?.sleeperId) continue;
    if (typeof row.value !== "number" || row.value <= 0) continue;

    rows.push({
      source_player_name: row.player.name,
      sleeper_player_id: row.player.sleeperId,
      raw_value: row.value,
    });
  }

  return rows;
}
