-- TARGET ONLY. The registered-target runner supplies the project identity and
-- verifies Management API routing before executing this complete transaction.
-- Never run this block on the production source or another customer project.
BEGIN;
SET LOCAL lock_timeout='5s';
SET LOCAL statement_timeout='20s';
DO $guard$
BEGIN
  IF current_setting('recovery.approved_target_ref',true) IS DISTINCT FROM '__RECOVERY_TARGET_REF__'
     OR '__RECOVERY_TARGET_REF__' IN ('owkxkpkdffhcordlxqte','tnixfvxqqwposoevpogo')
     OR '__RECOVERY_TARGET_REF__' !~ '^[a-z]{20}$' THEN
    RAISE EXCEPTION 'Recovery target guard failed';
  END IF;
  IF EXISTS(SELECT 1 FROM pg_roles WHERE rolcanlogin AND rolname NOT IN
    ('authenticator','pgbouncer','postgres','supabase_admin','supabase_auth_admin','supabase_etl_admin',
     'supabase_functions_admin','supabase_read_only_user','supabase_replication_admin','supabase_storage_admin','llm_reader')) THEN
    RAISE EXCEPTION 'Unreviewed login role in restored database';
  END IF;
  IF EXISTS(SELECT 1 FROM pg_subscription) OR EXISTS(SELECT 1 FROM pg_foreign_server) THEN
    RAISE EXCEPTION 'Unreviewed restored outbound integration';
  END IF;
  IF EXISTS(SELECT 1 FROM cron.job WHERE active AND username IS DISTINCT FROM current_user) THEN
    RAISE EXCEPTION 'Unreviewed restored cron owner';
  END IF;
END $guard$;
LOCK TABLE league_sync.config,net.http_request_queue,auth.users,
  auth.sessions,auth.refresh_tokens,public.cfc_league_runtime IN ACCESS EXCLUSIVE MODE;
-- Hosted postgres cannot UPDATE/LOCK cron.job directly. The documented extension
-- API permits alteration of its own jobs; source ownership/EXECUTE were verified.
DO $cron$
DECLARE job record;
BEGIN
  FOR job IN SELECT jobid FROM cron.job WHERE active LOOP
    PERFORM cron.alter_job(job_id=>job.jobid,active=>false);
  END LOOP;
END $cron$;
UPDATE league_sync.config SET enabled=false WHERE enabled;
DELETE FROM net.http_request_queue;
UPDATE public.cfc_league_runtime SET writes_enabled=false WHERE writes_enabled;
DELETE FROM auth.refresh_tokens;
DELETE FROM auth.sessions;
UPDATE auth.users SET banned_until='9999-12-31T00:00:00Z'::timestamptz WHERE banned_until IS DISTINCT FROM '9999-12-31T00:00:00Z'::timestamptz;
DO $roles$
BEGIN
  IF EXISTS(SELECT 1 FROM pg_roles WHERE rolname='llm_reader') THEN ALTER ROLE llm_reader NOLOGIN; END IF;
END $roles$;
CREATE SCHEMA IF NOT EXISTS recovery_quarantine AUTHORIZATION postgres;
REVOKE ALL ON SCHEMA recovery_quarantine FROM PUBLIC,anon,authenticated;
COMMIT;
