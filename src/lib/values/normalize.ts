// src/lib/values/normalize.ts
//
// Resolves source_player_name → sleeper_player_id when the source doesn't
// provide one directly. Logs unmapped rows to cfc_unmapped_log so we can
// review and add to cfc_player_alias_map manually as needed.

import type { SupabaseClient } from "@supabase/supabase-js";

export type SourceRow = {
  source_player_name: string;
  sleeper_player_id: string | null;
  raw_value: number;
};

export type NormalizedRow = {
  source_player_name: string;
  sleeper_player_id: string;
  raw_value: number;
};

export type NormalizeResult = {
  resolved: NormalizedRow[];
  unmapped: { source_player_name: string; raw_value: number }[];
};

// Strip punctuation, collapse whitespace, lowercase. Used for fuzzy lookup
// against Sleeper's player list when alias map misses.
function normalizeName(name: string): string {
  return name
    .toLowerCase()
    .replace(/[.'’`]/g, "")
    .replace(/\s+(jr|sr|ii|iii|iv|v)\.?$/i, "")
    .replace(/[^a-z0-9 ]/g, " ")
    .replace(/\s+/g, " ")
    .trim();
}

export async function normalizeRows(
  supabase: SupabaseClient,
  sourceKey: string,
  rows: SourceRow[],
  importBatch: string
): Promise<NormalizeResult> {
  const resolved: NormalizedRow[] = [];
  const unmapped: NormalizeResult["unmapped"] = [];

  // 1) First pass — anything that already has sleeper_player_id is done.
  const needsLookup: SourceRow[] = [];
  for (const r of rows) {
    if (r.sleeper_player_id) {
      resolved.push({
        source_player_name: r.source_player_name,
        sleeper_player_id: r.sleeper_player_id,
        raw_value: r.raw_value,
      });
    } else {
      needsLookup.push(r);
    }
  }

  if (needsLookup.length === 0) {
    return { resolved, unmapped };
  }

  // 2) Load the alias map for this source.
  const { data: aliases, error } = await supabase
    .from("cfc_player_alias_map")
    .select("source_player_name, sleeper_player_id")
    .eq("source_key", sourceKey);

  if (error) {
    throw new Error(`Alias map fetch failed: ${error.message}`);
  }

  const aliasMap = new Map<string, string>();
  for (const a of aliases ?? []) {
    aliasMap.set(a.source_player_name.toLowerCase(), a.sleeper_player_id);
    aliasMap.set(normalizeName(a.source_player_name), a.sleeper_player_id);
  }

  // 3) Try alias map (exact, then normalized).
  for (const r of needsLookup) {
    const exact = aliasMap.get(r.source_player_name.toLowerCase());
    const fuzzy = exact ?? aliasMap.get(normalizeName(r.source_player_name));
    if (fuzzy) {
      resolved.push({
        source_player_name: r.source_player_name,
        sleeper_player_id: fuzzy,
        raw_value: r.raw_value,
      });
    } else {
      unmapped.push({
        source_player_name: r.source_player_name,
        raw_value: r.raw_value,
      });
    }
  }

  // 4) Log unmapped to cfc_unmapped_log (best-effort; don't fail the run).
  if (unmapped.length > 0) {
    const logRows = unmapped.map(u => ({
      source_key: sourceKey,
      source_player_name: u.source_player_name,
      raw_value: u.raw_value,
      import_batch: importBatch,
    }));
    await supabase.from("cfc_unmapped_log").insert(logRows);
  }

  return { resolved, unmapped };
}
