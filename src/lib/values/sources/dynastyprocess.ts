// src/lib/values/sources/dynastyprocess.ts
//
// Fetches dynasty values from DynastyProcess's public GitHub data repo.
// The values.csv file has a value_2qb column for Superflex.
// We also fetch db_playerids.csv to map their internal IDs to Sleeper IDs.
//
// CSV is parsed with a minimal hand-rolled parser to avoid adding a dependency.

import type { SourceRow } from "../normalize";

const VALUES_URL =
  "https://github.com/DynastyProcess/data/raw/master/files/values.csv";
const PLAYERIDS_URL =
  "https://github.com/DynastyProcess/data/raw/master/files/db_playerids.csv";

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

export async function fetchDynastyProcess(): Promise<SourceRow[]> {
  const [values, playerIds] = await Promise.all([
    fetchCSV(VALUES_URL),
    fetchCSV(PLAYERIDS_URL),
  ]);

  if (values.length === 0) {
    throw new Error("DP values.csv was empty");
  }

  // Build a map of dp's internal player id → sleeper_id using db_playerids.csv.
  // values.csv has a player name column; we'll match by name when no direct
  // join key exists. db_playerids.csv has both `player` (name) and sleeper_id.
  const nameToSleeper = new Map<string, string>();
  for (const p of playerIds) {
    const name = (p.player ?? p.name ?? "").trim();
    const sid = (p.sleeper_id ?? "").trim();
    if (name && sid) nameToSleeper.set(name.toLowerCase(), sid);
  }

  const rows: SourceRow[] = [];
  for (const v of values) {
    const name = (v.player ?? "").trim();
    if (!name) continue;

    // Skip picks — they don't have sleeper_ids
    const pos = (v.pos ?? "").trim().toUpperCase();
    if (pos === "PICK" || pos === "" || pos === "DST") continue;

    const valueStr = (v.value_2qb ?? "").trim();
    const raw = parseInt(valueStr, 10);
    if (!Number.isFinite(raw) || raw <= 0) continue;

    const sleeperId = nameToSleeper.get(name.toLowerCase()) ?? null;

    rows.push({
      source_player_name: name,
      sleeper_player_id: sleeperId,
      raw_value: raw,
    });
  }

  return rows;
}
