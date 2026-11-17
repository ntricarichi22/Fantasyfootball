-- Controller must remotely verify exact source project, all-alias admission
-- closure, paused jobs, frozen administrative pipelines and unused features.
-- GUCs record that attestation; setting them is not independent proof.
BEGIN;
SET LOCAL lock_timeout = '5s';
SET LOCAL statement_timeout = '120s';
SELECT table_schema, table_name, count(*) AS columns
FROM information_schema.columns
WHERE table_schema IN ('cfc_failover', 'public', 'auth', 'storage', 'league_sync', 'net', 'cron')
GROUP BY table_schema, table_name ORDER BY table_schema, table_name;
SELECT cfc_failover.activate(
  current_setting('cfc.failover_epoch')::uuid,
  current_setting('cfc.failover_controller_sha'),
  current_setting('cfc.failover_source_ref'),
  current_setting('cfc.failover_admission_closed')
);
COMMIT;
