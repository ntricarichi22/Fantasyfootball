-- Security monitoring and immutable privileged-change audit storage.
-- Rerunnable; creates only narrowly scoped new objects. Do not apply without review.

-- Required preflight: inspect the live namespace before any DDL. This migration does
-- not depend on, alter, or infer columns from an existing application table.
SELECT table_schema, table_name, column_name, data_type, is_nullable
FROM information_schema.columns
WHERE table_schema = 'public'
  AND table_name IN ('security_events', 'security_audit_log')
ORDER BY table_name, ordinal_position;

CREATE TABLE IF NOT EXISTS public.security_events (
  id BIGINT GENERATED ALWAYS AS IDENTITY PRIMARY KEY,
  event_type TEXT NOT NULL CHECK (event_type IN (
    'authentication_failure', 'authorization_failure', 'application_error',
    'ai_usage', 'ai_quota_warning', 'ai_quota_blocked'
  )),
  severity TEXT NOT NULL CHECK (severity IN ('info', 'warning', 'error', 'critical')),
  outcome TEXT NOT NULL CHECK (outcome IN ('success', 'failure', 'blocked')),
  source TEXT NOT NULL CHECK (length(source) BETWEEN 1 AND 120),
  actor_user_id UUID NULL,
  league_id TEXT NOT NULL DEFAULT '' CHECK (length(league_id) <= 100),
  target_id TEXT NULL CHECK (length(target_id) <= 120),
  fingerprint TEXT NOT NULL DEFAULT '' CHECK (length(fingerprint) <= 128),
  summary JSONB NOT NULL DEFAULT '{}'::jsonb CHECK (jsonb_typeof(summary) = 'object'),
  occurrence_count INTEGER NOT NULL DEFAULT 1 CHECK (occurrence_count > 0),
  first_seen_at TIMESTAMPTZ NOT NULL DEFAULT now(),
  last_seen_at TIMESTAMPTZ NOT NULL DEFAULT now(),
  bucket_at TIMESTAMPTZ NOT NULL,
  UNIQUE (event_type, source, fingerprint, league_id, bucket_at)
);

CREATE INDEX IF NOT EXISTS security_events_alert_scan_idx
  ON public.security_events (event_type, last_seen_at DESC);
ALTER TABLE public.security_events ENABLE ROW LEVEL SECURITY;
REVOKE ALL ON public.security_events FROM anon, authenticated;
REVOKE ALL ON SEQUENCE public.security_events_id_seq FROM anon, authenticated;

CREATE TABLE IF NOT EXISTS public.security_audit_log (
  id BIGINT GENERATED ALWAYS AS IDENTITY PRIMARY KEY,
  occurred_at TIMESTAMPTZ NOT NULL DEFAULT now(),
  actor_user_id UUID NOT NULL,
  league_id TEXT NOT NULL CHECK (length(league_id) BETWEEN 1 AND 100),
  target_type TEXT NOT NULL CHECK (target_type IN ('membership', 'team_ownership', 'permission')),
  target_id TEXT NOT NULL CHECK (length(target_id) BETWEEN 1 AND 120),
  action TEXT NOT NULL CHECK (length(action) BETWEEN 1 AND 120),
  outcome TEXT NOT NULL CHECK (outcome IN ('success', 'failure', 'blocked')),
  change_summary JSONB NOT NULL DEFAULT '{}'::jsonb CHECK (jsonb_typeof(change_summary) = 'object')
);

CREATE INDEX IF NOT EXISTS security_audit_log_scope_idx
  ON public.security_audit_log (league_id, occurred_at DESC);
ALTER TABLE public.security_audit_log ENABLE ROW LEVEL SECURITY;
REVOKE ALL ON public.security_audit_log FROM anon, authenticated;
REVOKE ALL ON SEQUENCE public.security_audit_log_id_seq FROM anon, authenticated;

-- Durable, cross-instance alert claims. Delivery remains disabled until the
-- server-only provider configuration is complete; no address is stored here.
CREATE TABLE IF NOT EXISTS public.security_alert_deliveries (
  id UUID PRIMARY KEY DEFAULT gen_random_uuid(),
  dedupe_key TEXT NOT NULL CHECK (length(dedupe_key) BETWEEN 1 AND 128),
  event_type TEXT NOT NULL CHECK (length(event_type) BETWEEN 1 AND 64),
  bucket_at TIMESTAMPTZ NOT NULL,
  status TEXT NOT NULL DEFAULT 'reserved' CHECK (status IN ('reserved', 'sent', 'failed')),
  created_at TIMESTAMPTZ NOT NULL DEFAULT now(),
  updated_at TIMESTAMPTZ NOT NULL DEFAULT now(),
  UNIQUE (dedupe_key, bucket_at)
);
CREATE INDEX IF NOT EXISTS security_alert_deliveries_rate_idx
  ON public.security_alert_deliveries (created_at DESC);
ALTER TABLE public.security_alert_deliveries ENABLE ROW LEVEL SECURITY;
REVOKE ALL ON public.security_alert_deliveries FROM anon, authenticated;
GRANT SELECT, INSERT, UPDATE ON public.security_alert_deliveries TO service_role;

CREATE OR REPLACE FUNCTION public.claim_security_alert(
  p_dedupe_key TEXT, p_event_type TEXT, p_window_minutes INTEGER,
  p_max_per_hour INTEGER
) RETURNS UUID LANGUAGE plpgsql SECURITY DEFINER SET search_path = public AS $$
DECLARE
  v_bucket TIMESTAMPTZ;
  v_id UUID;
BEGIN
  IF length(COALESCE(p_dedupe_key, '')) NOT BETWEEN 1 AND 128
     OR length(COALESCE(p_event_type, '')) NOT BETWEEN 1 AND 64
     OR p_window_minutes NOT BETWEEN 5 AND 1440
     OR p_max_per_hour NOT BETWEEN 1 AND 100 THEN
    RAISE EXCEPTION 'invalid alert claim bounds';
  END IF;
  -- Serialize the small pilot-wide limit across all server instances.
  PERFORM pg_advisory_xact_lock(hashtextextended('security-alert-rate', 0));
  IF (SELECT count(*) FROM public.security_alert_deliveries
      WHERE created_at >= now() - interval '1 hour') >= p_max_per_hour THEN
    RETURN NULL;
  END IF;
  v_bucket := to_timestamp(
    floor(extract(epoch FROM now()) / (p_window_minutes * 60)) * (p_window_minutes * 60)
  );
  INSERT INTO public.security_alert_deliveries (dedupe_key, event_type, bucket_at)
  VALUES (p_dedupe_key, p_event_type, v_bucket)
  ON CONFLICT (dedupe_key, bucket_at) DO NOTHING
  RETURNING id INTO v_id;
  RETURN v_id;
END $$;
REVOKE ALL ON FUNCTION public.claim_security_alert(TEXT,TEXT,INTEGER,INTEGER)
  FROM PUBLIC, anon, authenticated;
GRANT EXECUTE ON FUNCTION public.claim_security_alert(TEXT,TEXT,INTEGER,INTEGER)
  TO service_role;

-- Aggregate identical events into five-minute buckets to bound failed-login/error noise.
CREATE OR REPLACE FUNCTION public.record_security_event(
  p_event_type TEXT, p_severity TEXT, p_outcome TEXT, p_source TEXT,
  p_actor_user_id UUID DEFAULT NULL, p_league_id TEXT DEFAULT NULL,
  p_target_id TEXT DEFAULT NULL, p_fingerprint TEXT DEFAULT NULL,
  p_summary JSONB DEFAULT '{}'::jsonb
) RETURNS VOID LANGUAGE plpgsql SECURITY INVOKER SET search_path = public AS $$
DECLARE v_bucket TIMESTAMPTZ := date_trunc('hour', now())
  + floor(extract(minute from now()) / 5) * interval '5 minutes';
BEGIN
  INSERT INTO public.security_events (
    event_type, severity, outcome, source, actor_user_id, league_id,
    target_id, fingerprint, summary, bucket_at
  ) VALUES (
    p_event_type, p_severity, p_outcome, left(p_source, 120), p_actor_user_id,
    left(COALESCE(p_league_id, ''), 100), left(p_target_id, 120),
    left(COALESCE(p_fingerprint, ''), 128),
    COALESCE(p_summary, '{}'::jsonb), v_bucket
  )
  ON CONFLICT (event_type, source, fingerprint, league_id, bucket_at)
  DO UPDATE SET occurrence_count = security_events.occurrence_count + 1,
    last_seen_at = now(), severity = EXCLUDED.severity;
END $$;
REVOKE ALL ON FUNCTION public.record_security_event(TEXT,TEXT,TEXT,TEXT,UUID,TEXT,TEXT,TEXT,JSONB)
  FROM PUBLIC, anon, authenticated;
GRANT EXECUTE ON FUNCTION public.record_security_event(TEXT,TEXT,TEXT,TEXT,UUID,TEXT,TEXT,TEXT,JSONB)
  TO service_role;

-- Even a mistakenly broad future grant cannot update/delete audit records.
CREATE OR REPLACE FUNCTION public.prevent_security_audit_mutation()
RETURNS TRIGGER LANGUAGE plpgsql SET search_path = public AS $$
BEGIN
  RAISE EXCEPTION 'security_audit_log is append-only';
END $$;
DROP TRIGGER IF EXISTS security_audit_log_append_only ON public.security_audit_log;
CREATE TRIGGER security_audit_log_append_only BEFORE UPDATE OR DELETE
ON public.security_audit_log FOR EACH ROW EXECUTE FUNCTION public.prevent_security_audit_mutation();

-- Validation (expected: RLS true; no anon/authenticated privileges; trigger present).
SELECT c.relname, c.relrowsecurity
FROM pg_class c JOIN pg_namespace n ON n.oid = c.relnamespace
WHERE n.nspname = 'public' AND c.relname IN (
  'security_events', 'security_audit_log', 'security_alert_deliveries'
);
SELECT grantee, table_name, privilege_type FROM information_schema.role_table_grants
WHERE table_schema = 'public' AND table_name IN ('security_events', 'security_audit_log')
ORDER BY table_name, grantee, privilege_type;
SELECT trigger_name, event_manipulation FROM information_schema.triggers
WHERE event_object_schema = 'public' AND event_object_table = 'security_audit_log';
