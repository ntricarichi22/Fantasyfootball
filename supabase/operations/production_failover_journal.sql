-- Private controller/watchdog journal. Install after production_failover_fence.sql.
-- No customer tables, Auth rows, Storage metadata or existing settings are changed.
BEGIN;
SET LOCAL lock_timeout = '5s';
SET LOCAL statement_timeout = '30s';
SELECT table_schema, table_name, column_name, data_type
FROM information_schema.columns WHERE table_schema = 'cfc_failover'
ORDER BY table_name, ordinal_position;
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

CREATE TABLE IF NOT EXISTS cfc_failover.controller_journal (
  epoch uuid PRIMARY KEY,
  controller_sha text NOT NULL CHECK (controller_sha ~ '^[a-f0-9]{40}$'),
  plan jsonb NOT NULL CHECK (jsonb_typeof(plan) = 'object'),
  encrypted_baseline jsonb NOT NULL CHECK (jsonb_typeof(encrypted_baseline) = 'object'),
  baseline_sha256 text NOT NULL CHECK (baseline_sha256 ~ '^[a-f0-9]{64}$'),
  controller_run_id text NOT NULL CHECK (controller_run_id ~ '^[1-9][0-9]{0,19}$'),
  watcher_run_id text CHECK (watcher_run_id ~ '^[1-9][0-9]{0,19}$'),
  watcher_job_name text NOT NULL DEFAULT 'watch-and-return' CHECK (watcher_job_name = 'watch-and-return'),
  created_at timestamptz NOT NULL DEFAULT clock_timestamp(),
  heartbeat_at timestamptz,
  failback_claimed_at timestamptz,
  recovery_promotion_requested_at timestamptz,
  recovery_promotion_settled_at timestamptz,
  phase text NOT NULL DEFAULT 'armed' CHECK (phase IN ('armed','validate','preflight','arm_watcher','watcher','fence','activate_fence','admission',
    'verify_source_data','exercise_recovery',
    'promote_recovery','verify_recovery','promote_source','verify_source','release_fence','restore_admission','complete')),
  completed_at timestamptz
);
REVOKE ALL ON cfc_failover.controller_journal FROM PUBLIC, anon, authenticated, service_role;

-- A small durable tombstone also covers expiry before a controller plan exists.
-- It never expires automatically: delayed arm/activation must remain rejected.
CREATE TABLE IF NOT EXISTS cfc_failover.resource_retirements (
  epoch uuid PRIMARY KEY,
  controller_sha text NOT NULL CHECK (controller_sha ~ '^[a-f0-9]{40}$'),
  retired_at timestamptz NOT NULL DEFAULT clock_timestamp()
);
REVOKE ALL ON cfc_failover.resource_retirements FROM PUBLIC, anon, authenticated, service_role;

CREATE OR REPLACE FUNCTION cfc_failover.protect_journal()
RETURNS trigger LANGUAGE plpgsql SET search_path = '' AS $$
BEGIN
  IF TG_OP <> 'UPDATE' THEN RAISE EXCEPTION 'failover_journal_immutable'; END IF;
  IF OLD.completed_at IS NOT NULL
     OR (to_jsonb(NEW) - ARRAY['watcher_run_id','heartbeat_at','failback_claimed_at','recovery_promotion_requested_at','recovery_promotion_settled_at','phase','completed_at'])
       IS DISTINCT FROM (to_jsonb(OLD) - ARRAY['watcher_run_id','heartbeat_at','failback_claimed_at','recovery_promotion_requested_at','recovery_promotion_settled_at','phase','completed_at'])
     OR (OLD.watcher_run_id IS NOT NULL AND NEW.watcher_run_id IS DISTINCT FROM OLD.watcher_run_id)
     OR (OLD.failback_claimed_at IS NOT NULL AND NEW.failback_claimed_at IS DISTINCT FROM OLD.failback_claimed_at)
     OR (OLD.recovery_promotion_requested_at IS NOT NULL AND NEW.recovery_promotion_requested_at IS DISTINCT FROM OLD.recovery_promotion_requested_at)
     OR (OLD.recovery_promotion_settled_at IS NOT NULL AND NEW.recovery_promotion_settled_at IS DISTINCT FROM OLD.recovery_promotion_settled_at)
     OR (OLD.heartbeat_at IS NOT NULL AND (NEW.heartbeat_at IS NULL OR NEW.heartbeat_at < OLD.heartbeat_at)) THEN
    RAISE EXCEPTION 'failover_journal_immutable';
  END IF;
  RETURN NEW;
END $$;

CREATE OR REPLACE FUNCTION cfc_failover.protect_resource_retirement()
RETURNS trigger LANGUAGE plpgsql SET search_path = '' AS $$
BEGIN RAISE EXCEPTION 'failover_resource_retirement_immutable'; END $$;
DROP TRIGGER IF EXISTS cfc_failover_resource_retirement_immutable ON cfc_failover.resource_retirements;
CREATE TRIGGER cfc_failover_resource_retirement_immutable BEFORE UPDATE OR DELETE OR TRUNCATE ON cfc_failover.resource_retirements
  FOR EACH STATEMENT EXECUTE FUNCTION cfc_failover.protect_resource_retirement();
DROP TRIGGER IF EXISTS cfc_failover_journal_immutable ON cfc_failover.controller_journal;
CREATE TRIGGER cfc_failover_journal_immutable BEFORE UPDATE OR DELETE ON cfc_failover.controller_journal
  FOR EACH ROW EXECUTE FUNCTION cfc_failover.protect_journal();
DROP TRIGGER IF EXISTS cfc_failover_journal_no_truncate ON cfc_failover.controller_journal;
CREATE TRIGGER cfc_failover_journal_no_truncate BEFORE TRUNCATE ON cfc_failover.controller_journal
  FOR EACH STATEMENT EXECUTE FUNCTION cfc_failover.protect_journal();

CREATE OR REPLACE FUNCTION cfc_failover.journal(p_epoch uuid, p_controller_sha text)
RETURNS jsonb LANGUAGE plpgsql SET search_path = '' AS $$
DECLARE saved cfc_failover.controller_journal;
BEGIN
  PERFORM cfc_failover.assert_runtime();
  SELECT * INTO saved FROM cfc_failover.controller_journal WHERE epoch = p_epoch;
  IF NOT FOUND OR saved.controller_sha IS DISTINCT FROM p_controller_sha THEN
    RAISE EXCEPTION 'failover_unknown_journal_or_controller';
  END IF;
  RETURN jsonb_build_object('plan', saved.plan, 'encryptedBaseline', saved.encrypted_baseline,
    'baselineSha256', saved.baseline_sha256, 'controllerRunId', saved.controller_run_id,
    'watcherRunId', saved.watcher_run_id, 'watcherJobName', saved.watcher_job_name,
    'observedAt', floor(extract(epoch FROM clock_timestamp()) * 1000)::bigint,
    'heartbeatAt', floor(extract(epoch FROM saved.heartbeat_at) * 1000)::bigint,
    'recoveryPromotionRequestedAt', floor(extract(epoch FROM saved.recovery_promotion_requested_at) * 1000)::bigint,
    'recoveryPromotionSettledAt', floor(extract(epoch FROM saved.recovery_promotion_settled_at) * 1000)::bigint,
    'phase', saved.phase, 'failbackClaimed', saved.failback_claimed_at IS NOT NULL,
    'complete', saved.completed_at IS NOT NULL);
END $$;

CREATE OR REPLACE FUNCTION cfc_failover.request_promotion(p_epoch uuid, p_controller_sha text)
RETURNS jsonb LANGUAGE plpgsql SET search_path = '' AS $$
DECLARE proof jsonb;
BEGIN
  PERFORM cfc_failover.assert_runtime();
  PERFORM pg_advisory_xact_lock(hashtextextended('cfc-production-failover', 0));
  PERFORM cfc_failover.assert_activation_allowed(p_epoch,p_controller_sha);
  proof := cfc_failover.verify(p_epoch,p_controller_sha);
  IF NOT (proof->>'active')::boolean THEN RAISE EXCEPTION 'failover_promotion_requires_fence'; END IF;
  UPDATE cfc_failover.controller_journal SET recovery_promotion_requested_at = clock_timestamp()
    WHERE epoch = p_epoch AND recovery_promotion_requested_at IS NULL;
  IF NOT FOUND THEN RAISE EXCEPTION 'failover_promotion_already_requested'; END IF;
  RETURN cfc_failover.journal(p_epoch,p_controller_sha);
END $$;

CREATE OR REPLACE FUNCTION cfc_failover.settle_promotion(p_epoch uuid, p_controller_sha text, p_provider_verified text)
RETURNS jsonb LANGUAGE plpgsql SET search_path = '' AS $$
DECLARE saved cfc_failover.controller_journal;
BEGIN
  PERFORM cfc_failover.assert_runtime();
  PERFORM pg_advisory_xact_lock(hashtextextended('cfc-production-failover', 0));
  SELECT * INTO saved FROM cfc_failover.controller_journal WHERE epoch = p_epoch FOR UPDATE;
  IF NOT FOUND OR saved.controller_sha IS DISTINCT FROM p_controller_sha OR saved.completed_at IS NOT NULL
     OR saved.recovery_promotion_requested_at IS NULL OR p_provider_verified IS DISTINCT FROM 'provider-job-settled' THEN
    RAISE EXCEPTION 'failover_promotion_settlement_attestation_required';
  END IF;
  IF saved.recovery_promotion_settled_at IS NULL THEN
    UPDATE cfc_failover.controller_journal SET recovery_promotion_settled_at = clock_timestamp() WHERE epoch = p_epoch;
  END IF;
  RETURN cfc_failover.journal(p_epoch,p_controller_sha);
END $$;

CREATE OR REPLACE FUNCTION cfc_failover.assert_release_allowed(p_epoch uuid, p_controller_sha text)
RETURNS void LANGUAGE plpgsql SET search_path = '' AS $$
DECLARE saved cfc_failover.controller_journal;
BEGIN
  SELECT * INTO saved FROM cfc_failover.controller_journal WHERE epoch = p_epoch FOR UPDATE;
  IF NOT FOUND OR saved.controller_sha IS DISTINCT FROM p_controller_sha OR saved.failback_claimed_at IS NULL
     OR (saved.recovery_promotion_requested_at IS NOT NULL AND saved.recovery_promotion_settled_at IS NULL) THEN
    RAISE EXCEPTION 'failover_return_unclaimed_or_promotion_unsettled';
  END IF;
END $$;

CREATE OR REPLACE FUNCTION cfc_failover.assert_activation_allowed(p_epoch uuid, p_controller_sha text)
RETURNS void LANGUAGE plpgsql SET search_path = '' AS $$
DECLARE saved cfc_failover.controller_journal;
BEGIN
  SELECT * INTO saved FROM cfc_failover.controller_journal WHERE epoch = p_epoch FOR UPDATE;
  IF NOT FOUND OR saved.controller_sha IS DISTINCT FROM p_controller_sha OR saved.completed_at IS NOT NULL
     OR saved.failback_claimed_at IS NOT NULL OR saved.watcher_run_id IS NULL OR saved.heartbeat_at IS NULL
     OR saved.heartbeat_at < clock_timestamp() - interval '30 seconds'
     OR (saved.plan->>'deadline')::timestamptz <= clock_timestamp() THEN
    RAISE EXCEPTION 'failover_journal_not_armed_or_return_claimed';
  END IF;
END $$;

-- Durable tombstone before rollback: even an API-queued activate that starts
-- after an absent-epoch inspection must now refuse this retired intent.
CREATE OR REPLACE FUNCTION cfc_failover.begin_failback(p_epoch uuid, p_controller_sha text)
RETURNS jsonb LANGUAGE plpgsql SET search_path = '' AS $$
DECLARE saved cfc_failover.controller_journal;
BEGIN
  PERFORM cfc_failover.assert_runtime();
  PERFORM pg_advisory_xact_lock(hashtextextended('cfc-production-failover', 0));
  SELECT * INTO saved FROM cfc_failover.controller_journal WHERE epoch = p_epoch FOR UPDATE;
  IF NOT FOUND OR saved.controller_sha IS DISTINCT FROM p_controller_sha THEN
    RAISE EXCEPTION 'failover_unknown_journal_or_controller';
  END IF;
  IF saved.completed_at IS NULL AND saved.failback_claimed_at IS NULL THEN
    UPDATE cfc_failover.controller_journal SET failback_claimed_at = clock_timestamp() WHERE epoch = p_epoch;
  END IF;
  RETURN cfc_failover.inspect(p_epoch,p_controller_sha) || jsonb_build_object('failbackClaimed', true);
END $$;

CREATE OR REPLACE FUNCTION cfc_failover.arm(p_plan jsonb, p_encrypted_baseline jsonb,
  p_baseline_sha256 text, p_controller_run_id text)
RETURNS jsonb LANGUAGE plpgsql SET search_path = '' AS $$
DECLARE saved cfc_failover.controller_journal; chosen_epoch uuid; chosen_sha text; issued timestamptz; deadline timestamptz;
BEGIN
  PERFORM cfc_failover.assert_runtime();
  IF jsonb_typeof(p_plan) IS DISTINCT FROM 'object'
     OR jsonb_typeof(p_encrypted_baseline) IS DISTINCT FROM 'object'
     OR octet_length(p_plan::text) > 32768 OR octet_length(p_encrypted_baseline::text) > 262144
     OR p_plan->>'sourceRef' IS DISTINCT FROM 'owkxkpkdffhcordlxqte'
     OR p_plan->>'purpose' IS DISTINCT FROM 'production-failover-drill'
     OR p_plan->>'version' IS DISTINCT FROM '1'
     OR coalesce(p_plan->>'commitSha','') !~ '^[a-f0-9]{40}$'
     OR coalesce(p_baseline_sha256,'') !~ '^[a-f0-9]{64}$'
     OR coalesce(p_controller_run_id,'') !~ '^[1-9][0-9]{0,19}$' THEN
    RAISE EXCEPTION 'failover_journal_plan_invalid';
  END IF;
  chosen_epoch := (p_plan->>'epoch')::uuid; chosen_sha := p_plan->>'commitSha';
  issued := (p_plan->>'issuedAt')::timestamptz; deadline := (p_plan->>'deadline')::timestamptz;
  IF chosen_epoch IS NULL OR issued IS NULL OR deadline IS NULL OR deadline <= issued
     OR deadline - issued > interval '30 minutes' THEN RAISE EXCEPTION 'failover_journal_plan_invalid'; END IF;
  PERFORM pg_advisory_xact_lock(hashtextextended('cfc-production-failover', 0));
  IF EXISTS (SELECT 1 FROM cfc_failover.resource_retirements WHERE epoch = chosen_epoch) THEN
    RAISE EXCEPTION 'failover_resource_retired';
  END IF;
  SELECT * INTO saved FROM cfc_failover.controller_journal WHERE epoch = chosen_epoch FOR UPDATE;
  IF FOUND THEN
    IF saved.plan IS DISTINCT FROM p_plan OR saved.encrypted_baseline IS DISTINCT FROM p_encrypted_baseline
       OR saved.baseline_sha256 IS DISTINCT FROM p_baseline_sha256 OR saved.controller_run_id IS DISTINCT FROM p_controller_run_id THEN
      RAISE EXCEPTION 'failover_journal_plan_conflict';
    END IF;
    RETURN cfc_failover.journal(chosen_epoch, chosen_sha);
  END IF;
  IF issued > clock_timestamp() OR deadline <= clock_timestamp()
     OR EXISTS (SELECT 1 FROM cfc_failover.controller_journal WHERE completed_at IS NULL)
     OR EXISTS (SELECT 1 FROM cfc_failover.epochs WHERE released_at IS NULL) THEN
    RAISE EXCEPTION 'failover_journal_unfinished_or_expired';
  END IF;
  IF (SELECT count(*) FROM cfc_failover.resource_retirements) >= 10000 THEN
    RAISE EXCEPTION 'failover_retirement_retention_review_required';
  END IF;
  INSERT INTO cfc_failover.controller_journal(epoch,controller_sha,plan,encrypted_baseline,baseline_sha256,controller_run_id)
    VALUES(chosen_epoch,chosen_sha,p_plan,p_encrypted_baseline,p_baseline_sha256,p_controller_run_id);
  RETURN cfc_failover.journal(chosen_epoch, chosen_sha);
END $$;

CREATE OR REPLACE FUNCTION cfc_failover.resource_state(p_epoch uuid, p_controller_sha text)
RETURNS jsonb LANGUAGE plpgsql SET search_path = '' AS $$
DECLARE proof jsonb; saved cfc_failover.controller_journal; retired cfc_failover.resource_retirements; private_journal jsonb;
BEGIN
  PERFORM cfc_failover.assert_runtime();
  PERFORM pg_advisory_xact_lock(hashtextextended('cfc-production-failover', 0));
  proof := cfc_failover.inspect(p_epoch,p_controller_sha);
  SELECT * INTO retired FROM cfc_failover.resource_retirements WHERE epoch = p_epoch;
  IF FOUND AND retired.controller_sha IS DISTINCT FROM p_controller_sha THEN
    RAISE EXCEPTION 'failover_retirement_controller_mismatch';
  END IF;
  SELECT * INTO saved FROM cfc_failover.controller_journal WHERE epoch = p_epoch;
  IF FOUND THEN private_journal := cfc_failover.journal(p_epoch,p_controller_sha); END IF;
  RETURN jsonb_build_object('sourceRef','owkxkpkdffhcordlxqte','epoch',p_epoch,'exists',private_journal IS NOT NULL,
    'activeFence',(proof->>'active')::boolean,'retired',retired.epoch IS NOT NULL,'journal',private_journal,
    'observedAt',floor(extract(epoch FROM clock_timestamp())*1000)::bigint);
END $$;

CREATE OR REPLACE FUNCTION cfc_failover.retire_resource(p_epoch uuid, p_controller_sha text)
RETURNS jsonb LANGUAGE plpgsql SET search_path = '' AS $$
DECLARE state jsonb;
BEGIN
  PERFORM cfc_failover.assert_runtime();
  PERFORM pg_advisory_xact_lock(hashtextextended('cfc-production-failover', 0));
  state := cfc_failover.resource_state(p_epoch,p_controller_sha);
  IF (state->>'activeFence')::boolean OR ((state->>'exists')::boolean AND NOT (state->'journal'->>'complete')::boolean) THEN
    RAISE EXCEPTION 'failover_resource_still_in_use';
  END IF;
  IF NOT (state->>'retired')::boolean THEN
    INSERT INTO cfc_failover.resource_retirements(epoch,controller_sha) VALUES(p_epoch,p_controller_sha);
  END IF;
  RETURN cfc_failover.resource_state(p_epoch,p_controller_sha);
END $$;

-- The caller MUST independently verify GitHub run path/main/SHA/job identity.
-- SQL arguments are operator attestations, never proof of GitHub authentication.
CREATE OR REPLACE FUNCTION cfc_failover.heartbeat(p_epoch uuid, p_controller_sha text,
  p_watcher_run_id text, p_job_name text)
RETURNS jsonb LANGUAGE plpgsql SET search_path = '' AS $$
DECLARE saved cfc_failover.controller_journal;
BEGIN
  PERFORM cfc_failover.assert_runtime();
  SELECT * INTO saved FROM cfc_failover.controller_journal WHERE epoch = p_epoch FOR UPDATE;
  IF NOT FOUND OR saved.controller_sha IS DISTINCT FROM p_controller_sha OR saved.completed_at IS NOT NULL
     OR p_job_name IS DISTINCT FROM saved.watcher_job_name
     OR coalesce(p_watcher_run_id,'') !~ '^[1-9][0-9]{0,19}$'
     OR p_watcher_run_id = saved.controller_run_id
     OR (saved.watcher_run_id IS NOT NULL AND saved.watcher_run_id IS DISTINCT FROM p_watcher_run_id) THEN
    RAISE EXCEPTION 'failover_watcher_identity_or_state';
  END IF;
  UPDATE cfc_failover.controller_journal SET watcher_run_id = p_watcher_run_id, heartbeat_at = clock_timestamp()
    WHERE epoch = p_epoch;
  RETURN cfc_failover.journal(p_epoch,p_controller_sha);
END $$;

CREATE OR REPLACE FUNCTION cfc_failover.record_phase(p_epoch uuid, p_controller_sha text, p_phase text)
RETURNS jsonb LANGUAGE plpgsql SET search_path = '' AS $$
BEGIN
  PERFORM cfc_failover.assert_runtime();
  IF p_phase = 'complete' THEN RAISE EXCEPTION 'failover_use_verified_completion'; END IF;
  UPDATE cfc_failover.controller_journal SET phase = p_phase
    WHERE epoch = p_epoch AND controller_sha = p_controller_sha AND completed_at IS NULL;
  IF NOT FOUND THEN RAISE EXCEPTION 'failover_unknown_or_completed_journal'; END IF;
  RETURN cfc_failover.journal(p_epoch,p_controller_sha);
END $$;

CREATE OR REPLACE FUNCTION cfc_failover.complete(p_epoch uuid, p_controller_sha text, p_return_verified text)
RETURNS jsonb LANGUAGE plpgsql SET search_path = '' AS $$
DECLARE proof jsonb; saved cfc_failover.controller_journal;
BEGIN
  PERFORM cfc_failover.assert_runtime();
  IF p_return_verified IS DISTINCT FROM 'source-return-and-admission-verified' THEN
    RAISE EXCEPTION 'failover_completion_attestation_required';
  END IF;
  proof := cfc_failover.inspect(p_epoch,p_controller_sha);
  IF (proof->>'active')::boolean THEN RAISE EXCEPTION 'failover_fence_still_active'; END IF;
  SELECT * INTO saved FROM cfc_failover.controller_journal WHERE epoch = p_epoch FOR UPDATE;
  IF NOT FOUND OR saved.controller_sha IS DISTINCT FROM p_controller_sha THEN
    RAISE EXCEPTION 'failover_unknown_journal_or_controller';
  END IF;
  PERFORM cfc_failover.assert_release_allowed(p_epoch,p_controller_sha);
  IF saved.completed_at IS NULL THEN
    UPDATE cfc_failover.controller_journal SET phase = 'complete', completed_at = clock_timestamp() WHERE epoch = p_epoch;
  END IF;
  RETURN cfc_failover.journal(p_epoch,p_controller_sha);
END $$;
REVOKE ALL ON ALL FUNCTIONS IN SCHEMA cfc_failover FROM PUBLIC, anon, authenticated, service_role;
COMMIT;
