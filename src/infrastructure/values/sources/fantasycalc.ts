// src/lib/values/sources/fantasycalc.ts
//
// Fetches dynasty trade values from FantasyCalc using their public API.
// Uses Superflex/2QB endpoint (numQbs=2). Each row natively includes
// player.sleeperId, so no name mapping needed.
//
// Returns players + the source's 2026 1.01 pick value (used as denominator
// for multiple_101 calculation).

import type { SourceRow } from "@/infrastructure/values/normalize";

const ENDPOINT =
  "https://api.fantasycalc.com/values/current?isDynasty=true&numQbs=2&numTeams=12&ppr=1";

const PICK_YEAR = "2026";

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

export type FantasyCalcResult = {
  rows: SourceRow[];
  pick_101_value: number | null;
};

export async function fetchFantasyCalc(): Promise<FantasyCalcResult> {
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
  let pick_101_value: number | null = null;
  let pick_101_fallback: number | null = null;

  for (const row of data) {
    const pos = row.player?.position?.toUpperCase() ?? "";
    const name = row.player?.name ?? "";
    const value = typeof row.value === "number" ? row.value : 0;

    if (pos === "PICK") {
      const upper = name.toUpperCase();
      if (upper.includes(PICK_YEAR) && upper.includes("1.01")) {
        pick_101_value = value;
      } else if (
        pick_101_fallback === null &&
        upper.includes(PICK_YEAR) &&
        upper.includes("EARLY") &&
        upper.includes("1ST")
      ) {
        pick_101_fallback = value;
      }
      continue;
    }

    if (!row.player?.sleeperId) continue;
    if (value <= 0) continue;

    rows.push({
      source_player_name: row.player.name,
      sleeper_player_id: row.player.sleeperId,
      raw_value: value,
    });
  }

  return {
    rows,
    pick_101_value: pick_101_value ?? pick_101_fallback,
  };
}
