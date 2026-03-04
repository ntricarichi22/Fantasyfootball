-- Migration: Sleeper ingestion pipeline — Layer 1 (raw) and Layer 2 (flattened)
-- Layer 1: one raw table per endpoint family, preserving full raw_json payloads.
-- Layer 2: flattened tables that mirror the source API structure with canonical IDs.
-- All tables are safe to re-run (CREATE TABLE IF NOT EXISTS).

-- =============================================================================
-- LAYER 1 — Raw endpoint storage
-- =============================================================================

-- /v1/league/{league_id}
CREATE TABLE IF NOT EXISTS slp_raw_league (
  league_id   TEXT        PRIMARY KEY,
  raw_json    JSONB       NOT NULL,
  fetched_at  TIMESTAMPTZ NOT NULL DEFAULT now()
);

-- /v1/league/{league_id}/rosters  (full array stored per league)
CREATE TABLE IF NOT EXISTS slp_raw_rosters (
  league_id   TEXT        PRIMARY KEY,
  raw_json    JSONB       NOT NULL,
  fetched_at  TIMESTAMPTZ NOT NULL DEFAULT now()
);

-- /v1/league/{league_id}/users  (full array stored per league)
CREATE TABLE IF NOT EXISTS slp_raw_users (
  league_id   TEXT        PRIMARY KEY,
  raw_json    JSONB       NOT NULL,
  fetched_at  TIMESTAMPTZ NOT NULL DEFAULT now()
);

-- /v1/league/{league_id}/matchups/{week}  (full array per league+week)
CREATE TABLE IF NOT EXISTS slp_raw_matchups (
  league_id   TEXT        NOT NULL,
  week        INT         NOT NULL,
  raw_json    JSONB       NOT NULL,
  fetched_at  TIMESTAMPTZ NOT NULL DEFAULT now(),
  PRIMARY KEY (league_id, week)
);

-- /v1/league/{league_id}/winners_bracket
CREATE TABLE IF NOT EXISTS slp_raw_winners_bracket (
  league_id   TEXT        PRIMARY KEY,
  raw_json    JSONB       NOT NULL,
  fetched_at  TIMESTAMPTZ NOT NULL DEFAULT now()
);

-- /v1/league/{league_id}/losers_bracket
CREATE TABLE IF NOT EXISTS slp_raw_losers_bracket (
  league_id   TEXT        PRIMARY KEY,
  raw_json    JSONB       NOT NULL,
  fetched_at  TIMESTAMPTZ NOT NULL DEFAULT now()
);

-- /v1/league/{league_id}/transactions/{week}  (full array per league+week)
CREATE TABLE IF NOT EXISTS slp_raw_transactions (
  league_id   TEXT        NOT NULL,
  week        INT         NOT NULL,
  raw_json    JSONB       NOT NULL,
  fetched_at  TIMESTAMPTZ NOT NULL DEFAULT now(),
  PRIMARY KEY (league_id, week)
);

-- /v1/league/{league_id}/traded_picks
CREATE TABLE IF NOT EXISTS slp_raw_traded_picks (
  league_id   TEXT        PRIMARY KEY,
  raw_json    JSONB       NOT NULL,
  fetched_at  TIMESTAMPTZ NOT NULL DEFAULT now()
);

-- /v1/league/{league_id}/drafts  (full array per league)
CREATE TABLE IF NOT EXISTS slp_raw_drafts (
  league_id   TEXT        PRIMARY KEY,
  raw_json    JSONB       NOT NULL,
  fetched_at  TIMESTAMPTZ NOT NULL DEFAULT now()
);

-- /v1/draft/{draft_id}  (single draft object)
CREATE TABLE IF NOT EXISTS slp_raw_draft (
  draft_id    TEXT        PRIMARY KEY,
  raw_json    JSONB       NOT NULL,
  fetched_at  TIMESTAMPTZ NOT NULL DEFAULT now()
);

-- /v1/draft/{draft_id}/picks  (full array per draft)
CREATE TABLE IF NOT EXISTS slp_raw_draft_picks (
  draft_id    TEXT        PRIMARY KEY,
  raw_json    JSONB       NOT NULL,
  fetched_at  TIMESTAMPTZ NOT NULL DEFAULT now()
);

-- /v1/draft/{draft_id}/traded_picks  (full array per draft)
CREATE TABLE IF NOT EXISTS slp_raw_draft_traded_picks (
  draft_id    TEXT        PRIMARY KEY,
  raw_json    JSONB       NOT NULL,
  fetched_at  TIMESTAMPTZ NOT NULL DEFAULT now()
);

-- /v1/players/nfl  (full dictionary snapshot)
CREATE TABLE IF NOT EXISTS slp_raw_players_nfl (
  id          BIGSERIAL   PRIMARY KEY,
  raw_json    JSONB       NOT NULL,
  fetched_at  TIMESTAMPTZ NOT NULL DEFAULT now()
);

-- =============================================================================
-- LAYER 2 — Flattened endpoint mirrors
-- =============================================================================

-- One row per Sleeper league season
CREATE TABLE IF NOT EXISTS slp_leagues (
  league_id            TEXT        PRIMARY KEY,
  season               TEXT,
  name                 TEXT,
  status               TEXT,
  sport                TEXT,
  season_type          TEXT,
  total_rosters        INT,
  playoff_week_start   INT,
  last_scored_leg      INT,
  previous_league_id   TEXT,
  draft_id             TEXT,
  settings             JSONB,
  scoring_settings     JSONB,
  roster_positions     JSONB,
  metadata             JSONB,
  updated_at           TIMESTAMPTZ NOT NULL DEFAULT now()
);

-- One row per (league_id, user_id)
CREATE TABLE IF NOT EXISTS slp_league_users (
  league_id    TEXT        NOT NULL,
  user_id      TEXT        NOT NULL,
  display_name TEXT,
  team_name    TEXT,
  avatar       TEXT,
  is_owner     BOOLEAN     NOT NULL DEFAULT false,
  metadata     JSONB,
  updated_at   TIMESTAMPTZ NOT NULL DEFAULT now(),
  PRIMARY KEY (league_id, user_id)
);

-- One row per (league_id, roster_id)
CREATE TABLE IF NOT EXISTS slp_league_rosters (
  league_id    TEXT        NOT NULL,
  roster_id    INT         NOT NULL,
  owner_id     TEXT,
  co_owners    JSONB,
  players      JSONB,
  starters     JSONB,
  reserve      JSONB,
  taxi         JSONB,
  draft_picks  JSONB,
  settings     JSONB,
  metadata     JSONB,
  updated_at   TIMESTAMPTZ NOT NULL DEFAULT now(),
  PRIMARY KEY (league_id, roster_id)
);

-- Individual players on each roster (starter / bench / ir / taxi)
CREATE TABLE IF NOT EXISTS slp_league_roster_players (
  league_id         TEXT        NOT NULL,
  roster_id         INT         NOT NULL,
  sleeper_player_id TEXT        NOT NULL,
  slot_type         TEXT        NOT NULL DEFAULT 'bench',
  updated_at        TIMESTAMPTZ NOT NULL DEFAULT now(),
  PRIMARY KEY (league_id, roster_id, sleeper_player_id)
);

-- One row per team per week (matchup half-row from Sleeper)
CREATE TABLE IF NOT EXISTS slp_league_matchup_team_rows (
  league_id       TEXT        NOT NULL,
  week            INT         NOT NULL,
  roster_id       INT         NOT NULL,
  matchup_id      INT,
  points          NUMERIC,
  custom_points   NUMERIC,
  starters        JSONB,
  players         JSONB,
  starters_points JSONB,
  players_points  JSONB,
  updated_at      TIMESTAMPTZ NOT NULL DEFAULT now(),
  PRIMARY KEY (league_id, week, roster_id)
);

-- Individual players within each matchup (starter or bench)
CREATE TABLE IF NOT EXISTS slp_league_matchup_lineup_players (
  league_id         TEXT        NOT NULL,
  week              INT         NOT NULL,
  roster_id         INT         NOT NULL,
  sleeper_player_id TEXT        NOT NULL,
  slot_type         TEXT        NOT NULL DEFAULT 'bench',
  points            NUMERIC,
  updated_at        TIMESTAMPTZ NOT NULL DEFAULT now(),
  PRIMARY KEY (league_id, week, roster_id, sleeper_player_id)
);

-- Playoff bracket games (winners + losers brackets)
CREATE TABLE IF NOT EXISTS slp_league_bracket_games (
  league_id        TEXT        NOT NULL,
  bracket_type     TEXT        NOT NULL,
  round            INT         NOT NULL,
  match_id         INT         NOT NULL,
  roster_id_1      INT,
  roster_id_2      INT,
  t1_from          JSONB,
  t2_from          JSONB,
  winner_roster_id INT,
  loser_roster_id  INT,
  placement        INT,
  updated_at       TIMESTAMPTZ NOT NULL DEFAULT now(),
  PRIMARY KEY (league_id, bracket_type, round, match_id)
);

-- One row per transaction_id
CREATE TABLE IF NOT EXISTS slp_league_transactions (
  transaction_id     TEXT        PRIMARY KEY,
  league_id          TEXT        NOT NULL,
  week               INT,
  transaction_type   TEXT,
  status             TEXT,
  status_updated_at  TIMESTAMPTZ,
  leg                INT,
  roster_ids         JSONB,
  consenter_ids      JSONB,
  drops              JSONB,
  adds               JSONB,
  draft_picks        JSONB,
  waiver_budget      JSONB,
  settings           JSONB,
  metadata           JSONB,
  sleeper_created_at TIMESTAMPTZ,
  updated_at         TIMESTAMPTZ NOT NULL DEFAULT now()
);

-- Assets (players / draft picks) associated with each transaction
CREATE TABLE IF NOT EXISTS slp_league_transaction_assets (
  id                BIGSERIAL   PRIMARY KEY,
  transaction_id    TEXT        NOT NULL,
  league_id         TEXT        NOT NULL,
  asset_type        TEXT        NOT NULL,
  sleeper_player_id TEXT,
  pick_season       TEXT,
  pick_round        INT,
  pick_roster_id    INT,
  from_roster_id    INT,
  to_roster_id      INT,
  direction         TEXT
);

-- Current traded-pick ownership per league
CREATE TABLE IF NOT EXISTS slp_league_traded_picks (
  league_id          TEXT        NOT NULL,
  season             TEXT        NOT NULL,
  round              INT         NOT NULL,
  roster_id          INT         NOT NULL,
  previous_owner_id  INT,
  original_owner_id  INT,
  updated_at         TIMESTAMPTZ NOT NULL DEFAULT now(),
  PRIMARY KEY (league_id, season, round, roster_id)
);

-- Drafts associated with a league (list endpoint)
CREATE TABLE IF NOT EXISTS slp_league_drafts (
  league_id  TEXT        NOT NULL,
  draft_id   TEXT        NOT NULL,
  updated_at TIMESTAMPTZ NOT NULL DEFAULT now(),
  PRIMARY KEY (league_id, draft_id)
);

-- Full draft detail (one row per draft_id)
CREATE TABLE IF NOT EXISTS slp_drafts (
  draft_id          TEXT        PRIMARY KEY,
  league_id         TEXT,
  season            TEXT,
  type              TEXT,
  status            TEXT,
  start_time        TIMESTAMPTZ,
  draft_order       JSONB,
  slot_to_roster_id JSONB,
  settings          JSONB,
  metadata          JSONB,
  updated_at        TIMESTAMPTZ NOT NULL DEFAULT now()
);

-- Individual picks within each draft
CREATE TABLE IF NOT EXISTS slp_draft_picks (
  draft_id          TEXT        NOT NULL,
  pick_no           INT         NOT NULL,
  round             INT,
  draft_slot        INT,
  roster_id         INT,
  sleeper_player_id TEXT,
  picked_by         TEXT,
  is_keeper         BOOLEAN,
  metadata          JSONB,
  updated_at        TIMESTAMPTZ NOT NULL DEFAULT now(),
  PRIMARY KEY (draft_id, pick_no)
);

-- Traded picks within a draft context (/draft/{id}/traded_picks)
CREATE TABLE IF NOT EXISTS slp_draft_traded_picks (
  draft_id           TEXT        NOT NULL,
  season             TEXT        NOT NULL,
  round              INT         NOT NULL,
  roster_id          INT         NOT NULL,
  previous_owner_id  INT,
  original_owner_id  INT,
  updated_at         TIMESTAMPTZ NOT NULL DEFAULT now(),
  PRIMARY KEY (draft_id, season, round, roster_id)
);

-- Timestamped snapshots tracking when player data was last refreshed
CREATE TABLE IF NOT EXISTS slp_players_snapshot (
  id           BIGSERIAL   PRIMARY KEY,
  player_count INT,
  fetched_at   TIMESTAMPTZ NOT NULL DEFAULT now()
);

-- One row per NFL player, upserted on every sync
CREATE TABLE IF NOT EXISTS slp_players (
  sleeper_player_id    TEXT        PRIMARY KEY,
  full_name            TEXT,
  first_name           TEXT,
  last_name            TEXT,
  position             TEXT,
  team                 TEXT,
  status               TEXT,
  sport                TEXT        DEFAULT 'nfl',
  age                  INT,
  number               INT,
  depth_chart_position TEXT,
  depth_chart_order    INT,
  years_exp            INT,
  college              TEXT,
  injury_status        TEXT,
  fantasy_positions    JSONB,
  metadata             JSONB,
  raw_json             JSONB,
  updated_at           TIMESTAMPTZ NOT NULL DEFAULT now()
);
