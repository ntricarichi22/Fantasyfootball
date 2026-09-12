-- PROPOSAL ONLY — generated soft-rename statements must be reviewed against
-- fresh cleanup-inventory.sql output. This file is intentionally non-executable.
BEGIN;
DO $$ BEGIN RAISE EXCEPTION 'Soft rename is rollout-gated; supply reviewed zero-dependency candidates.'; END $$;
-- Example shape only (not evidence that the object exists or is dead):
-- ALTER TABLE public.<confirmed_candidate> RENAME TO zz_archive_YYYYMMDD_<confirmed_candidate>;
ROLLBACK;
