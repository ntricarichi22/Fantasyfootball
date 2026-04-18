-- Migration 005: "Pick is in" cadence support for the draft war room clock bar.
-- Rerunnable. Idempotent: every column / index / default is added with IF NOT EXISTS.
--
-- Adds:
--   draft_log:
--     submitted_at   TIMESTAMPTZ  — when the pick was actually submitted by the team
--     announced_at   TIMESTAMPTZ  — when the pick becomes visible (= clock_started_at + 30m)
--     is_announced   BOOLEAN      — convenience flag, default false (true = pick is visible)
--   draft_state:
--     pick_submitted     BOOLEAN     — current pick has been submitted but not yet announced
--     pick_announced_at  TIMESTAMPTZ — when the current pick will be announced
--     current_pick_index INTEGER     — zero-based index of the pick on the clock; survives skips
--
-- All existing draft_log rows are backfilled to is_announced = true so the
-- legacy reveal-on-pick behavior continues to work for picks made before this
-- migration ran.

-- 0) Schema inspection (run first; confirms the live shape before changing it).
SELECT table_name, column_name, data_type
FROM information_schema.columns
WHERE table_schema = 'public'
  AND table_name IN ('draft_log', 'draft_state')
ORDER BY table_name, ordinal_position;

-- 1) draft_log cadence columns ------------------------------------------------
ALTER TABLE public.draft_log
  ADD COLUMN IF NOT EXISTS submitted_at TIMESTAMPTZ NULL;

ALTER TABLE public.draft_log
  ADD COLUMN IF NOT EXISTS announced_at TIMESTAMPTZ NULL;

ALTER TABLE public.draft_log
  ADD COLUMN IF NOT EXISTS is_announced BOOLEAN NOT NULL DEFAULT FALSE;

-- Backfill: any pre-existing rows are considered already announced so they
-- continue to appear in board / ticker / log queries.
UPDATE public.draft_log
SET is_announced = TRUE
WHERE is_announced IS DISTINCT FROM TRUE;

-- Index for the common "show announced picks only" query.
CREATE INDEX IF NOT EXISTS draft_log_is_announced_idx
  ON public.draft_log (is_announced);

-- 2) draft_state cadence columns ----------------------------------------------
ALTER TABLE public.draft_state
  ADD COLUMN IF NOT EXISTS pick_submitted BOOLEAN NOT NULL DEFAULT FALSE;

ALTER TABLE public.draft_state
  ADD COLUMN IF NOT EXISTS pick_announced_at TIMESTAMPTZ NULL;

ALTER TABLE public.draft_state
  ADD COLUMN IF NOT EXISTS current_pick_index INTEGER NULL;

-- Backfill current_pick_index for leagues mid-draft based on existing draft_log.
WITH counts AS (
  SELECT
    COALESCE(MAX(pick_index) + 1, 0) AS next_pick_index
  FROM public.draft_log
)
UPDATE public.draft_state ds
SET current_pick_index = counts.next_pick_index
FROM counts
WHERE ds.current_pick_index IS NULL;

-- 3) Validation queries -------------------------------------------------------
-- Confirm the new columns exist with the expected defaults.
SELECT column_name, data_type, is_nullable, column_default
FROM information_schema.columns
WHERE table_schema = 'public'
  AND table_name = 'draft_log'
  AND column_name IN ('submitted_at', 'announced_at', 'is_announced')
ORDER BY column_name;

SELECT column_name, data_type, is_nullable, column_default
FROM information_schema.columns
WHERE table_schema = 'public'
  AND table_name = 'draft_state'
  AND column_name IN ('pick_submitted', 'pick_announced_at', 'current_pick_index')
ORDER BY column_name;

-- Confirm the backfill stuck (no NULL is_announced rows).
SELECT COUNT(*) AS unannounced_legacy_rows
FROM public.draft_log
WHERE is_announced IS NULL;
