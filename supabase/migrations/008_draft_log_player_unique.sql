-- Migration 008: prevent the same Sleeper player from being drafted twice.
-- Rerunnable. Idempotent: the unique index is created with IF NOT EXISTS and
-- is partial so skipped picks (player_id IS NULL) are still allowed.
--
-- Background: a pick was once submitted from a mobile device while a
-- different desktop client was mid-pick on the same player. Without a
-- DB-level constraint the second client's submit succeeded and the player
-- ended up on two rows in draft_log. The /api/draft-log POST handler now
-- rejects duplicates with HTTP 409 {error:"player_already_drafted"} and
-- this index is the race-safe backstop: the second concurrent insert hits
-- a unique-violation and is surfaced as the same 409.

CREATE UNIQUE INDEX IF NOT EXISTS draft_log_player_unique
  ON draft_log (player_id)
  WHERE player_id IS NOT NULL;
