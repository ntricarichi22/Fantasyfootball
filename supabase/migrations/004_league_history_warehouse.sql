-- Migration: League-history warehouse + sync pipeline
-- Creates a complete normalized warehouse of Sleeper league history.
-- All tables use Sleeper canonical IDs as keys and include raw_json for auditability.
-- Safe to run multiple times (uses CREATE TABLE IF NOT EXISTS, CREATE OR REPLACE VIEW).

-- ─────────────────────────────────────────────────────────────────────────────
-- CORE IDENTITY / LEAGUE METADATA
-- ─────────────────────────────────────────────────────────────────────────────

-- One row per Sleeper league season.
-- Each season in Sleeper has its own unique league_id; seasons are linked via
-- previous_league_id.
CREATE TABLE IF NOT EXISTS league_seasons (
  id                   UUID        PRIMARY KEY DEFAULT gen_random_uuid(),
  league_id            TEXT        NOT NULL,
  season               TEXT        NOT NULL,
  name                 TEXT,
  status               TEXT,
  sport                TEXT        DEFAULT 'nfl',
  season_type          TEXT,
  total_rosters        INT,
  playoff_week_start   INT,
  last_scored_leg      INT,
  settings             JSONB,
  scoring_settings     JSONB,
  roster_positions     JSONB,
  previous_league_id   TEXT,
  draft_id             TEXT,
  metadata             JSONB,
  raw_json             JSONB,
  created_at           TIMESTAMPTZ NOT NULL DEFAULT now(),
  updated_at           TIMESTAMPTZ NOT NULL DEFAULT now(),
  UNIQUE (league_id)
);

-- Users who participated in a given league season.
CREATE TABLE IF NOT EXISTS league_users (
  id           UUID        PRIMARY KEY DEFAULT gen_random_uuid(),
  league_id    TEXT        NOT NULL,
  season       TEXT        NOT NULL,
  user_id      TEXT        NOT NULL,
  display_name TEXT,
  team_name    TEXT,
  avatar       TEXT,
  is_owner     BOOLEAN     DEFAULT false,
  metadata     JSONB,
  raw_json     JSONB,
  created_at   TIMESTAMPTZ NOT NULL DEFAULT now(),
  updated_at   TIMESTAMPTZ NOT NULL DEFAULT now(),
  UNIQUE (league_id, user_id)
);

-- Teams (rosters) per league season.  roster_id is the 1–N integer Sleeper
-- assigns within each league; it is stable across the season but may differ
-- across seasons for the same franchise.
CREATE TABLE IF NOT EXISTS league_teams (
  id           UUID        PRIMARY KEY DEFAULT gen_random_uuid(),
  league_id    TEXT        NOT NULL,
  season       TEXT        NOT NULL,
  roster_id    INT         NOT NULL,
  owner_id     TEXT,
  co_owners    JSONB,
  team_name    TEXT,
  settings     JSONB,
  metadata     JSONB,
  raw_json     JSONB,
  created_at   TIMESTAMPTZ NOT NULL DEFAULT now(),
  updated_at   TIMESTAMPTZ NOT NULL DEFAULT now(),
  UNIQUE (league_id, roster_id)
);

-- ─────────────────────────────────────────────────────────────────────────────
-- ROSTERS
-- ─────────────────────────────────────────────────────────────────────────────

-- Snapshots of a team's roster.  week = 0 is used as a sentinel for the
-- season-end snapshot (fetched directly from /league/{id}/rosters).
-- Weekly snapshots are derived from matchup data.
CREATE TABLE IF NOT EXISTS league_roster_snapshots (
  id           UUID        PRIMARY KEY DEFAULT gen_random_uuid(),
  league_id    TEXT        NOT NULL,
  season       TEXT        NOT NULL,
  roster_id    INT         NOT NULL,
  week         INT         NOT NULL DEFAULT 0,  -- 0 = season-end
  snap_type    TEXT        NOT NULL DEFAULT 'season_end', -- 'season_end' | 'weekly'
  snapped_at   TIMESTAMPTZ,
  raw_json     JSONB,
  created_at   TIMESTAMPTZ NOT NULL DEFAULT now(),
  updated_at   TIMESTAMPTZ NOT NULL DEFAULT now(),
  UNIQUE (league_id, season, roster_id, week, snap_type)
);

-- Individual players in each roster snapshot.
CREATE TABLE IF NOT EXISTS league_roster_players (
  id           UUID        PRIMARY KEY DEFAULT gen_random_uuid(),
  snapshot_id  UUID        NOT NULL REFERENCES league_roster_snapshots (id) ON DELETE CASCADE,
  player_id    TEXT        NOT NULL,
  slot_type    TEXT        NOT NULL DEFAULT 'roster', -- 'starter' | 'bench' | 'ir' | 'taxi' | 'roster'
  created_at   TIMESTAMPTZ NOT NULL DEFAULT now()
);

-- ─────────────────────────────────────────────────────────────────────────────
-- DRAFTS
-- ─────────────────────────────────────────────────────────────────────────────

-- One row per Sleeper draft (startup, rookie, etc.).
CREATE TABLE IF NOT EXISTS league_drafts (
  id                UUID        PRIMARY KEY DEFAULT gen_random_uuid(),
  draft_id          TEXT        NOT NULL UNIQUE,
  league_id         TEXT        NOT NULL,
  season            TEXT        NOT NULL,
  draft_type        TEXT,
  status            TEXT,
  start_time        TIMESTAMPTZ,
  draft_order       JSONB,
  slot_to_roster_id JSONB,
  settings          JSONB,
  metadata          JSONB,
  raw_json          JSONB,
  created_at        TIMESTAMPTZ NOT NULL DEFAULT now(),
  updated_at        TIMESTAMPTZ NOT NULL DEFAULT now()
);

-- Individual picks in each draft.
CREATE TABLE IF NOT EXISTS league_draft_picks (
  id          UUID        PRIMARY KEY DEFAULT gen_random_uuid(),
  draft_id    TEXT        NOT NULL,
  league_id   TEXT        NOT NULL,
  season      TEXT        NOT NULL,
  pick_no     INT         NOT NULL,
  round       INT         NOT NULL,
  roster_id   INT         NOT NULL,
  player_id   TEXT        NOT NULL,
  picked_by   TEXT,
  is_keeper   BOOLEAN     DEFAULT false,
  metadata    JSONB,
  raw_json    JSONB,
  created_at  TIMESTAMPTZ NOT NULL DEFAULT now(),
  UNIQUE (draft_id, pick_no)
);

-- ─────────────────────────────────────────────────────────────────────────────
-- TRANSACTIONS / TRADES
-- ─────────────────────────────────────────────────────────────────────────────

-- One row per transaction (trade, add, drop, waiver, commissioner action).
CREATE TABLE IF NOT EXISTS league_transactions (
  id                 UUID        PRIMARY KEY DEFAULT gen_random_uuid(),
  transaction_id     TEXT        NOT NULL,
  league_id          TEXT        NOT NULL,
  season             TEXT        NOT NULL,
  week               INT,
  transaction_type   TEXT        NOT NULL,
  status             TEXT,
  status_updated_at  TIMESTAMPTZ,
  leg                INT,
  consenter_ids      JSONB,
  roster_ids         JSONB,
  drops              JSONB,
  adds               JSONB,
  draft_picks        JSONB,
  waiver_budget      JSONB,
  settings           JSONB,
  metadata           JSONB,
  raw_json           JSONB,
  sleeper_created_at TIMESTAMPTZ,
  created_at         TIMESTAMPTZ NOT NULL DEFAULT now(),
  updated_at         TIMESTAMPTZ NOT NULL DEFAULT now(),
  UNIQUE (transaction_id)
);

-- Individual assets (players or picks) transferred in a transaction.
CREATE TABLE IF NOT EXISTS league_transaction_assets (
  id               UUID  PRIMARY KEY DEFAULT gen_random_uuid(),
  transaction_id   TEXT  NOT NULL,
  league_id        TEXT  NOT NULL,
  season           TEXT  NOT NULL,
  asset_type       TEXT  NOT NULL,  -- 'player' | 'draft_pick'
  player_id        TEXT,            -- for player assets
  pick_season      TEXT,            -- for pick assets
  pick_round       INT,             -- for pick assets
  pick_roster_id   INT,             -- original owner roster_id (for picks)
  from_roster_id   INT,
  to_roster_id     INT,
  direction        TEXT,            -- 'add' | 'drop' (for non-trade transactions)
  created_at       TIMESTAMPTZ NOT NULL DEFAULT now()
);

-- ─────────────────────────────────────────────────────────────────────────────
-- MATCHUPS / RESULTS
-- ─────────────────────────────────────────────────────────────────────────────

-- One row per logical matchup (pair of teams) per week.
-- matchup_id is the Sleeper integer that pairs two teams in the same week.
CREATE TABLE IF NOT EXISTS league_matchups (
  id           UUID  PRIMARY KEY DEFAULT gen_random_uuid(),
  league_id    TEXT  NOT NULL,
  season       TEXT  NOT NULL,
  week         INT   NOT NULL,
  matchup_id   INT   NOT NULL,
  matchup_type TEXT  DEFAULT 'regular',  -- 'regular' | 'playoff' | 'consolation'
  created_at   TIMESTAMPTZ NOT NULL DEFAULT now(),
  updated_at   TIMESTAMPTZ NOT NULL DEFAULT now(),
  UNIQUE (league_id, season, week, matchup_id)
);

-- Each team's data within a matchup (points, starters, players).
CREATE TABLE IF NOT EXISTS league_matchup_teams (
  id              UUID        PRIMARY KEY DEFAULT gen_random_uuid(),
  league_id       TEXT        NOT NULL,
  season          TEXT        NOT NULL,
  week            INT         NOT NULL,
  matchup_id      INT         NOT NULL,
  roster_id       INT         NOT NULL,
  points          NUMERIC(8,2),
  custom_points   NUMERIC(8,2),
  starters        JSONB,
  players         JSONB,
  starters_points JSONB,
  players_points  JSONB,
  raw_json        JSONB,
  created_at      TIMESTAMPTZ NOT NULL DEFAULT now(),
  updated_at      TIMESTAMPTZ NOT NULL DEFAULT now(),
  UNIQUE (league_id, season, week, roster_id)
);

-- ─────────────────────────────────────────────────────────────────────────────
-- PLAYOFFS / SEASON OUTCOMES
-- ─────────────────────────────────────────────────────────────────────────────

-- Playoff bracket game results.
CREATE TABLE IF NOT EXISTS league_playoff_bracket_games (
  id               UUID        PRIMARY KEY DEFAULT gen_random_uuid(),
  league_id        TEXT        NOT NULL,
  season           TEXT        NOT NULL,
  bracket_type     TEXT        NOT NULL DEFAULT 'winners',  -- 'winners' | 'losers'
  round            INT         NOT NULL,
  match_id         INT         NOT NULL,
  roster_id_1      INT,
  roster_id_2      INT,
  winner_roster_id INT,
  loser_roster_id  INT,
  placement        INT,  -- e.g. 1 = championship game
  raw_json         JSONB,
  created_at       TIMESTAMPTZ NOT NULL DEFAULT now(),
  updated_at       TIMESTAMPTZ NOT NULL DEFAULT now(),
  UNIQUE (league_id, season, bracket_type, round, match_id)
);

-- Final regular-season and overall standings per team per season.
-- Derived from roster settings at season end.
CREATE TABLE IF NOT EXISTS league_final_standings (
  id           UUID        PRIMARY KEY DEFAULT gen_random_uuid(),
  league_id    TEXT        NOT NULL,
  season       TEXT        NOT NULL,
  roster_id    INT         NOT NULL,
  place        INT,
  wins         INT,
  losses       INT,
  ties         INT,
  fpts         NUMERIC(10,2),
  fpts_against NUMERIC(10,2),
  ppts         NUMERIC(10,2),
  streak       TEXT,
  record       TEXT,
  raw_json     JSONB,
  created_at   TIMESTAMPTZ NOT NULL DEFAULT now(),
  updated_at   TIMESTAMPTZ NOT NULL DEFAULT now(),
  UNIQUE (league_id, season, roster_id)
);

-- Championship winner (and runner-up) per season.
-- Derived from the winners bracket after the season is complete.
CREATE TABLE IF NOT EXISTS league_champions (
  id                  UUID        PRIMARY KEY DEFAULT gen_random_uuid(),
  league_id           TEXT        NOT NULL,
  season              TEXT        NOT NULL,
  winner_roster_id    INT,
  winner_user_id      TEXT,
  winner_team_name    TEXT,
  runner_up_roster_id INT,
  runner_up_user_id   TEXT,
  runner_up_team_name TEXT,
  raw_json            JSONB,
  created_at          TIMESTAMPTZ NOT NULL DEFAULT now(),
  updated_at          TIMESTAMPTZ NOT NULL DEFAULT now(),
  UNIQUE (league_id, season)
);

-- Current state of traded future draft picks (refreshed each sync).
-- Answers: "Who currently owns the 2027 Kentucky 1st?"
CREATE TABLE IF NOT EXISTS league_traded_picks (
  id                UUID        PRIMARY KEY DEFAULT gen_random_uuid(),
  league_id         TEXT        NOT NULL,
  source_season     TEXT        NOT NULL,  -- season this snapshot was taken from
  pick_season       TEXT        NOT NULL,  -- year the pick will be used
  round             INT         NOT NULL,
  owner_roster_id   INT         NOT NULL,  -- current owner
  previous_owner_roster_id INT,
  original_owner_roster_id INT NOT NULL,
  raw_json          JSONB,
  created_at        TIMESTAMPTZ NOT NULL DEFAULT now(),
  updated_at        TIMESTAMPTZ NOT NULL DEFAULT now(),
  UNIQUE (league_id, source_season, pick_season, round, original_owner_roster_id)
);

-- ─────────────────────────────────────────────────────────────────────────────
-- INDEXES
-- ─────────────────────────────────────────────────────────────────────────────

CREATE INDEX IF NOT EXISTS idx_league_users_season       ON league_users (season);
CREATE INDEX IF NOT EXISTS idx_league_users_user_id      ON league_users (user_id);
CREATE INDEX IF NOT EXISTS idx_league_teams_season       ON league_teams (season);
CREATE INDEX IF NOT EXISTS idx_league_teams_owner_id     ON league_teams (owner_id);
CREATE INDEX IF NOT EXISTS idx_league_drafts_season      ON league_drafts (season);
CREATE INDEX IF NOT EXISTS idx_league_draft_picks_player ON league_draft_picks (player_id);
CREATE INDEX IF NOT EXISTS idx_league_draft_picks_season ON league_draft_picks (season);
CREATE INDEX IF NOT EXISTS idx_league_txn_type           ON league_transactions (transaction_type);
CREATE INDEX IF NOT EXISTS idx_league_txn_season_week    ON league_transactions (season, week);
CREATE INDEX IF NOT EXISTS idx_league_txn_assets_txn     ON league_transaction_assets (transaction_id);
CREATE INDEX IF NOT EXISTS idx_league_txn_assets_player  ON league_transaction_assets (player_id);
CREATE INDEX IF NOT EXISTS idx_league_matchup_teams_week ON league_matchup_teams (season, week);
CREATE INDEX IF NOT EXISTS idx_league_roster_snap_season ON league_roster_snapshots (league_id, season);
CREATE INDEX IF NOT EXISTS idx_league_traded_picks_pick  ON league_traded_picks (pick_season, round, original_owner_roster_id);

-- ─────────────────────────────────────────────────────────────────────────────
-- HELPER VIEWS
-- ─────────────────────────────────────────────────────────────────────────────

-- Current (latest season) team rosters.
-- Returns one row per player per team using season-end roster snapshots.
CREATE OR REPLACE VIEW view_current_rosters AS
SELECT
  t.season,
  t.league_id,
  t.roster_id,
  t.owner_id,
  t.team_name,
  rp.player_id,
  rp.slot_type
FROM league_teams t
JOIN league_roster_snapshots rs
  ON rs.league_id = t.league_id
 AND rs.season    = t.season
 AND rs.roster_id = t.roster_id
 AND rs.snap_type = 'season_end'
JOIN league_roster_players rp ON rp.snapshot_id = rs.id
WHERE t.season = (
  SELECT MAX(s2.season)
  FROM league_seasons s2
  WHERE s2.league_id = t.league_id
    OR s2.previous_league_id = t.league_id
);

-- Current pick ownership across all future seasons.
-- Answers: "Who owns the 2027 1st round pick originally belonging to team X?"
CREATE OR REPLACE VIEW view_pick_ownership AS
SELECT
  tp.league_id,
  tp.source_season,
  tp.pick_season,
  tp.round,
  tp.owner_roster_id,
  tp.original_owner_roster_id,
  orig_team.team_name  AS original_team_name,
  owner_team.team_name AS current_owner_team_name
FROM league_traded_picks tp
LEFT JOIN league_teams orig_team
  ON orig_team.league_id = tp.league_id
 AND orig_team.roster_id = tp.original_owner_roster_id
LEFT JOIN league_teams owner_team
  ON owner_team.league_id = tp.league_id
 AND owner_team.roster_id = tp.owner_roster_id;

-- Draft history: every draft pick with team context.
CREATE OR REPLACE VIEW view_draft_history AS
SELECT
  dp.season,
  dp.draft_id,
  dp.round,
  dp.pick_no,
  dp.roster_id,
  dp.player_id,
  t.team_name,
  t.owner_id
FROM league_draft_picks dp
LEFT JOIN league_teams t
  ON t.league_id = dp.league_id
 AND t.roster_id = dp.roster_id
ORDER BY dp.season, dp.pick_no;

-- Championship history: winner and runner-up by season.
CREATE OR REPLACE VIEW view_championship_history AS
SELECT
  c.season,
  c.league_id,
  c.winner_roster_id,
  c.winner_team_name,
  c.winner_user_id,
  c.runner_up_roster_id,
  c.runner_up_team_name,
  c.runner_up_user_id
FROM league_champions c
ORDER BY c.season DESC;

-- Trade history: one row per trade transaction with participating team names.
CREATE OR REPLACE VIEW view_trade_history AS
SELECT
  tx.season,
  tx.week,
  tx.transaction_id,
  tx.roster_ids,
  tx.draft_picks,
  tx.adds,
  tx.drops,
  tx.sleeper_created_at
FROM league_transactions tx
WHERE tx.transaction_type = 'trade'
ORDER BY tx.sleeper_created_at DESC NULLS LAST;

-- Matchup history: one row per team per matchup with opponent data.
CREATE OR REPLACE VIEW view_matchup_history AS
SELECT
  a.season,
  a.week,
  a.matchup_id,
  a.roster_id,
  a.points          AS team_points,
  b.roster_id       AS opponent_roster_id,
  b.points          AS opponent_points,
  CASE WHEN a.points > b.points  THEN 'W'
       WHEN a.points < b.points  THEN 'L'
       WHEN a.points IS NOT NULL THEN 'T'
       ELSE NULL
  END               AS result,
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
ORDER BY a.season, a.week, a.matchup_id;
