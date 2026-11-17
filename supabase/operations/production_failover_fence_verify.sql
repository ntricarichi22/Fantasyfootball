BEGIN READ ONLY;
SET LOCAL lock_timeout = '5s';
SET LOCAL statement_timeout = '120s';
SELECT table_schema, table_name, count(*) AS columns
FROM information_schema.columns
WHERE table_schema IN ('cfc_failover', 'public', 'auth', 'storage', 'league_sync', 'net', 'cron')
GROUP BY table_schema, table_name ORDER BY table_schema, table_name;
SELECT cfc_failover.verify_source_unchanged(
  current_setting('cfc.failover_epoch')::uuid,
  current_setting('cfc.failover_controller_sha')
);
COMMIT;
