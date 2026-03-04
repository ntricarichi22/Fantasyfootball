-- Migration: Fix backfill schema issues found during historical data ingestion
--
-- Fix 1: league_traded_picks — make original_owner_roster_id nullable
--   Sleeper does not always supply original_owner_id (e.g. when the pick was
--   never traded away from its original owner).  The NOT NULL constraint caused
--   every season sync to fail at the traded-picks step.
--
-- Fix 2: No schema change required for matchup_id — the synthetic key is
--   generated in application code (leagueHistorySync.ts) before writing to the
--   database, so the column stays NOT NULL and the data stays clean.

-- ── Fix 1: allow null original_owner_roster_id ──────────────────────────────

ALTER TABLE league_traded_picks
  ALTER COLUMN original_owner_roster_id DROP NOT NULL;
