/**
 * rosterBackfill.ts
 *
 * Server-side utility that detects rostered players missing from
 * `cfc_trade_values_current` and backfills them using FantasyCalc and
 * DynastyProcess values, then re-reads the updated table.
 *
 * Intended for use in API route handlers only — never imported by client code.
 */

import type { SupabaseClient } from "@supabase/supabase-js";

import { normalizeName } from "@/lib/normalize";

const FANTASYCALC_URL =
  "https://api.fantasycalc.com/values/current?isDynasty=true&numQbs=2&numTeams=12&ppr=0.5";
const DYNASTY_PROCESS_VALUES_URL =
  "https://raw.githubusercontent.com/dynastyprocess/data/master/files/values.csv";
const DEFAULT_YEAR = "2026";

/* ── Types ─────────────────────────────────────────────────────────────── */

type ValueRow = {
  sleeper_player_id: string | null;
  asset_key: string | null;
  cfc_value: number | null;
};

type StagingRow = {
  import_batch: string;
  source_key: string;
  asset_key: string;
  asset_type: string;
  display_name: string;
  sleeper_player_id: string;
  position: string | null;
  birth_date: string | null;
  raw_value: number;
  source_101_value: number;
  multiple_101: number;
};

type SleeperPlayer = {
  position?: string | null;
  full_name?: string | null;
  search_full_name?: string | null;
  birth_date?: string | null;
  team?: string | null;
};

/* ── Helpers ───────────────────────────────────────────────────────────── */

function parseCSVLine(line: string): string[] {
  const result: string[] = [];
  let current = "";
  let inQuotes = false;
  for (let i = 0; i < line.length; i++) {
    const ch = line[i];
    if (inQuotes) {
      if (ch === '"') {
        if (i + 1 < line.length && line[i + 1] === '"') {
          current += '"';
          i++;
        } else {
          inQuotes = false;
        }
      } else {
        current += ch;
      }
    } else if (ch === '"') {
      inQuotes = true;
    } else if (ch === ",") {
      result.push(current);
      current = "";
    } else {
      current += ch;
    }
  }
  result.push(current);
  return result;
}

function parseCSV(text: string): Record<string, string>[] {
  const lines = text.split("\n").filter((l) => l.trim());
  if (lines.length < 2) return [];
  const headers = parseCSVLine(lines[0]);
  const rows: Record<string, string>[] = [];
  for (let i = 1; i < lines.length; i++) {
    const values = parseCSVLine(lines[i]);
    if (values.length !== headers.length) continue;
    const row: Record<string, string> = {};
    headers.forEach((h, j) => {
      row[h] = values[j];
    });
    rows.push(row);
  }
  return rows;
}

/** Builds the canonical value map from `cfc_trade_values_current` rows. */
export function buildValueMap(rows: ValueRow[]): Record<string, number> {
  return rows.reduce<Record<string, number>>((acc, row) => {
    if (typeof row.cfc_value !== "number") return acc;
    // Use sleeper_player_id when present; fall back to extracting the ID
    // from asset_key (e.g. "player.4046" → "4046") so the map is populated
    // even when the sleeper_player_id column was not written by an older
    // version of cfc_apply_value_upload.
    const sid =
      row.sleeper_player_id ??
      (row.asset_key?.startsWith("player.")
        ? row.asset_key.slice("player.".length)
        : null);
    if (sid) {
      acc[sid] = row.cfc_value;
    }
    if (row.asset_key?.startsWith("pick.")) {
      acc[row.asset_key] = row.cfc_value;
    }
    return acc;
  }, {});
}

/* ── Main export ───────────────────────────────────────────────────────── */

/**
 * Given the current value map (from `cfc_trade_values_current`), checks which
 * rostered players in the Sleeper league are missing and backfills them.
 *
 * Returns the enriched value map.  If there are no missing players the map is
 * returned unchanged without any external fetches beyond the roster list.
 *
 * @param client     Supabase admin client
 * @param valueMap   Existing map of `sleeper_player_id → cfc_value`
 */
export async function backfillMissingRosteredPlayers(
  client: SupabaseClient,
  valueMap: Record<string, number>,
): Promise<Record<string, number>> {
  const leagueId = process.env.NEXT_PUBLIC_SLEEPER_LEAGUE_ID?.trim();
  if (!leagueId) return valueMap;

  /* ── 1. Fetch current rosters ─────────────────────────────────────── */
  let rostersRes: Response;
  try {
    rostersRes = await fetch(
      `https://api.sleeper.app/v1/league/${leagueId}/rosters`,
      { cache: "no-store" },
    );
  } catch (err) {
    console.warn("[rosterBackfill] roster fetch failed:", err instanceof Error ? err.message : err);
    return valueMap;
  }
  if (!rostersRes.ok) return valueMap;

  const rosters: Array<{ players?: (string | number)[] | null }> =
    await rostersRes.json();

  /* ── 2. Identify rostered players not in the value map ────────────── */
  // Treat both absent players AND zero-value players as needing backfill.
  // A zero cfc_value means a prior import wrote nothing useful (e.g. player
  // was in the spreadsheet with no raw values and no FC/DP match).
  const missingIds: string[] = [];
  for (const roster of rosters ?? []) {
    for (const pid of roster.players ?? []) {
      const id = String(pid);
      // !valueMap[id] is true when id is absent (undefined) OR value is 0
      if (!valueMap[id]) {
        missingIds.push(id);
      }
    }
  }

  if (missingIds.length === 0) return valueMap;

  // Deduplicate before logging (a player can appear on multiple rosters)
  const missingSet = new Set(missingIds);
  console.log(`[rosterBackfill] ${missingSet.size} unique rostered player(s) missing or at 0 — triggering backfill`);

  /* ── 3. Fetch FantasyCalc, DynastyProcess, and Sleeper player dict ── */
  let fcRes: Response, dpRes: Response, sleeperRes: Response;
  try {
    [fcRes, dpRes, sleeperRes] = await Promise.all([
      fetch(FANTASYCALC_URL, { cache: "no-store" }),
      fetch(DYNASTY_PROCESS_VALUES_URL, { cache: "no-store" }),
      fetch("https://api.sleeper.app/v1/players/nfl", { cache: "no-store" }),
    ]);
  } catch (err) {
    console.warn("[rosterBackfill] external fetch failed:", err instanceof Error ? err.message : err);
    return valueMap;
  }

  /* ── 4. Build Sleeper metadata maps ───────────────────────────────── */
  const posMap: Record<string, string> = {};
  const birthDateMap: Record<string, string> = {};
  const idToName: Record<string, string> = {};
  // nameToIds: normalized-name → list of sleeper IDs (handles same-name players)
  const nameToIds: Record<string, string[]> = {};

  if (sleeperRes.ok) {
    const dict: Record<string, SleeperPlayer> = await sleeperRes.json();
    for (const [id, player] of Object.entries(dict)) {
      if (player?.position) posMap[id] = player.position.toUpperCase();
      if (player?.birth_date) birthDateMap[id] = player.birth_date;
      const name = player?.full_name ?? player?.search_full_name;
      if (name) {
        idToName[id] = name;
        const key = normalizeName(name);
        if (key) {
          if (!nameToIds[key]) nameToIds[key] = [];
          nameToIds[key].push(id);
        }
      }
    }
  }

  /* ── 5. Extract FantasyCalc values (direct Sleeper ID lookup) ─────── */
  const fcPlayerMap: Record<string, number> = {};
  let fcPick101: number | null = null;

  if (fcRes.ok) {
    const fcData: Array<{
      player?: {
        sleeperId?: string | number | null;
        position?: string | null;
        name?: string | null;
      } | null;
      value?: number | null;
    }> = await fcRes.json();

    for (const row of fcData) {
      const val = row.value;
      if (typeof val !== "number") continue;
      const pos = row.player?.position?.toUpperCase() ?? "";
      if (pos === "PICK") {
        const n = (row.player?.name ?? "").toUpperCase();
        if (n.includes(DEFAULT_YEAR) && n.includes("1.01")) {
          fcPick101 = val;
        } else if (fcPick101 == null && n.includes(DEFAULT_YEAR) && n.includes("EARLY") && n.includes("1ST")) {
          fcPick101 = val;
        }
        continue;
      }
      const sid = row.player?.sleeperId;
      if (sid != null) fcPlayerMap[String(sid)] = val;
    }
  }

  /* ── 6. Extract DynastyProcess values (name → Sleeper ID) ────────── */
  const dpPlayerMap: Record<string, number> = {};
  let dpPick101: number | null = null;

  if (dpRes.ok) {
    const text = await dpRes.text();
    const rows = parseCSV(text);
    for (const row of rows) {
      const pos = (row.pos ?? "").toUpperCase();
      const val2qb = row.value_2qb;
      const numVal =
        val2qb !== undefined && val2qb !== "NA" && val2qb !== ""
          ? Number(val2qb)
          : NaN;
      if (isNaN(numVal)) continue;

      if (pos === "PICK") {
        const name = (row.player ?? "").toUpperCase();
        if (name.includes(DEFAULT_YEAR) && name.includes("1.01")) {
          dpPick101 = numVal;
        } else if (dpPick101 == null && name.includes(DEFAULT_YEAR) && name.includes("EARLY") && name.includes("1ST")) {
          dpPick101 = numVal;
        }
        continue;
      }

      const dpName = row.player;
      if (!dpName) continue;
      const key = normalizeName(dpName);
      // Use the same name→ID resolution as the import route:
      // collect all IDs for this name, then prefer the one whose position matches.
      const ids = nameToIds[key];
      if (!ids || ids.length === 0) continue;
      const bestId = ids.find((id) => posMap[id] === pos) ?? ids[0];
      dpPlayerMap[bestId] = numVal;
    }
  }

  /* ── 7. Build staging rows for all missing players ────────────────── */
  const batchName = `roster-backfill-${new Date().toISOString().slice(0, 19).replace(/[T:]/g, "-")}`;
  const stagingRows: StagingRow[] = [];

  for (const sleeperId of missingSet) {
    const assetKey = `player.${sleeperId}`;
    const displayName = idToName[sleeperId] ?? sleeperId;
    const position = posMap[sleeperId] ?? null;
    const birthDate = birthDateMap[sleeperId] ?? null;

    const fcVal = fcPlayerMap[sleeperId];
    const dpVal = dpPlayerMap[sleeperId];

    // Diagnostic log so server logs show exactly why each player is (not) backfilled
    console.log(
      `[rosterBackfill] ${displayName} (${sleeperId}) | ` +
      `fc=${typeof fcVal === "number" ? fcVal : "N/A"} ` +
      `dp=${typeof dpVal === "number" ? dpVal : "N/A"}`,
    );

    if (fcPick101 != null && fcPick101 > 0) {
      if (typeof fcVal === "number") {
        stagingRows.push({
          import_batch: batchName,
          source_key: "fantasycalc",
          asset_key: assetKey,
          asset_type: "player",
          display_name: displayName,
          sleeper_player_id: sleeperId,
          position,
          birth_date: birthDate,
          raw_value: fcVal,
          source_101_value: fcPick101,
          multiple_101: fcVal / fcPick101,
        });
      }
    }

    if (dpPick101 != null && dpPick101 > 0) {
      if (typeof dpVal === "number") {
        stagingRows.push({
          import_batch: batchName,
          source_key: "dynastyprocess",
          asset_key: assetKey,
          asset_type: "player",
          display_name: displayName,
          sleeper_player_id: sleeperId,
          position,
          birth_date: birthDate,
          raw_value: dpVal,
          source_101_value: dpPick101,
          multiple_101: dpVal / dpPick101,
        });
      }
    }
  }

  if (stagingRows.length === 0) {
    console.log("[rosterBackfill] no FC/DP values found for missing rostered players");
    return valueMap;
  }

  /* ── 8. Upsert staging rows ───────────────────────────────────────── */
  const CHUNK_SIZE = 500;
  for (let i = 0; i < stagingRows.length; i += CHUNK_SIZE) {
    const chunk = stagingRows.slice(i, i + CHUNK_SIZE);
    const { error } = await client
      .from("cfc_value_upload_staging")
      .upsert(chunk, {
        onConflict: "import_batch,asset_key,source_key",
        ignoreDuplicates: false,
      });
    if (error) {
      console.error("[rosterBackfill] staging upsert error:", error.message);
      return valueMap;
    }
  }

  /* ── 9. Apply batch ───────────────────────────────────────────────── */
  const { error: applyError } = await client.rpc("cfc_apply_value_upload", {
    p_batch: batchName,
  });
  if (applyError) {
    console.error("[rosterBackfill] cfc_apply_value_upload error:", applyError.message);
    return valueMap;
  }

  console.log(`[rosterBackfill] backfill complete — batch ${batchName}, staging rows: ${stagingRows.length}`);

  /* ── 10. Re-read the updated values table ─────────────────────────── */
  const { data, error: readError } = await client
    .from("cfc_trade_values_current")
    .select("sleeper_player_id, asset_key, cfc_value");

  if (readError) {
    console.error("[rosterBackfill] re-read error:", readError.message);
    return valueMap;
  }

  return buildValueMap(data ?? []);
}
