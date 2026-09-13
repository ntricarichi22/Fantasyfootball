-- PROPOSAL ONLY — DO NOT RUN before archive restore proof, two-week soft-rename
-- observation, repeated dependency inventory, and explicit destructive approval.
-- Deliberately fails closed unless an operator edits the transaction-local flag.
BEGIN;
DO $$ BEGIN RAISE EXCEPTION 'Destructive cleanup is not approved. Review DB-01..DB-07 evidence first.'; END $$;

-- After approval, replace the guard above in the reviewed destructive PR and
-- list only live-confirmed, zero-dependent zz_archive_* relations here, e.g.:
-- DROP TABLE IF EXISTS public.zz_archive_20260912_league_seasons;
-- No candidate DROP is executable in this preparation artifact.
ROLLBACK;
