import { NextResponse } from "next/server";

import { normalizeProspectName } from "@/lib/draft/types";
import { getSupabaseAdminClient } from "@/lib/supabaseAdmin";

export const runtime = "nodejs";
export const dynamic = "force-dynamic";

/**
 * One-time admin endpoint that populates the `rookie_prospects` Supabase table
 * with the curated 2026 CFC rookie pool. For each entry we look up the matching
 * Sleeper `player_id` (case-insensitive `last + first + position`), then upsert
 * the prospect bio. NFL team / draft slot / avatar are intentionally left NULL
 * — they're filled in after the actual NFL draft.
 *
 * Usage:
 *   POST /api/admin/populate-rookies?secret=$ADMIN_SECRET
 */

type Prospect = {
  first: string;
  last: string;
  position: "QB" | "RB" | "WR" | "TE";
  college: string;
  age: number;
  height_inches: number;
  weight: number;
};

const ft = (feet: number, inches: number) => feet * 12 + inches;

const PROSPECTS: Prospect[] = [
  // QBs
  { first: "Fernando", last: "Mendoza", position: "QB", college: "Indiana", age: 22, height_inches: ft(6, 5), weight: 236 },
  { first: "Ty", last: "Simpson", position: "QB", college: "Alabama", age: 21, height_inches: ft(6, 1), weight: 211 },
  { first: "Garrett", last: "Nussmeier", position: "QB", college: "LSU", age: 22, height_inches: ft(6, 2), weight: 203 },
  { first: "Drew", last: "Allar", position: "QB", college: "Penn State", age: 22, height_inches: ft(6, 5), weight: 228 },
  { first: "Carson", last: "Beck", position: "QB", college: "Miami", age: 23, height_inches: ft(6, 5), weight: 233 },
  { first: "Cole", last: "Payton", position: "QB", college: "North Dakota State", age: 23, height_inches: ft(6, 3), weight: 232 },
  { first: "Taylen", last: "Green", position: "QB", college: "Arkansas", age: 23, height_inches: ft(6, 6), weight: 227 },
  { first: "Cade", last: "Klubnik", position: "QB", college: "Clemson", age: 22, height_inches: ft(6, 2), weight: 207 },
  // RBs
  { first: "Jeremiyah", last: "Love", position: "RB", college: "Notre Dame", age: 21, height_inches: ft(6, 0), weight: 212 },
  { first: "Jadarian", last: "Price", position: "RB", college: "Notre Dame", age: 22, height_inches: ft(5, 10), weight: 196 },
  { first: "Emmett", last: "Johnson", position: "RB", college: "Nebraska", age: 22, height_inches: ft(5, 11), weight: 213 },
  { first: "Kaytron", last: "Allen", position: "RB", college: "Penn State", age: 22, height_inches: ft(5, 10), weight: 215 },
  { first: "Mike", last: "Washington Jr.", position: "RB", college: "Arkansas", age: 22, height_inches: ft(6, 0), weight: 210 },
  { first: "Jonah", last: "Coleman", position: "RB", college: "Washington", age: 22, height_inches: ft(5, 10), weight: 210 },
  { first: "Nicholas", last: "Singleton", position: "RB", college: "Penn State", age: 22, height_inches: ft(6, 0), weight: 220 },
  { first: "Demond", last: "Claiborne", position: "RB", college: "Wake Forest", age: 22, height_inches: ft(5, 10), weight: 210 },
  { first: "Kaelon", last: "Black", position: "RB", college: "Indiana", age: 22, height_inches: ft(5, 11), weight: 218 },
  { first: "Seth", last: "McGowan", position: "RB", college: "Kentucky", age: 23, height_inches: ft(5, 11), weight: 215 },
  // WRs
  { first: "Carnell", last: "Tate", position: "WR", college: "Ohio State", age: 21, height_inches: ft(6, 2), weight: 192 },
  { first: "Makai", last: "Lemon", position: "WR", college: "USC", age: 21, height_inches: ft(5, 11), weight: 192 },
  { first: "Jordyn", last: "Tyson", position: "WR", college: "Arizona State", age: 21, height_inches: ft(6, 0), weight: 190 },
  { first: "Zachariah", last: "Branch", position: "WR", college: "Georgia", age: 21, height_inches: ft(5, 9), weight: 180 },
  { first: "Chris", last: "Brazzell II", position: "WR", college: "Tennessee", age: 22, height_inches: ft(6, 3), weight: 215 },
  { first: "KC", last: "Concepcion", position: "WR", college: "Texas A&M", age: 22, height_inches: ft(6, 0), weight: 196 },
  { first: "Denzel", last: "Boston", position: "WR", college: "Washington", age: 22, height_inches: ft(6, 4), weight: 210 },
  { first: "Omar", last: "Cooper Jr.", position: "WR", college: "Indiana", age: 22, height_inches: ft(6, 1), weight: 195 },
  { first: "Germie", last: "Bernard", position: "WR", college: "Alabama", age: 22, height_inches: ft(6, 0), weight: 200 },
  { first: "Malachi", last: "Fields", position: "WR", college: "Notre Dame", age: 22, height_inches: ft(6, 5), weight: 218 },
  { first: "Chris", last: "Bell", position: "WR", college: "Louisville", age: 22, height_inches: ft(6, 2), weight: 220 },
  { first: "Antonio", last: "Williams", position: "WR", college: "Clemson", age: 22, height_inches: ft(5, 10), weight: 180 },
  { first: "Skyler", last: "Bell", position: "WR", college: "UConn", age: 23, height_inches: ft(6, 0), weight: 195 },
  { first: "De'Zhaun", last: "Stribling", position: "WR", college: "Ole Miss", age: 22, height_inches: ft(6, 3), weight: 205 },
  { first: "Elijah", last: "Sarratt", position: "WR", college: "Indiana", age: 23, height_inches: ft(6, 2), weight: 200 },
  { first: "Deion", last: "Burks", position: "WR", college: "Oklahoma", age: 22, height_inches: ft(5, 11), weight: 195 },
  // TEs
  { first: "Kenyon", last: "Sadiq", position: "TE", college: "Oregon", age: 21, height_inches: ft(6, 5), weight: 250 },
  { first: "Oscar", last: "Delp", position: "TE", college: "Georgia", age: 22, height_inches: ft(6, 4), weight: 240 },
  { first: "Justin", last: "Joly", position: "TE", college: "NC State", age: 23, height_inches: ft(6, 5), weight: 245 },
  { first: "Max", last: "Klare", position: "TE", college: "Ohio State", age: 22, height_inches: ft(6, 5), weight: 250 },
  { first: "Sam", last: "Roush", position: "TE", college: "Stanford", age: 23, height_inches: ft(6, 4), weight: 245 },
];

type SleeperPlayerRecord = {
  player_id?: string;
  first_name?: string;
  last_name?: string;
  full_name?: string;
  search_full_name?: string;
  search_first_name?: string;
  search_last_name?: string;
  position?: string;
  fantasy_positions?: string[];
  team?: string | null;
  college?: string | null;
};

const norm = (s: string | undefined | null) =>
  (s ?? "")
    .toLowerCase()
    .normalize("NFKD")
    .replace(/[\u0300-\u036f]/g, "")
    .replace(/[^a-z]/g, "")
    .trim();

function jsonError(message: string, status = 400) {
  return NextResponse.json({ ok: false, error: message }, { status });
}

/**
 * Build a position-bucketed index keyed by the same normalized full-name
 * Sleeper uses internally (`search_full_name`) so the lookup is O(1) per
 * prospect. We bucket by position because there are duplicate names across
 * positions (e.g. "Chris Bell" the WR vs others) and the dictionary is huge.
 */
function buildSleeperIndex(
  dictionary: Record<string, SleeperPlayerRecord>
): Map<string, Map<string, string>> {
  const buckets = new Map<string, Map<string, string>>();
  const positionsOfInterest = new Set(["QB", "RB", "WR", "TE"]);

  for (const [pid, p] of Object.entries(dictionary)) {
    if (!p || typeof p !== "object") continue;
    const positions = new Set(
      [p.position, ...(p.fantasy_positions ?? [])]
        .filter(Boolean)
        .map((x) => String(x).toUpperCase())
    );
    const matchedPositions = [...positions].filter((pos) => positionsOfInterest.has(pos));
    if (matchedPositions.length === 0) continue;

    // Prefer Sleeper's already-normalized search field; fall back to our own
    // normalization of the explicit name fields.
    const searchFull = norm(p.search_full_name) || norm(p.full_name);
    const composedFull =
      norm(p.search_first_name) + norm(p.search_last_name) ||
      norm(p.first_name) + norm(p.last_name);
    const keys = new Set([searchFull, composedFull].filter(Boolean));

    for (const pos of matchedPositions) {
      let bucket = buckets.get(pos);
      if (!bucket) {
        bucket = new Map();
        buckets.set(pos, bucket);
      }
      for (const key of keys) {
        // First write wins so we don't clobber an exact full-name match with
        // a noisier later one.
        if (!bucket.has(key)) bucket.set(key, pid);
      }
    }
  }
  return buckets;
}

function findSleeperId(
  prospect: Prospect,
  index: Map<string, Map<string, string>>,
  dictionary: Record<string, SleeperPlayerRecord>
): string | null {
  const bucket = index.get(prospect.position);
  if (!bucket) return null;

  const targetFirst = norm(prospect.first);
  const targetLast = norm(prospect.last);
  const targetFull = `${targetFirst}${targetLast}`;

  // Step 1: exact normalized full-name hit (handles ~95% of matches).
  const exact = bucket.get(targetFull);
  if (exact) return exact;

  // Step 2: try without suffix tokens like "Jr"/"II"/"III" on the prospect
  // side (Sleeper often drops them). Require at least 3 chars to remain so
  // we don't accidentally strip the tail of a short name (e.g. "Levi").
  const SUFFIX_RE = /(jr|sr|iii|ii|iv|v)$/;
  const suffixMatch = targetLast.match(SUFFIX_RE);
  const strippedLast =
    suffixMatch && targetLast.length - suffixMatch[0].length >= 3
      ? targetLast.slice(0, targetLast.length - suffixMatch[0].length)
      : targetLast;
  if (strippedLast !== targetLast) {
    const stripped = bucket.get(`${targetFirst}${strippedLast}`);
    if (stripped) return stripped;
  }

  // Step 3: full scan within the position bucket as a last resort —
  // last-name match + first-initial match. This catches things like
  // "Skyler Bell" / "Chris Bell" that share a last name but differ on first.
  for (const [pid, p] of Object.entries(dictionary)) {
    const positions = [p.position, ...(p.fantasy_positions ?? [])]
      .filter(Boolean)
      .map((x) => String(x).toUpperCase());
    if (!positions.includes(prospect.position)) continue;

    const last = norm(p.search_last_name) || norm(p.last_name);
    const first = norm(p.search_first_name) || norm(p.first_name);
    if (!last || !first) continue;

    const lastMatches = last === targetLast || last === strippedLast;
    if (lastMatches && first.charAt(0) === targetFirst.charAt(0)) {
      return pid;
    }
  }
  return null;
}

type EspnSearchHit = {
  id?: string | number;
  uid?: string;
  type?: string;
  // Some ESPN responses use `id`, others nest under `link` etc. We probe
  // multiple shapes and pull the first numeric id we find.
  defaultRef?: { $ref?: string };
  link?: { web?: { href?: string } };
};

type EspnSearchResult = {
  results?: Array<{
    type?: string;
    contents?: EspnSearchHit[];
  }>;
};

const ESPN_ID_RE = /\/id\/(\d+)/;

/**
 * Look up a college-football player headshot URL on ESPN. Returns the
 * combiner CDN URL (200×200) or null if no id can be parsed. Failures are
 * silent — the caller treats null as "no avatar yet".
 */
async function fetchEspnHeadshotUrl(displayName: string): Promise<string | null> {
  const query = encodeURIComponent(displayName);
  const url = `https://site.api.espn.com/apis/common/v3/search?query=${query}&limit=1&type=player`;
  let espnId: string | null = null;
  try {
    const res = await fetch(url, { cache: "no-store" });
    if (!res.ok) return null;
    const json = (await res.json()) as EspnSearchResult;
    const hit = json?.results?.find((r) => r?.contents?.length)?.contents?.[0];
    if (!hit) return null;
    if (typeof hit.id === "number" || typeof hit.id === "string") {
      const raw = String(hit.id);
      if (/^\d+$/.test(raw)) espnId = raw;
    }
    if (!espnId && hit.uid) {
      const m = hit.uid.match(/:(\d+)$/);
      if (m) espnId = m[1];
    }
    if (!espnId && hit.defaultRef?.$ref) {
      const m = hit.defaultRef.$ref.match(ESPN_ID_RE);
      if (m) espnId = m[1];
    }
    if (!espnId && hit.link?.web?.href) {
      const m = hit.link.web.href.match(ESPN_ID_RE);
      if (m) espnId = m[1];
    }
  } catch {
    return null;
  }
  if (!espnId) return null;
  return `https://a.espncdn.com/combiner/i?img=/i/headshots/college-football/players/full/${espnId}.png&w=200&h=200`;
}

export async function POST(req: Request) {
  const url = new URL(req.url);
  const secret = url.searchParams.get("secret");
  const adminSecret = process.env.ADMIN_SECRET;
  if (!adminSecret) return jsonError("Missing ADMIN_SECRET env var", 500);
  if (secret !== adminSecret) return jsonError("Unauthorized", 401);

  const supabaseResult = getSupabaseAdminClient();
  if (supabaseResult.error)
    return jsonError(`Supabase admin client error: ${supabaseResult.error}`, 500);
  if (!supabaseResult.client) return jsonError("Supabase admin client is null", 500);
  const supabase = supabaseResult.client;

  // Fetch the Sleeper player dictionary directly (this is the authoritative
  // source for player_ids; ~5-10 MB).
  const sleeperRes = await fetch("https://api.sleeper.app/v1/players/nfl", {
    cache: "no-store",
  });
  if (!sleeperRes.ok) {
    return jsonError(`Sleeper fetch failed: ${sleeperRes.status}`, 502);
  }
  const dictionary = (await sleeperRes.json()) as Record<string, SleeperPlayerRecord>;
  const dictionaryCount = Object.keys(dictionary).length;
  const index = buildSleeperIndex(dictionary);

  // Fetch any existing rows so we can re-use their `player_id` (including
  // bootstrap `tmp_*` placeholders) and update in place. We key by
  // normalized name because that's the only field guaranteed stable
  // between runs.
  const { data: existingRows, error: existingErr } = await supabase
    .from("rookie_prospects")
    .select("player_id,player_name");
  if (existingErr) {
    return jsonError(`Failed to read existing rookie_prospects: ${existingErr.message}`, 500);
  }
  const existingByName = new Map<string, string>();
  for (const row of existingRows ?? []) {
    const key = normalizeProspectName(row?.player_name);
    if (key && row?.player_id) existingByName.set(key, String(row.player_id));
  }

  const matched: Array<{
    player_id: string;
    player_name: string;
    position: string;
    college: string;
    age: number;
    height_inches: number;
    weight: number;
    nfl_team: null;
    nfl_draft_round: null;
    nfl_draft_pick: null;
    avatar_url: string | null;
  }> = [];
  const unmatched: string[] = [];
  const matchSample: Array<{ name: string; player_id: string }> = [];
  let avatarHits = 0;

  for (const p of PROSPECTS) {
    const pid = findSleeperId(p, index, dictionary);
    const displayName = `${p.first} ${p.last}`;
    // Always pull the ESPN headshot — it's keyed off the player name and
    // is independent of whether we found a Sleeper id.
    const avatarUrl = await fetchEspnHeadshotUrl(displayName);
    if (avatarUrl) avatarHits += 1;
    if (!pid) unmatched.push(displayName);
    // Re-use any existing player_id (e.g. a bootstrap `tmp_*` placeholder)
    // so the upsert updates in place rather than creating a duplicate row.
    const nameKey = normalizeProspectName(displayName);
    const playerId =
      pid ?? existingByName.get(nameKey) ?? `tmp_${nameKey}`;
    matched.push({
      player_id: playerId,
      player_name: displayName,
      position: p.position,
      college: p.college,
      age: p.age,
      height_inches: p.height_inches,
      weight: p.weight,
      nfl_team: null,
      nfl_draft_round: null,
      nfl_draft_pick: null,
      avatar_url: avatarUrl,
    });
    if (pid && matchSample.length < 5) {
      matchSample.push({ name: displayName, player_id: pid });
    }
  }

  let upsertError: string | null = null;
  if (matched.length) {
    const { error: upsertErr } = await supabase
      .from("rookie_prospects")
      .upsert(matched, { onConflict: "player_id" });
    if (upsertErr) {
      upsertError = upsertErr.message;
    }
  }

  // Verify the table contents post-upsert so the caller can confirm the
  // rows actually landed.
  const { count: tableCount, error: countError } = await supabase
    .from("rookie_prospects")
    .select("player_id", { count: "exact", head: true });

  if (upsertError) {
    return NextResponse.json(
      {
        ok: false,
        error: `Upsert failed: ${upsertError}`,
        sleeper_player_count: dictionaryCount,
        requested: PROSPECTS.length,
        matched: matched.length,
        unmatched,
      },
      { status: 500 }
    );
  }

  return NextResponse.json({
    ok: true,
    sleeper_player_count: dictionaryCount,
    requested: PROSPECTS.length,
    matched: matched.length,
    sleeper_id_matches: matched.length - unmatched.length,
    avatar_hits: avatarHits,
    synced: matched.length,
    unmatched,
    sample: matchSample,
    rookie_prospects_row_count: tableCount ?? null,
    rookie_prospects_count_error: countError?.message ?? null,
  });
}
