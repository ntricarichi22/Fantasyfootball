-- Migration 007: auto-skip support for the war room draft clock.
-- Rerunnable. Idempotent: every column / index is added with IF NOT EXISTS.
--
-- Adds:
--   draft_log:
--     is_skip   BOOLEAN NOT NULL DEFAULT FALSE  — true on rows the server wrote
--                                                  to mark a team that was
--                                                  on the clock when their
--                                                  30-minute window expired.
--                                                  Skip rows have player_id /
--                                                  player_name = NULL and
--                                                  is_announced = TRUE so the
--                                                  pick_index slot is consumed
--                                                  and the next team can come
--                                                  on the clock immediately.
--
-- Existing rows are left as-is (default FALSE applies on insert; explicit
-- backfill ensures NULLs from any pre-existing column shape become FALSE).

-- 0) Schema inspection (run first; confirms the live shape before changing it).
SELECT table_name, column_name, data_type
FROM information_schema.columns
WHERE table_schema = 'public'
  AND table_name = 'draft_log'
ORDER BY ordinal_position;

-- 1) draft_log.is_skip --------------------------------------------------------
ALTER TABLE public.draft_log
  ADD COLUMN IF NOT EXISTS is_skip BOOLEAN NOT NULL DEFAULT FALSE;

-- Defensive backfill: in case the column existed previously and allowed NULLs,
-- collapse them to FALSE so the not-null contract holds going forward.
UPDATE public.draft_log
SET is_skip = FALSE
WHERE is_skip IS NULL;

-- 2) Validation queries -------------------------------------------------------
-- Confirm the column exists with the expected default.
SELECT column_name, data_type, is_nullable, column_default
FROM information_schema.columns
WHERE table_schema = 'public'
  AND table_name = 'draft_log'
  AND column_name = 'is_skip';

-- Confirm the backfill stuck (no NULL is_skip rows).
SELECT COUNT(*) AS unflagged_legacy_rows
FROM public.draft_log
WHERE is_skip IS NULL;
