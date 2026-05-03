// src/lib/values/sources/dynastyprocess.ts
//
// Fetches dynasty values from DynastyProcess's public GitHub data repo.
// The values.csv file has a value_2qb column for Superflex.
// We also fetch db_playerids.csv to map their player names to Sleeper IDs.
//
// Returns players + the source's 2026 1.01 pick value (used as denominator
// for multiple_101 calculation).

import type { SourceRow } from "../normalize";

const VALUES_URL =
  "https://github.com/DynastyProcess/data/raw/master/files/values.csv";
const PLAYERIDS_URL =
  "https://github.com/DynastyProcess/data/raw/master/files/db_playerids.csv";

const PICK_YEAR = "2026";

// Minimal CSV parser — handles quoted fields with commas
function parseCSV(text: string): Record<string, string>[] {
  const lines = text.split(/\r?\n/).filter(l => l.length > 0);
  if (lines.length < 2) return [];

  const parseLine = (line: string): string[] => {
    const cells: string[] = [];
    let cur = "";
    let inQuotes = false;
    for (let i = 0; i < line.length; i++) {
      const ch = line[i];
      if (ch === '"' && line[i + 1] === '"') {
        cur += '"';
        i++;
      } else if (ch === '"') {
        inQuotes = !inQuotes;
      } else if (ch === "," && !inQuotes) {
        cells.push(cur);
        cur = "";
      } else {
        cur += ch;
      }
    }
    cells.push(cur);
    return cells;
  };

  const header = parseLine(lines[0]);
  const rows: Record<string, string>[] = [];
  for (let i = 1; i < lines.length; i++) {
    const cells = parseLine(lines[i]);
    const row: Record<string, string> = {};
    header.forEach((h, idx) => { row[h] = cells[idx] ?? ""; });
    rows.push(row);
  }
  return rows;
}

async function fetchCSV(url: string): Promise<Record<string, string>[]> {
  const res = await fetch(url, {
    headers: { "User-Agent": "CFC-Front-Office/1.0" },
    next: { revalidate: 0 },
  });
  if (!res.ok) {
    throw new Error(`DP fetch failed: ${url} → ${res.status} ${res.statusText}`);
  }
  return parseCSV(await res.text());
}

export type DynastyProcessResult = {
  rows: SourceRow[];
  pick_101_value: number | null;
};

export async function fetchDynastyProcess(): Promise<DynastyProcessResult> {
  const [values, playerIds] = await Promise.all([
    fetchCSV(VALUES_URL),
    fetchCSV(PLAYERIDS_URL),
  ]);

  if (values.length === 0) {
    throw new Error("DP values.csv was empty");
  }

  // Build a map of player name → sleeper_id using db_playerids.csv.
  const nameToSleeper = new Map<string, string>();
  for (const p of playerIds) {
    const name = (p.player ?? p.name ?? "").trim();
    const sid = (p.sleeper_id ?? "").trim();
    if (name && sid) nameToSleeper.set(name.toLowerCase(), sid);
  }

  const rows: SourceRow[] = [];
  let pick_101_value: number | null = null;
  let pick_101_fallback: number | null = null;

  for (const v of values) {
    const name = (v.player ?? "").trim();
    if (!name) continue;

    const pos = (v.pos ?? "").trim().toUpperCase();
    const valueStr = (v.value_2qb ?? "").trim();
    const raw = parseInt(valueStr, 10);

    if (pos === "PICK") {
      if (!Number.isFinite(raw) || raw <= 0) continue;
      const upper = name.toUpperCase();
      if (upper.includes(PICK_YEAR) && upper.includes("1.01")) {
        pick_101_value = raw;
      } else if (
        pick_101_fallback === null &&
        upper.includes(PICK_YEAR) &&
        upper.includes("EARLY") &&
        upper.includes("1ST")
      ) {
        pick_101_fallback = raw;
      }
      continue;
    }

    if (pos === "" || pos === "DST") continue;
    if (!Number.isFinite(raw) || raw <= 0) continue;

    const sleeperId = nameToSleeper.get(name.toLowerCase()) ?? null;

    rows.push({
      source_player_name: name,
      sleeper_player_id: sleeperId,
      raw_value: raw,
    });
  }

  return {
    rows,
    pick_101_value: pick_101_value ?? pick_101_fallback,
  };
}
