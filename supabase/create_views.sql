-- ============================================================================
-- Fantasy Football League History Views
-- Paste this entire script into the Supabase SQL Editor and run it.
--
-- Creates (or replaces) 4 views on top of the existing warehouse tables.
-- No underlying tables are modified.
-- ============================================================================

-- ─────────────────────────────────────────────────────────────────────────────
-- 1. view_draft_history
-- ─────────────────────────────────────────────────────────────────────────────
-- One row per draft pick with full team context and player name.
--
-- Key columns:
--   round_pick        – pick number within the round (1-based)
--   overall_pick      – absolute pick number across the whole draft
--   sleeper_player_id – Sleeper player ID of the drafted player

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
--
-- Key columns:
--   transaction_created_at – canonical trade timestamp
--   sleeper_player_id      – Sleeper player ID (null for pick assets)
--   asset_type             – 'player' | 'draft_pick'

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
-- Key columns:
--   sleeper_player_id – Sleeper player ID
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
-- One row per team per matchup with opponent data.
--
-- Key columns:
--   team_name            – this team's display name
--   opponent_team_name   – opponent's display name
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
