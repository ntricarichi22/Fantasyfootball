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
  // Average of the 2026 1.01-1.04 picks — the "early 1st" tier, used to derive the
  // tier->1.01 ratio that reconstructs KTC's (tier-only) 1.01.
  pick_early1st_value: number | null;
};

// Average value of the first four picks (1.01-1.04) = the "early 1st" tier.
function earlyFirstAvg(picks: Map<string, number>): number | null {
  const vals = ["1.01", "1.02", "1.03", "1.04"].map((k) => picks.get(k)).filter((v): v is number => typeof v === "number");
  return vals.length ? vals.reduce((a, b) => a + b, 0) / vals.length : null;
}

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
  const earlyPicks = new Map<string, number>(); // "1.01".."1.04" -> value

  for (const row of data) {
    const pos = row.player?.position?.toUpperCase() ?? "";
    const name = row.player?.name ?? "";
    const value = typeof row.value === "number" ? row.value : 0;

    if (pos === "PICK") {
      const m = name.match(new RegExp(`${PICK_YEAR}\\s*Pick\\s*(1\\.0[1-4])`, "i"));
      if (m) earlyPicks.set(m[1], value);
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
    pick_101_value: earlyPicks.get("1.01") ?? null,
    pick_early1st_value: earlyFirstAvg(earlyPicks),
  };
}
