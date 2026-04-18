-- Migration 006: Add starts_at column to draft_state for the pre-draft countdown.
-- Rerunnable + idempotent.

ALTER TABLE public.draft_state
  ADD COLUMN IF NOT EXISTS starts_at TIMESTAMPTZ NULL;

-- Validation
SELECT column_name, data_type, is_nullable, column_default
FROM information_schema.columns
WHERE table_schema = 'public'
  AND table_name = 'draft_state'
  AND column_name = 'starts_at';
