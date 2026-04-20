#!/usr/bin/env node
/**
 * export-rosters-and-picks.mjs
 *
 * Pulls active rosters and 2026–2028 owned draft picks for the current Sleeper
 * league (2025: 1183585976810295296) from Supabase, enriches player IDs with
 * names / positions / ages from the Sleeper players API, and writes three CSVs
 * you can open directly in Excel or Google Sheets.
 *
 * Outputs (default ./out):
 *   - lineup-slots.csv          starter slot order from league_seasons.roster_positions
 *   - rosters.csv               one row per (team, player) with starter/bench split
 *   - picks-2026-2028.csv       one row per (team, round, year) of owned future picks
 *
 * Runbook
 * -------
 *   1. Ensure LLM_DATABASE_URL is set (same var the LLM health route uses).
 *      Optional: LEAGUE_ID (defaults to the 2025 league), OUT_DIR (defaults ./out).
 *   2. From the repo root:
 *        node scripts/export-rosters-and-picks.mjs
 *   3. The three CSVs land in OUT_DIR. Open them in Excel and combine into one
 *      workbook if you want a single .xlsx.
 *
 * No new npm dependencies — uses only `pg` (already in package.json) and
 * Node's built-in fetch / fs.
 */

import { mkdirSync, writeFileSync } from "node:fs";
import { join, resolve } from "node:path";
import pg from "pg";

const LEAGUE_ID = process.env.LEAGUE_ID || "1183585976810295296";
const OUT_DIR = resolve(process.env.OUT_DIR || "./out");
const SLEEPER_PLAYERS_URL = "https://api.sleeper.app/v1/players/nfl";
const PICK_YEARS = [2026, 2027, 2028];

function csvCell(value) {
  if (value === null || value === undefined) return "";
  const s = String(value);
  if (/[",\n\r]/.test(s)) return `"${s.replace(/"/g, '""')}"`;
  return s;
}

function writeCsv(path, headers, rows) {
  const lines = [headers.map(csvCell).join(",")];
  for (const row of rows) {
    lines.push(headers.map((h) => csvCell(row[h])).join(","));
  }
  writeFileSync(path, lines.join("\n") + "\n", "utf8");
}

function ageFromBirthDate(bd) {
  if (!bd) return null;
  const d = new Date(bd);
  if (Number.isNaN(d.getTime())) return null;
  const now = new Date();
  let age = now.getUTCFullYear() - d.getUTCFullYear();
  const m = now.getUTCMonth() - d.getUTCMonth();
  if (m < 0 || (m === 0 && now.getUTCDate() < d.getUTCDate())) age -= 1;
  return age;
}

async function fetchSleeperPlayers() {
  const res = await fetch(SLEEPER_PLAYERS_URL);
  if (!res.ok) throw new Error(`Sleeper players fetch ${res.status}`);
  return res.json();
}

async function main() {
  const dbUrl = process.env.LLM_DATABASE_URL;
  if (!dbUrl) {
    console.error("Missing LLM_DATABASE_URL env var.");
    process.exit(1);
  }

  mkdirSync(OUT_DIR, { recursive: true });

  const client = new pg.Client({
    connectionString: dbUrl,
    ssl: { rejectUnauthorized: false },
  });
  await client.connect();

  // 1) Lineup slots (starter order from league config)
  const slotsRes = await client.query(
    `
    WITH lg AS (
      SELECT roster_positions
      FROM public.league_seasons
      WHERE league_id = $1
    )
    SELECT
      ord::int                          AS slot_index,
      pos                               AS slot_code,
      CASE WHEN pos IN ('BN','IR','TAXI') THEN 'bench' ELSE 'starter' END AS slot_kind
    FROM lg, LATERAL jsonb_array_elements_text(lg.roster_positions)
             WITH ORDINALITY AS s(pos, ord)
    ORDER BY ord;
    `,
    [LEAGUE_ID],
  );

  if (slotsRes.rowCount === 0) {
    throw new Error(
      `No row in league_seasons for league_id=${LEAGUE_ID}. ` +
        `Check LEAGUE_ID or sync league history first.`,
    );
  }

  writeCsv(
    join(OUT_DIR, "lineup-slots.csv"),
    ["slot_index", "slot_code", "slot_kind"],
    slotsRes.rows,
  );

  // 2) Rosters (latest snapshot per team)
  const rostersRes = await client.query(
    `
    WITH latest_snap AS (
      SELECT DISTINCT ON (s.league_id, s.roster_id)
             s.id        AS snapshot_id,
             s.league_id,
             s.roster_id
      FROM public.league_roster_snapshots s
      WHERE s.league_id = $1
      ORDER BY s.league_id, s.roster_id, s.snapped_at DESC
    )
    SELECT
      t.roster_id,
      COALESCE(t.team_name, u.team_name, u.display_name, t.roster_id::text) AS team_name,
      rp.slot_type,
      rp.player_id AS sleeper_player_id
    FROM latest_snap ls
    JOIN public.league_teams t
      ON t.league_id = ls.league_id AND t.roster_id = ls.roster_id
    LEFT JOIN public.league_users u
      ON u.league_id = t.league_id AND u.user_id = t.owner_id
    JOIN public.league_roster_players rp
      ON rp.snapshot_id = ls.snapshot_id
    ORDER BY team_name, rp.slot_type, rp.player_id;
    `,
    [LEAGUE_ID],
  );

  // 3) Owned future picks 2026–2028
  const picksRes = await client.query(
    `
    WITH draft_rounds AS (
      -- Default to 4 rounds if no draft history is recorded yet (typical
      -- rookie-draft length for this league); otherwise use the largest
      -- recorded round count across past drafts of this franchise line.
      SELECT COALESCE(MAX((settings->>'rounds')::int), 4) AS rounds
      FROM public.league_drafts
      WHERE league_id IN (
        SELECT league_id FROM public.league_seasons
        WHERE league_id = $1 OR previous_league_id = $1
      )
    ),
    years (pick_season) AS (
      SELECT unnest($2::int[])
    ),
    rounds AS (
      SELECT generate_series(1, (SELECT rounds FROM draft_rounds)) AS round
    ),
    teams AS (
      SELECT roster_id FROM public.league_teams WHERE league_id = $1
    ),
    defaults AS (
      SELECT y.pick_season, r.round, t.roster_id AS original_owner_roster_id
      FROM years y CROSS JOIN rounds r CROSS JOIN teams t
    ),
    trades AS (
      SELECT DISTINCT ON (pick_season, round, original_owner_roster_id)
             pick_season, round, original_owner_roster_id, owner_roster_id
      FROM public.league_traded_picks
      WHERE league_id = $1
        AND pick_season = ANY($2::int[])
      ORDER BY pick_season, round, original_owner_roster_id, source_season DESC
    )
    SELECT
      COALESCE(t.owner_roster_id, d.original_owner_roster_id) AS current_owner_roster_id,
      COALESCE(team.team_name, u.team_name, u.display_name,
               COALESCE(t.owner_roster_id, d.original_owner_roster_id)::text)
                                                              AS current_owner_team_name,
      d.round                                                 AS pick_round,
      d.pick_season                                           AS pick_year,
      d.original_owner_roster_id,
      COALESCE(orig_team.team_name, orig_u.team_name, orig_u.display_name,
               d.original_owner_roster_id::text)              AS original_owner_team_name,
      (t.owner_roster_id IS NOT NULL
        AND t.owner_roster_id <> d.original_owner_roster_id)  AS was_traded
    FROM defaults d
    LEFT JOIN trades t
      ON t.pick_season = d.pick_season
     AND t.round       = d.round
     AND t.original_owner_roster_id = d.original_owner_roster_id
    LEFT JOIN public.league_teams team
      ON team.league_id = $1
     AND team.roster_id = COALESCE(t.owner_roster_id, d.original_owner_roster_id)
    LEFT JOIN public.league_users u
      ON u.league_id = team.league_id AND u.user_id = team.owner_id
    LEFT JOIN public.league_teams orig_team
      ON orig_team.league_id = $1
     AND orig_team.roster_id = d.original_owner_roster_id
    LEFT JOIN public.league_users orig_u
      ON orig_u.league_id = orig_team.league_id AND orig_u.user_id = orig_team.owner_id
    ORDER BY current_owner_team_name, pick_round, pick_year;
    `,
    [LEAGUE_ID, PICK_YEARS],
  );

  await client.end();

  // 4) Enrich players via Sleeper
  console.log(
    `Fetched ${rostersRes.rowCount} roster rows, ${picksRes.rowCount} pick rows. ` +
      `Loading Sleeper player dictionary…`,
  );
  const players = await fetchSleeperPlayers();

  const slotOrder = { starter: 0, bench: 1, ir: 2, taxi: 3 };

  const rosterRows = rostersRes.rows.map((r) => {
    const p = players[r.sleeper_player_id] || {};
    const name =
      p.full_name ||
      [p.first_name, p.last_name].filter(Boolean).join(" ") ||
      p.search_full_name ||
      "";
    return {
      team_name: r.team_name,
      roster_id: r.roster_id,
      slot_type: r.slot_type,
      slot_kind: r.slot_type === "starter" ? "starter" : "bench",
      position: p.position || "",
      nfl_team: p.team || "",
      player_name: name,
      age: ageFromBirthDate(p.birth_date),
      sleeper_player_id: r.sleeper_player_id,
    };
  });

  rosterRows.sort((a, b) => {
    if (a.team_name !== b.team_name) return a.team_name.localeCompare(b.team_name);
    const sa = slotOrder[a.slot_type] ?? 9;
    const sb = slotOrder[b.slot_type] ?? 9;
    if (sa !== sb) return sa - sb;
    if (a.position !== b.position) return a.position.localeCompare(b.position);
    return a.player_name.localeCompare(b.player_name);
  });

  writeCsv(
    join(OUT_DIR, "rosters.csv"),
    [
      "team_name",
      "roster_id",
      "slot_kind",
      "slot_type",
      "position",
      "nfl_team",
      "player_name",
      "age",
      "sleeper_player_id",
    ],
    rosterRows,
  );

  writeCsv(
    join(OUT_DIR, "picks-2026-2028.csv"),
    [
      "current_owner_team_name",
      "current_owner_roster_id",
      "pick_round",
      "pick_year",
      "original_owner_team_name",
      "original_owner_roster_id",
      "was_traded",
    ],
    picksRes.rows,
  );

  console.log(`Wrote:`);
  console.log(`  ${join(OUT_DIR, "lineup-slots.csv")}`);
  console.log(`  ${join(OUT_DIR, "rosters.csv")}`);
  console.log(`  ${join(OUT_DIR, "picks-2026-2028.csv")}`);
  console.log(
    `League: ${LEAGUE_ID}  |  Pick years: ${PICK_YEARS.join(", ")}  |  Out dir: ${OUT_DIR}`,
  );
}

main().catch((err) => {
  console.error(err);
  process.exit(1);
});
