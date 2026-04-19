import { NextResponse } from "next/server";

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
  position?: string;
  fantasy_positions?: string[];
};

const norm = (s: string | undefined) =>
  (s ?? "")
    .toLowerCase()
    .normalize("NFKD")
    .replace(/[\u0300-\u036f]/g, "")
    .replace(/[^a-z]/g, "")
    .trim();

function jsonError(message: string, status = 400) {
  return NextResponse.json({ ok: false, error: message }, { status });
}

function findSleeperId(
  prospect: Prospect,
  dictionary: Record<string, SleeperPlayerRecord>
): string | null {
  const targetFirst = norm(prospect.first);
  const targetLast = norm(prospect.last);
  const targetFull = `${targetFirst}${targetLast}`;
  const targetPos = prospect.position;

  for (const [pid, p] of Object.entries(dictionary)) {
    if (!p || typeof p !== "object") continue;
    const positions = [p.position, ...(p.fantasy_positions ?? [])]
      .filter(Boolean)
      .map((x) => String(x).toUpperCase());
    if (!positions.includes(targetPos)) continue;

    const first = norm(p.first_name);
    const last = norm(p.last_name);
    const full = norm(p.full_name);

    if (first === targetFirst && last === targetLast) return pid;
    if (full && full === targetFull) return pid;
    // Looser fallback: last name match + first-name initial match (handles
    // suffix/punctuation differences like "Mike Washington Jr.").
    if (
      last === targetLast &&
      first &&
      targetFirst &&
      first.charAt(0) === targetFirst.charAt(0)
    ) {
      return pid;
    }
  }
  return null;
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

  const matched: Array<{
    player_id: string;
    name: string;
    position: string;
    college: string;
    age: number;
    height_inches: number;
    weight: number;
    nfl_team: null;
    nfl_draft_round: null;
    nfl_draft_pick: null;
    avatar_url: null;
  }> = [];
  const unmatched: string[] = [];

  for (const p of PROSPECTS) {
    const pid = findSleeperId(p, dictionary);
    const displayName = `${p.first} ${p.last}`;
    if (!pid) {
      unmatched.push(displayName);
      continue;
    }
    matched.push({
      player_id: pid,
      name: displayName,
      position: p.position,
      college: p.college,
      age: p.age,
      height_inches: p.height_inches,
      weight: p.weight,
      nfl_team: null,
      nfl_draft_round: null,
      nfl_draft_pick: null,
      avatar_url: null,
    });
  }

  if (matched.length) {
    const { error: upsertErr } = await supabase
      .from("rookie_prospects")
      .upsert(matched, { onConflict: "player_id" });
    if (upsertErr) {
      return jsonError(`Upsert failed: ${upsertErr.message}`, 500);
    }
  }

  return NextResponse.json({
    ok: true,
    requested: PROSPECTS.length,
    synced: matched.length,
    unmatched,
  });
}
