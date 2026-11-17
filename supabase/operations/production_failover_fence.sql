-- Installs private, operator-only controlled-drill fencing helpers. Does NOT
-- activate a fence. See PRODUCTION_FAILOVER_FENCE.md before using the wrappers.
BEGIN;
SET LOCAL lock_timeout = '5s';
SET LOCAL statement_timeout = '120s';
SELECT table_schema, table_name, column_name, data_type
FROM information_schema.columns
WHERE table_schema IN ('public', 'auth', 'storage', 'league_sync', 'net', 'cron', 'cfc_failover')
ORDER BY table_schema, table_name, ordinal_position;
-- Serialize installation against controller/watcher lifecycle work. Replacing
-- helper definitions while a plan or source fence is live is never permitted.
DO $installation_guard$
DECLARE occupied bigint;
BEGIN
  PERFORM pg_advisory_xact_lock(hashtextextended('cfc-production-failover',0));
  IF EXISTS (SELECT 1 FROM pg_namespace WHERE nspname='cfc_failover' AND nspowner<>'postgres'::regrole) THEN
    RAISE EXCEPTION 'failover_private_schema_owner';
  END IF;
  IF to_regprocedure('cfc_failover.block_writes()') IS NOT NULL
     OR EXISTS(SELECT 1 FROM pg_trigger WHERE tgname='cfc_production_write_fence') THEN
    RAISE EXCEPTION 'failover_helpers_in_use';
  END IF;
  IF to_regclass('cfc_failover.epochs') IS NOT NULL THEN
    EXECUTE 'SELECT count(*) FROM cfc_failover.epochs WHERE released_at IS NULL' INTO occupied;
    IF occupied<>0 THEN RAISE EXCEPTION 'failover_helpers_in_use'; END IF;
  END IF;
  IF to_regclass('cfc_failover.controller_journal') IS NOT NULL THEN
    EXECUTE 'SELECT count(*) FROM cfc_failover.controller_journal WHERE completed_at IS NULL' INTO occupied;
    IF occupied<>0 THEN RAISE EXCEPTION 'failover_helpers_in_use'; END IF;
  END IF;
END $installation_guard$;

-- These are explicitly NEW operational objects, never application API objects.
CREATE SCHEMA IF NOT EXISTS cfc_failover AUTHORIZATION postgres;
REVOKE ALL ON SCHEMA cfc_failover FROM PUBLIC, anon, authenticated, service_role;
CREATE TABLE IF NOT EXISTS cfc_failover.epochs (
  epoch uuid PRIMARY KEY,
  source_ref text NOT NULL CHECK (source_ref = 'owkxkpkdffhcordlxqte'),
  controller_sha text NOT NULL CHECK (controller_sha ~ '^[a-f0-9]{40}$'),
  inventory jsonb NOT NULL CHECK (jsonb_typeof(inventory) = 'array'),
  prior_settings jsonb NOT NULL,
  data_fingerprints jsonb NOT NULL,
  guard_oid oid NOT NULL,
  guard_definition text NOT NULL,
  trigger_oids oid[] NOT NULL,
  activated_at timestamptz NOT NULL DEFAULT clock_timestamp(),
  released_at timestamptz
);
CREATE UNIQUE INDEX IF NOT EXISTS cfc_failover_one_active_epoch
  ON cfc_failover.epochs ((true)) WHERE released_at IS NULL;
REVOKE ALL ON ALL TABLES IN SCHEMA cfc_failover FROM PUBLIC, anon, authenticated, service_role;

CREATE OR REPLACE FUNCTION cfc_failover.protect_epoch()
RETURNS trigger LANGUAGE plpgsql SET search_path = '' AS $$
BEGIN
  IF TG_OP <> 'UPDATE' THEN RAISE EXCEPTION 'failover_manifest_immutable'; END IF;
  IF OLD.released_at IS NOT NULL OR NEW.released_at IS NULL
     OR (to_jsonb(NEW) - 'released_at') IS DISTINCT FROM (to_jsonb(OLD) - 'released_at') THEN
    RAISE EXCEPTION 'failover_manifest_immutable';
  END IF;
  RETURN NEW;
END $$;
DROP TRIGGER IF EXISTS cfc_failover_epoch_immutable ON cfc_failover.epochs;
CREATE TRIGGER cfc_failover_epoch_immutable BEFORE UPDATE OR DELETE ON cfc_failover.epochs
  FOR EACH ROW EXECUTE FUNCTION cfc_failover.protect_epoch();
DROP TRIGGER IF EXISTS cfc_failover_epoch_no_truncate ON cfc_failover.epochs;
CREATE TRIGGER cfc_failover_epoch_no_truncate BEFORE TRUNCATE ON cfc_failover.epochs
  FOR EACH STATEMENT EXECUTE FUNCTION cfc_failover.protect_epoch();

CREATE OR REPLACE FUNCTION cfc_failover.inventory()
RETURNS jsonb LANGUAGE sql STABLE SET search_path = '' AS $$
  SELECT coalesce(jsonb_agg(jsonb_build_object(
    'oid', c.oid, 'schema', n.nspname, 'name', c.relname,
    'fenced', NOT ((n.nspname = 'auth' AND c.relname = 'schema_migrations')
      OR (n.nspname = 'storage' AND c.relname IN ('migrations', 'buckets_vectors', 'vector_indexes'))),
    'definition', encode(sha256(convert_to(jsonb_build_object(
      'kind', c.relkind, 'owner', c.relowner, 'acl', c.relacl::text,
      'rls', c.relrowsecurity, 'force_rls', c.relforcerowsecurity,
      'columns', (SELECT jsonb_agg(jsonb_build_array(a.attnum, a.attname, a.atttypid,
        a.atttypmod, a.attnotnull, a.attidentity, a.attgenerated, a.attcollation,
        pg_get_expr(d.adbin, d.adrelid)) ORDER BY a.attnum)
        FROM pg_attribute a LEFT JOIN pg_attrdef d ON d.adrelid = a.attrelid AND d.adnum = a.attnum
        WHERE a.attrelid = c.oid AND a.attnum > 0 AND NOT a.attisdropped),
      'constraints', (SELECT jsonb_agg(pg_get_constraintdef(k.oid) ORDER BY k.oid)
        FROM pg_constraint k WHERE k.conrelid = c.oid),
      'policies', (SELECT jsonb_agg(jsonb_build_array(p.polname, p.polcmd, p.polpermissive,
        p.polroles, pg_get_expr(p.polqual, p.polrelid), pg_get_expr(p.polwithcheck, p.polrelid)) ORDER BY p.polname)
        FROM pg_policy p WHERE p.polrelid = c.oid),
      'triggers', (SELECT jsonb_agg(jsonb_build_array(t.oid, t.tgenabled, pg_get_triggerdef(t.oid)) ORDER BY t.oid)
        FROM pg_trigger t WHERE t.tgrelid = c.oid AND NOT t.tgisinternal
          AND NOT (t.tgname = 'cfc_production_write_fence'
            AND t.tgfoid = coalesce(to_regprocedure('cfc_failover.block_writes()')::oid, 0)))
    )::text, 'UTF8')), 'hex')
  ) ORDER BY c.oid), '[]'::jsonb)
  FROM pg_class c JOIN pg_namespace n ON n.oid = c.relnamespace
  WHERE c.relkind IN ('r', 'p') AND (n.nspname IN ('public', 'auth', 'storage', 'league_sync')
    OR (n.nspname = 'net' AND c.relname = 'http_request_queue'));
$$;

-- Streaming, order-independent fingerprints: count plus four independent
-- 64-bit component sums of each row's SHA256. No giant concatenated row buffer,
-- customer rows, object paths, or hashes are returned to the application/logs.
CREATE OR REPLACE FUNCTION cfc_failover.data_fingerprints(p_inventory jsonb)
RETURNS jsonb LANGUAGE plpgsql SET search_path = '' AS $$
DECLARE item jsonb; result jsonb := '{}'::jsonb; fingerprint jsonb;
BEGIN
  FOR item IN SELECT value FROM jsonb_array_elements(p_inventory) LOOP
    EXECUTE format(
      'SELECT jsonb_build_array(count(*),
        coalesce(sum((''x''||substr(h,1,16))::bit(64)::bigint),0)::text,
        coalesce(sum((''x''||substr(h,17,16))::bit(64)::bigint),0)::text,
        coalesce(sum((''x''||substr(h,33,16))::bit(64)::bigint),0)::text,
        coalesce(sum((''x''||substr(h,49,16))::bit(64)::bigint),0)::text)
       FROM (SELECT encode(sha256(convert_to(to_jsonb(r)::text,''UTF8'')),''hex'') h
             FROM ONLY %I.%I r) rows',
      item->>'schema', item->>'name') INTO fingerprint;
    result := result || jsonb_build_object(item->>'oid', fingerprint);
  END LOOP;
  RETURN result;
END $$;

CREATE OR REPLACE FUNCTION cfc_failover.assert_runtime()
RETURNS void LANGUAGE plpgsql SET search_path = '' AS $$
BEGIN
  IF current_user <> 'postgres' OR current_setting('session_replication_role') <> 'origin' THEN
    RAISE EXCEPTION 'failover_operator_or_replication_mode';
  END IF;
  IF EXISTS (SELECT 1 FROM pg_roles WHERE rolname IN
       ('authenticator', 'service_role', 'authenticated', 'anon', 'supabase_auth_admin', 'supabase_storage_admin')
       AND (rolsuper OR rolreplication OR has_parameter_privilege(oid, 'session_replication_role', 'SET')))
     OR EXISTS (SELECT 1 FROM pg_db_role_setting s CROSS JOIN LATERAL unnest(s.setconfig) x
                WHERE split_part(x, '=', 1) = 'session_replication_role' AND split_part(x, '=', 2) <> 'origin') THEN
    RAISE EXCEPTION 'failover_runtime_role_drift';
  END IF;
  IF EXISTS (SELECT 1 FROM storage.buckets_vectors) OR EXISTS (SELECT 1 FROM storage.vector_indexes)
     OR EXISTS (SELECT 1 FROM pg_foreign_server) OR EXISTS (SELECT 1 FROM pg_subscription) THEN
    RAISE EXCEPTION 'failover_unsupported_feature_in_use';
  END IF;
END $$;

CREATE OR REPLACE FUNCTION cfc_failover.verify(p_epoch uuid, p_controller_sha text)
RETURNS jsonb LANGUAGE plpgsql SET search_path = '' AS $$
DECLARE saved cfc_failover.epochs; current_inventory jsonb; current_jobs jsonb; current_sync jsonb; current_runtime jsonb;
BEGIN
  PERFORM cfc_failover.assert_runtime();
  SELECT * INTO saved FROM cfc_failover.epochs WHERE epoch = p_epoch;
  IF NOT FOUND OR saved.controller_sha IS DISTINCT FROM p_controller_sha THEN
    RAISE EXCEPTION 'failover_unknown_epoch_or_controller';
  END IF;
  IF saved.released_at IS NOT NULL THEN
    IF EXISTS (SELECT 1 FROM cfc_failover.epochs WHERE released_at IS NULL) THEN
      RAISE EXCEPTION 'failover_another_epoch_active';
    END IF;
    IF to_regprocedure('cfc_failover.block_writes()') IS NOT NULL
       OR EXISTS (SELECT 1 FROM pg_trigger WHERE tgname = 'cfc_production_write_fence') THEN
      RAISE EXCEPTION 'failover_untracked_fence_after_release';
    END IF;
    RETURN jsonb_build_object('sourceRef', saved.source_ref, 'epoch', saved.epoch,
      'active', false, 'releasedVerified', true);
  END IF;
  current_inventory := cfc_failover.inventory();
  IF current_inventory IS DISTINCT FROM saved.inventory
     OR to_regprocedure('cfc_failover.block_writes()')::oid IS DISTINCT FROM saved.guard_oid
     OR pg_get_functiondef(saved.guard_oid) IS DISTINCT FROM saved.guard_definition THEN
    RAISE EXCEPTION 'failover_inventory_or_guard_drift';
  END IF;
  IF (SELECT coalesce(array_agg(t.oid ORDER BY t.oid), '{}'::oid[]) FROM pg_trigger t
      WHERE t.tgfoid = saved.guard_oid) IS DISTINCT FROM saved.trigger_oids
     OR EXISTS (SELECT 1 FROM pg_trigger t WHERE t.tgfoid = saved.guard_oid
       AND (t.tgname <> 'cfc_production_write_fence' OR t.tgenabled <> 'O' OR t.tgtype <> 62))
     OR (SELECT count(*) FROM pg_depend d WHERE d.refclassid = 'pg_proc'::regclass AND d.refobjid = saved.guard_oid)
          <> cardinality(saved.trigger_oids)
     OR EXISTS (SELECT 1 FROM pg_depend d WHERE d.refclassid = 'pg_proc'::regclass AND d.refobjid = saved.guard_oid
       AND NOT (d.classid = 'pg_trigger'::regclass AND d.deptype = 'n' AND d.objid = ANY(saved.trigger_oids))) THEN
    RAISE EXCEPTION 'failover_trigger_or_dependency_drift';
  END IF;
  SELECT coalesce(jsonb_agg(to_jsonb(j) - 'active' ORDER BY j.jobid), '[]'::jsonb)
    INTO current_jobs FROM cron.job j;
  SELECT coalesce(jsonb_agg(to_jsonb(s) - 'enabled' ORDER BY s.league_id), '[]'::jsonb)
    INTO current_sync FROM league_sync.config s;
  SELECT coalesce(jsonb_agg(league_id ORDER BY league_id), '[]'::jsonb)
    INTO current_runtime FROM public.cfc_league_runtime;
  IF current_jobs IS DISTINCT FROM saved.prior_settings->'job_definitions'
     OR current_sync IS DISTINCT FROM saved.prior_settings->'sync_definitions'
     OR current_runtime IS DISTINCT FROM saved.prior_settings->'runtime_leagues'
     OR EXISTS (SELECT 1 FROM cron.job WHERE active)
     OR EXISTS (SELECT 1 FROM league_sync.config WHERE enabled)
     OR EXISTS (SELECT 1 FROM public.cfc_league_runtime WHERE writes_enabled)
     OR EXISTS (SELECT 1 FROM net.http_request_queue)
     OR EXISTS (SELECT 1 FROM league_sync.runs WHERE status IN ('queued', 'running')) THEN
    RAISE EXCEPTION 'failover_jobs_or_flags_drift';
  END IF;
  RETURN jsonb_build_object('sourceRef', saved.source_ref, 'epoch', saved.epoch,
    'active', true, 'writesBlocked', true, 'drained', true,
    'tables', jsonb_array_length(saved.inventory), 'fencedTables', cardinality(saved.trigger_oids));
END $$;

CREATE OR REPLACE FUNCTION cfc_failover.verify_source_unchanged(p_epoch uuid, p_controller_sha text)
RETURNS jsonb LANGUAGE plpgsql SET search_path = '' AS $$
DECLARE saved cfc_failover.epochs; proof jsonb;
BEGIN
  proof := cfc_failover.verify(p_epoch, p_controller_sha);
  SELECT * INTO saved FROM cfc_failover.epochs WHERE epoch = p_epoch;
  IF saved.released_at IS NOT NULL THEN
    RETURN proof || jsonb_build_object('unchanged', true, 'verifiedBeforeRelease', true);
  END IF;
  IF cfc_failover.data_fingerprints(saved.inventory) IS DISTINCT FROM saved.data_fingerprints THEN
    RAISE EXCEPTION 'failover_source_data_changed';
  END IF;
  RETURN proof || jsonb_build_object('unchanged', true);
END $$;

-- An absent-epoch answer is safe only after any uncertain activation finishes.
-- Use the SAME transaction lock as activation/release; never infer absence from
-- a plain MVCC read while an earlier HTTP request may still be committing.
CREATE OR REPLACE FUNCTION cfc_failover.inspect(p_epoch uuid, p_controller_sha text)
RETURNS jsonb LANGUAGE plpgsql SET search_path = '' AS $$
BEGIN
  PERFORM cfc_failover.assert_runtime();
  IF p_epoch IS NULL OR p_controller_sha IS NULL OR p_controller_sha !~ '^[a-f0-9]{40}$' THEN
    RAISE EXCEPTION 'failover_unknown_epoch_or_controller';
  END IF;
  PERFORM pg_advisory_xact_lock(hashtextextended('cfc-production-failover', 0));
  IF EXISTS (SELECT 1 FROM cfc_failover.epochs WHERE epoch = p_epoch) THEN
    RETURN cfc_failover.verify(p_epoch, p_controller_sha) || jsonb_build_object('exists', true);
  END IF;
  IF EXISTS (SELECT 1 FROM cfc_failover.epochs WHERE released_at IS NULL)
     OR to_regprocedure('cfc_failover.block_writes()') IS NOT NULL
     OR EXISTS (SELECT 1 FROM pg_trigger WHERE tgname = 'cfc_production_write_fence') THEN
    RAISE EXCEPTION 'failover_existing_or_untracked_fence';
  END IF;
  RETURN jsonb_build_object('sourceRef', 'owkxkpkdffhcordlxqte', 'epoch', p_epoch, 'exists', false, 'active', false, 'drained', true);
END $$;

CREATE OR REPLACE FUNCTION cfc_failover.activate(p_epoch uuid, p_controller_sha text,
  p_source_ref text, p_admission_verified text)
RETURNS jsonb LANGUAGE plpgsql SET search_path = '' AS $$
DECLARE saved cfc_failover.epochs; snapshot jsonb; item jsonb; prior jsonb; job record; guard oid; triggers oid[];
BEGIN
  PERFORM cfc_failover.assert_runtime();
  IF p_epoch IS NULL OR p_controller_sha IS NULL OR p_controller_sha !~ '^[a-f0-9]{40}$'
     OR p_source_ref IS DISTINCT FROM 'owkxkpkdffhcordlxqte'
     OR p_admission_verified IS DISTINCT FROM 'verified' THEN
    RAISE EXCEPTION 'failover_activation_attestation_required';
  END IF;
  PERFORM pg_advisory_xact_lock(hashtextextended('cfc-production-failover', 0));
  PERFORM cfc_failover.assert_activation_allowed(p_epoch,p_controller_sha);
  SELECT * INTO saved FROM cfc_failover.epochs WHERE epoch = p_epoch FOR UPDATE;
  IF FOUND THEN
    IF saved.released_at IS NOT NULL THEN RAISE EXCEPTION 'failover_epoch_retired'; END IF;
    RETURN cfc_failover.verify(p_epoch, p_controller_sha);
  END IF;
  IF EXISTS (SELECT 1 FROM cfc_failover.epochs WHERE released_at IS NULL)
     OR to_regprocedure('cfc_failover.block_writes()') IS NOT NULL
     OR EXISTS (SELECT 1 FROM pg_trigger WHERE tgname = 'cfc_production_write_fence') THEN
    RAISE EXCEPTION 'failover_existing_or_untracked_fence';
  END IF;
  snapshot := cfc_failover.inventory();
  IF jsonb_array_length(snapshot) = 0 THEN RAISE EXCEPTION 'failover_empty_inventory'; END IF;
  FOR item IN SELECT value FROM jsonb_array_elements(snapshot) WHERE (value->>'fenced')::boolean ORDER BY (value->>'oid')::oid LOOP
    IF NOT has_table_privilege(current_user, (item->>'oid')::oid, 'TRIGGER') THEN
      RAISE EXCEPTION 'failover_table_trigger_privilege_missing';
    END IF;
    EXECUTE format('LOCK TABLE ONLY %I.%I IN ACCESS EXCLUSIVE MODE', item->>'schema', item->>'name');
  END LOOP;
  IF snapshot IS DISTINCT FROM cfc_failover.inventory() THEN RAISE EXCEPTION 'failover_inventory_changed_during_lock'; END IF;
  IF EXISTS (SELECT 1 FROM pg_stat_activity WHERE datname = current_database()
       AND pid <> pg_backend_pid() AND backend_type = 'client backend' AND xact_start IS NOT NULL)
     OR EXISTS (SELECT 1 FROM net.http_request_queue)
     OR EXISTS (SELECT 1 FROM league_sync.runs WHERE status IN ('queued', 'running')) THEN
    RAISE EXCEPTION 'failover_source_not_drained';
  END IF;
  IF EXISTS (SELECT 1 FROM cron.job WHERE active AND (username <> current_user
       OR btrim(command) <> 'select league_sync.enqueue(true);'
       OR schedule <> '0,15,30 13,14 * * 3')) THEN
    RAISE EXCEPTION 'failover_unreviewed_active_job';
  END IF;
  SELECT jsonb_build_object(
    'jobs', (SELECT coalesce(jsonb_agg(jsonb_build_object('id', jobid, 'active', active) ORDER BY jobid), '[]'::jsonb) FROM cron.job),
    'job_definitions', (SELECT coalesce(jsonb_agg(to_jsonb(j) - 'active' ORDER BY jobid), '[]'::jsonb) FROM cron.job j),
    'sync', (SELECT coalesce(jsonb_agg(jsonb_build_object('league_id', league_id, 'enabled', enabled) ORDER BY league_id), '[]'::jsonb) FROM league_sync.config),
    'sync_definitions', (SELECT coalesce(jsonb_agg(to_jsonb(s) - 'enabled' ORDER BY league_id), '[]'::jsonb) FROM league_sync.config s),
    'runtime', (SELECT coalesce(jsonb_agg(jsonb_build_object('league_id', league_id, 'writes_enabled', writes_enabled) ORDER BY league_id), '[]'::jsonb) FROM public.cfc_league_runtime),
    'runtime_leagues', (SELECT coalesce(jsonb_agg(league_id ORDER BY league_id), '[]'::jsonb) FROM public.cfc_league_runtime)
  ) INTO prior;
  FOR job IN SELECT jobid FROM cron.job WHERE active LOOP
    PERFORM cron.alter_job(job_id => job.jobid, active => false);
  END LOOP;
  UPDATE league_sync.config SET enabled = false WHERE enabled;
  UPDATE public.cfc_league_runtime SET writes_enabled = false WHERE writes_enabled;
  EXECUTE $guard$CREATE FUNCTION cfc_failover.block_writes() RETURNS trigger
    LANGUAGE plpgsql SET search_path = '' AS $body$
    BEGIN RAISE SQLSTATE '55000' USING MESSAGE = 'production_maintenance_fence'; END $body$ $guard$;
  REVOKE ALL ON FUNCTION cfc_failover.block_writes() FROM PUBLIC, anon, authenticated, service_role;
  -- Resolve after creation on every epoch; a regprocedure literal can retain
  -- the previous epoch's dropped OID in a cached PL/pgSQL expression.
  guard := to_regprocedure('cfc_failover.block_writes()')::oid;
  FOR item IN SELECT value FROM jsonb_array_elements(snapshot) WHERE (value->>'fenced')::boolean ORDER BY (value->>'oid')::oid LOOP
    EXECUTE format('CREATE TRIGGER cfc_production_write_fence BEFORE INSERT OR UPDATE OR DELETE OR TRUNCATE ON %I.%I
      FOR EACH STATEMENT EXECUTE FUNCTION cfc_failover.block_writes()', item->>'schema', item->>'name');
  END LOOP;
  SELECT array_agg(oid ORDER BY oid) INTO triggers FROM pg_trigger WHERE tgfoid = guard;
  INSERT INTO cfc_failover.epochs(epoch, source_ref, controller_sha, inventory, prior_settings,
    data_fingerprints, guard_oid, guard_definition, trigger_oids)
  VALUES (p_epoch, p_source_ref, p_controller_sha, snapshot, prior,
    cfc_failover.data_fingerprints(snapshot), guard, pg_get_functiondef(guard), triggers);
  RETURN cfc_failover.verify(p_epoch, p_controller_sha);
END $$;

CREATE OR REPLACE FUNCTION cfc_failover.release(p_epoch uuid, p_controller_sha text, p_release_verified text)
RETURNS jsonb LANGUAGE plpgsql SET search_path = '' AS $$
DECLARE saved cfc_failover.epochs; item jsonb; proof jsonb;
BEGIN
  PERFORM cfc_failover.assert_runtime();
  IF p_release_verified IS DISTINCT FROM 'source-return-verified' THEN
    RAISE EXCEPTION 'failover_source_return_attestation_required';
  END IF;
  PERFORM pg_advisory_xact_lock(hashtextextended('cfc-production-failover', 0));
  SELECT * INTO saved FROM cfc_failover.epochs WHERE epoch = p_epoch FOR UPDATE;
  IF NOT FOUND OR saved.controller_sha IS DISTINCT FROM p_controller_sha THEN
    RAISE EXCEPTION 'failover_unknown_epoch_or_controller';
  END IF;
  IF saved.released_at IS NOT NULL THEN RETURN cfc_failover.verify(p_epoch, p_controller_sha); END IF;
  PERFORM cfc_failover.assert_release_allowed(p_epoch,p_controller_sha);
  FOR item IN SELECT value FROM jsonb_array_elements(saved.inventory) WHERE (value->>'fenced')::boolean ORDER BY (value->>'oid')::oid LOOP
    EXECUTE format('LOCK TABLE ONLY %I.%I IN ACCESS EXCLUSIVE MODE', item->>'schema', item->>'name');
  END LOOP;
  proof := cfc_failover.verify_source_unchanged(p_epoch, p_controller_sha);
  -- verify_source_unchanged validates exact function definition/OID and the sole
  -- dependency set: precisely the recorded trigger OIDs. No other CASCADE scope.
  DROP FUNCTION cfc_failover.block_writes() CASCADE;
  FOR item IN SELECT value FROM jsonb_array_elements(saved.prior_settings->'jobs') LOOP
    PERFORM cron.alter_job(job_id => (item->>'id')::bigint, active => (item->>'active')::boolean);
  END LOOP;
  UPDATE league_sync.config c SET enabled = (x->>'enabled')::boolean
    FROM jsonb_array_elements(saved.prior_settings->'sync') x WHERE c.league_id = x->>'league_id';
  UPDATE public.cfc_league_runtime r SET writes_enabled = (x->>'writes_enabled')::boolean
    FROM jsonb_array_elements(saved.prior_settings->'runtime') x WHERE r.league_id = x->>'league_id';
  UPDATE cfc_failover.epochs SET released_at = clock_timestamp() WHERE epoch = p_epoch;
  RETURN cfc_failover.verify(p_epoch, p_controller_sha);
END $$;

REVOKE ALL ON ALL FUNCTIONS IN SCHEMA cfc_failover FROM PUBLIC, anon, authenticated, service_role;
COMMIT;
