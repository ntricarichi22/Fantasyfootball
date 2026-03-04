-- Migration 006: Normalize helper views for clean, canonical query surfaces
--
-- Goals:
--   • Stable, human-readable column names across all league-history views
--   • Use sleeper_player_id (not player_id) in every view
--   • Use transaction_created_at (not sleeper_created_at)
--   • view_trade_history exposes one row per moved asset
--   • view_draft_history exposes round_pick, overall_pick, and player_name
--   • view_current_rosters exposes lineup_status and player_name
--   • view_matchup_history gains team_name / opponent_team_name
--
-- Underlying warehouse tables are left intact.

-- ─────────────────────────────────────────────────────────────────────────────
-- 1. view_draft_history
-- ─────────────────────────────────────────────────────────────────────────────
-- One row per draft pick with full team context and player name.
--
-- Columns:
--   season             – league season year (text)
--   draft_id           – Sleeper draft ID
--   round              – draft round number
--   round_pick         – pick number within the round (1-based)
--   overall_pick       – absolute pick number across the whole draft
--   roster_id          – picking team's roster ID
--   team_name          – picking team's display name
--   owner_id           – Sleeper user_id of the team owner
--   sleeper_player_id  – Sleeper player ID of the drafted player
--   player_name        – display name from cfc_assets (null if not indexed)

CREATE OR REPLACE VIEW view_draft_history AS
SELECT
  dp.season,
  dp.draft_id,
  dp.round,
  ROW_NUMBER() OVER (
    PARTITION BY dp.draft_id, dp.round
    ORDER BY dp.pick_no
  )::INT                           AS round_pick,
  dp.pick_no                       AS overall_pick,
  dp.roster_id,
  t.team_name,
  t.owner_id,
  dp.player_id                     AS sleeper_player_id,
  a.display_name                   AS player_name
FROM league_draft_picks dp
LEFT JOIN league_teams t
  ON  t.league_id = dp.league_id
  AND t.roster_id = dp.roster_id
LEFT JOIN cfc_assets a
  ON  a.sleeper_player_id = dp.player_id
ORDER BY dp.season, dp.pick_no;

-- ─────────────────────────────────────────────────────────────────────────────
-- 2. view_trade_history
-- ─────────────────────────────────────────────────────────────────────────────
-- One row per moved asset within a trade transaction.
-- Joins league_transaction_assets → league_transactions for metadata.
--
-- Columns:
--   season                 – league season year (text)
--   transaction_id         – Sleeper transaction ID
--   week                   – NFL week the trade was processed
--   transaction_type       – always 'trade' for this view
--   transaction_created_at – canonical timestamp (maps to sleeper_created_at)
--   roster_id              – team that received this asset (to_roster_id)
--   team_name              – receiving team's display name
--   asset_type             – 'player' | 'draft_pick'
--   asset_key              – player_id for players; '<pick_season>-R<pick_round>' for picks
--   sleeper_player_id      – Sleeper player ID (null for pick assets)
--   player_name            – display name from cfc_assets (null for picks or unindexed players)
--   pick_season            – pick's draft year (null for player assets)
--   pick_round             – pick's round number (null for player assets)
--   pick_number            – specific pick number (not known at trade time; always null)

CREATE OR REPLACE VIEW view_trade_history AS
SELECT
  tx.season,
  tx.transaction_id,
  tx.week,
  tx.transaction_type,
  tx.sleeper_created_at            AS transaction_created_at,
  ta.to_roster_id                  AS roster_id,
  t.team_name,
  ta.asset_type,
  CASE
    WHEN ta.asset_type = 'player' THEN ta.player_id
    ELSE ta.pick_season || '-R' || ta.pick_round::TEXT
  END                              AS asset_key,
  ta.player_id                     AS sleeper_player_id,
  a.display_name                   AS player_name,
  ta.pick_season,
  ta.pick_round,
  NULL::INT                        AS pick_number
FROM league_transaction_assets ta
JOIN league_transactions tx
  ON  tx.transaction_id = ta.transaction_id
 AND  tx.transaction_type = 'trade'
LEFT JOIN league_teams t
  ON  t.league_id = ta.league_id
  AND t.season    = ta.season
  AND t.roster_id = ta.to_roster_id
LEFT JOIN cfc_assets a
  ON  a.sleeper_player_id = ta.player_id
ORDER BY tx.sleeper_created_at DESC NULLS LAST;

-- ─────────────────────────────────────────────────────────────────────────────
-- 3. view_current_rosters
-- ─────────────────────────────────────────────────────────────────────────────
-- Current (latest season) team rosters using season-end snapshots.
-- One row per player per team.
--
-- Columns:
--   season            – latest season year for the league (text)
--   week              – snapshot week (0 = season-end sentinel)
--   league_id         – Sleeper league ID
--   roster_id         – team's roster ID within the league
--   owner_id          – Sleeper user_id of the team owner
--   team_name         – team's display name
--   sleeper_player_id – Sleeper player ID (renamed from player_id)
--   player_name       – display name from cfc_assets (null if not indexed)
--   lineup_status     – 'starter' | 'bench' | 'ir' | 'taxi' | 'roster'

CREATE OR REPLACE VIEW view_current_rosters AS
SELECT
  t.season,
  rs.week,
  t.league_id,
  t.roster_id,
  t.owner_id,
  t.team_name,
  rp.player_id                     AS sleeper_player_id,
  a.display_name                   AS player_name,
  rp.slot_type                     AS lineup_status
FROM league_teams t
JOIN league_roster_snapshots rs
  ON  rs.league_id = t.league_id
  AND rs.season    = t.season
  AND rs.roster_id = t.roster_id
  AND rs.snap_type = 'season_end'
JOIN league_roster_players rp
  ON  rp.snapshot_id = rs.id
LEFT JOIN cfc_assets a
  ON  a.sleeper_player_id = rp.player_id
WHERE t.season = (
  SELECT MAX(s2.season)
  FROM league_seasons s2
  WHERE s2.league_id = t.league_id
     OR s2.previous_league_id = t.league_id
);

-- ─────────────────────────────────────────────────────────────────────────────
-- 4. view_matchup_history
-- ─────────────────────────────────────────────────────────────────────────────
-- One row per team per matchup.  Adds team_name / opponent_team_name so
-- callers don't need to join league_teams separately.
--
-- Columns:
--   season               – league season year (text)
--   week                 – NFL week number
--   matchup_id           – Sleeper matchup pairing ID
--   roster_id            – this team's roster ID
--   team_name            – this team's display name
--   team_points          – points scored by this team
--   opponent_roster_id   – opponent's roster ID
--   opponent_team_name   – opponent's display name
--   opponent_points      – points scored by opponent
--   result               – 'W' | 'L' | 'T' | null
--   matchup_type         – 'regular' | 'playoff' | 'consolation'

CREATE OR REPLACE VIEW view_matchup_history AS
SELECT
  a.season,
  a.week,
  a.matchup_id,
  a.roster_id,
  t_a.team_name,
  a.points                         AS team_points,
  b.roster_id                      AS opponent_roster_id,
  t_b.team_name                    AS opponent_team_name,
  b.points                         AS opponent_points,
  CASE WHEN a.points > b.points  THEN 'W'
       WHEN a.points < b.points  THEN 'L'
       WHEN a.points IS NOT NULL THEN 'T'
       ELSE NULL
  END                              AS result,
  m.matchup_type
FROM league_matchup_teams a
JOIN league_matchup_teams b
  ON  b.league_id  = a.league_id
  AND b.season     = a.season
  AND b.week       = a.week
  AND b.matchup_id = a.matchup_id
  AND b.roster_id <> a.roster_id
JOIN league_matchups m
  ON  m.league_id  = a.league_id
  AND m.season     = a.season
  AND m.week       = a.week
  AND m.matchup_id = a.matchup_id
LEFT JOIN league_teams t_a
  ON  t_a.league_id = a.league_id
  AND t_a.season    = a.season
  AND t_a.roster_id = a.roster_id
LEFT JOIN league_teams t_b
  ON  t_b.league_id = b.league_id
  AND t_b.season    = b.season
  AND t_b.roster_id = b.roster_id
ORDER BY a.season, a.week, a.matchup_id;

-- ─────────────────────────────────────────────────────────────────────────────
-- Sample queries (for reference / LLM tooling)
-- ─────────────────────────────────────────────────────────────────────────────

-- Kentucky Kush round 1 picks in 2025:
-- SELECT * FROM view_draft_history
-- WHERE season = '2025' AND team_name = 'Kentucky Kush' AND round = 1;

-- All 2025 trades ordered newest first:
-- SELECT * FROM view_trade_history
-- WHERE season = '2025'
-- ORDER BY transaction_created_at DESC NULLS LAST;

-- Championship history by season:
-- SELECT * FROM view_championship_history ORDER BY season DESC;

-- Current roster for Virginia Founders:
-- SELECT * FROM view_current_rosters WHERE team_name = 'Virginia Founders';
