-- Only after the controller verifies the reviewed source-return deployment,
-- all canonical aliases, read-only readiness and original source identity.
-- Keep admission closed until this commits and exact-epoch release is verified.
BEGIN;
SET LOCAL lock_timeout = '5s';
SET LOCAL statement_timeout = '120s';
SELECT table_schema, table_name, count(*) AS columns
FROM information_schema.columns
WHERE table_schema IN ('cfc_failover', 'public', 'auth', 'storage', 'league_sync', 'net', 'cron')
GROUP BY table_schema, table_name ORDER BY table_schema, table_name;
SELECT cfc_failover.release(
  current_setting('cfc.failover_epoch')::uuid,
  current_setting('cfc.failover_controller_sha'),
  current_setting('cfc.failover_release_verified')
);
COMMIT;
