// src/lib/values/normalize.ts
//
// Resolves source_player_name → sleeper_player_id when the source doesn't
// provide one directly. Multi-tier lookup:
//   1. Alias map (manual overrides win — exact + normalized)
//   2. Sleeper dictionary (progressive fuzziness)
//      - 2a. Normalized exact match (handles suffixes, punctuation)
//      - 2b. Diacritic-stripped match (José → Jose)
//      - 2c. Nickname expansion (Mike → Michael, Ken → Kenneth)
// Unmapped rows logged to cfc_unmapped_log for human review.

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

export type SleeperPlayerMeta = {
  full_name?: string | null;
  first_name?: string | null;
  last_name?: string | null;
  position?: string | null;
  team?: string | null;
};

// ──────────────────────────────────────────────────────────────────────
// Name normalization helpers
// ──────────────────────────────────────────────────────────────────────

// First-pass normalization: lowercase, strip diacritics, strip suffixes,
// strip punctuation, collapse whitespace.
function normalizeName(name: string): string {
  return name
    .normalize("NFD")
    .replace(/[\u0300-\u036f]/g, "") // strip diacritics (José → Jose)
    .toLowerCase()
    .replace(/[.'’`]/g, "")
    .replace(/\s+(jr|sr|ii|iii|iv|v)\.?$/i, "")
    .replace(/[^a-z0-9 ]/g, " ")
    .replace(/\s+/g, " ")
    .trim();
}

// Aggressive: collapse to letters-only (no spaces, no digits, no anything).
// Lets us match "AJ Brown" / "A.J. Brown" / "A J Brown" all as "ajbrown".
function compactName(name: string): string {
  return normalizeName(name).replace(/\s+/g, "");
}

// Common nickname → canonical first-name expansions. Bidirectional
// (we generate keys both ways at lookup time).
const NICKNAME_PAIRS: ReadonlyArray<[string, string]> = [
  ["mike", "michael"],
  ["ken", "kenneth"],
  ["chris", "christopher"],
  ["will", "william"],
  ["bill", "william"],
  ["tony", "anthony"],
  ["nick", "nicholas"],
  ["nic", "nicholas"],
  ["zach", "zachary"],
  ["zac", "zachary"],
  ["alex", "alexander"],
  ["josh", "joshua"],
  ["matt", "matthew"],
  ["dan", "daniel"],
  ["danny", "daniel"],
  ["jon", "jonathan"],
  ["john", "jonathan"],
  ["sam", "samuel"],
  ["ben", "benjamin"],
  ["tom", "thomas"],
  ["rob", "robert"],
  ["bob", "robert"],
  ["bobby", "robert"],
  ["dave", "david"],
  ["jim", "james"],
  ["jimmy", "james"],
  ["andy", "andrew"],
  ["drew", "andrew"],
  ["greg", "gregory"],
  ["jeff", "jeffrey"],
  ["pat", "patrick"],
  ["rick", "richard"],
  ["ricky", "richard"],
  ["ron", "ronald"],
  ["steve", "steven"],
  ["ted", "theodore"],
  ["theo", "theodore"],
  ["cam", "cameron"],
  ["nate", "nathaniel"],
  ["gabe", "gabriel"],
  ["isaac", "isaiah"], // imperfect but sometimes used interchangeably in fantasy
  ["xavier", "xzavier"],
];

// Generate all plausible variants of a normalized name by swapping the first
// token through nickname pairs both directions.
function nicknameVariants(normalized: string): string[] {
  const tokens = normalized.split(" ");
  if (tokens.length < 2) return [normalized];
  const first = tokens[0];
  const rest = tokens.slice(1).join(" ");
  const variants = new Set<string>([normalized]);
  for (const [a, b] of NICKNAME_PAIRS) {
    if (first === a) variants.add(`${b} ${rest}`);
    if (first === b) variants.add(`${a} ${rest}`);
  }
  return Array.from(variants);
}

// ──────────────────────────────────────────────────────────────────────
// Sleeper dictionary index — built once, reused per call
// ──────────────────────────────────────────────────────────────────────

type SleeperIndex = {
  byNormalized: Map<string, string[]>; // normalized name → [sleeper_id, ...]
  byCompact: Map<string, string[]>;    // compact name → [sleeper_id, ...]
  positions: Map<string, string>;       // sleeper_id → position
};

function buildSleeperIndex(
  sleeperPlayers: Record<string, SleeperPlayerMeta>,
): SleeperIndex {
  const byNormalized = new Map<string, string[]>();
  const byCompact = new Map<string, string[]>();
  const positions = new Map<string, string>();

  const RELEVANT_POSITIONS = new Set(["QB", "RB", "WR", "TE", "K", "DEF"]);

  for (const [pid, meta] of Object.entries(sleeperPlayers)) {
    const pos = meta.position?.toUpperCase();
    if (!pos || !RELEVANT_POSITIONS.has(pos)) continue;

    positions.set(pid, pos);

    const candidateNames = [
      meta.full_name,
      meta.first_name && meta.last_name ? `${meta.first_name} ${meta.last_name}` : null,
    ].filter((n): n is string => Boolean(n));

    for (const name of candidateNames) {
      const norm = normalizeName(name);
      if (norm) {
        const existing = byNormalized.get(norm) ?? [];
        if (!existing.includes(pid)) existing.push(pid);
        byNormalized.set(norm, existing);
      }
      const compact = compactName(name);
      if (compact) {
        const existing = byCompact.get(compact) ?? [];
        if (!existing.includes(pid)) existing.push(pid);
        byCompact.set(compact, existing);
      }
    }
  }

  return { byNormalized, byCompact, positions };
}

// ──────────────────────────────────────────────────────────────────────
// Resolution logic
// ──────────────────────────────────────────────────────────────────────

function resolveViaSleeperIndex(
  sourceName: string,
  index: SleeperIndex,
): string | null {
  const normalized = normalizeName(sourceName);
  if (!normalized) return null;

  // Tier 2a: Exact normalized match
  const directMatches = index.byNormalized.get(normalized);
  if (directMatches && directMatches.length === 1) return directMatches[0];

  // Tier 2b: Compact match (handles "A.J. Brown" / "AJ Brown")
  const compact = compactName(sourceName);
  const compactMatches = index.byCompact.get(compact);
  if (compactMatches && compactMatches.length === 1) return compactMatches[0];

  // Tier 2c: Try nickname variants
  for (const variant of nicknameVariants(normalized)) {
    const matches = index.byNormalized.get(variant);
    if (matches && matches.length === 1) return matches[0];
  }

  // If we have multiple matches, we can't safely pick one without more
  // context (position, team). Don't guess — let it fall to unmapped.
  return null;
}

// ──────────────────────────────────────────────────────────────────────
// Main entrypoint
// ──────────────────────────────────────────────────────────────────────

export async function normalizeRows(
  supabase: SupabaseClient,
  sourceKey: string,
  rows: SourceRow[],
  importBatch: string,
  sleeperPlayers: Record<string, SleeperPlayerMeta>,
): Promise<NormalizeResult> {
  const resolved: NormalizedRow[] = [];
  const unmapped: NormalizeResult["unmapped"] = [];

  // 1) Anything that already has sleeper_player_id is done.
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

  // 3) Build Sleeper dictionary index once (used for all unresolved rows).
  const sleeperIndex = buildSleeperIndex(sleeperPlayers);

  // 4) Try alias map first, then Sleeper index.
  for (const r of needsLookup) {
    // Tier 1: Alias map
    const aliasExact = aliasMap.get(r.source_player_name.toLowerCase());
    const aliasFuzzy = aliasExact ?? aliasMap.get(normalizeName(r.source_player_name));
    if (aliasFuzzy) {
      resolved.push({
        source_player_name: r.source_player_name,
        sleeper_player_id: aliasFuzzy,
        raw_value: r.raw_value,
      });
      continue;
    }

    // Tier 2: Sleeper dictionary
    const sleeperMatch = resolveViaSleeperIndex(r.source_player_name, sleeperIndex);
    if (sleeperMatch) {
      resolved.push({
        source_player_name: r.source_player_name,
        sleeper_player_id: sleeperMatch,
        raw_value: r.raw_value,
      });
      continue;
    }

    // Tier 3: Unmapped
    unmapped.push({
      source_player_name: r.source_player_name,
      raw_value: r.raw_value,
    });
  }

  // 5) Log unmapped to cfc_unmapped_log (best-effort; don't fail the run).
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
