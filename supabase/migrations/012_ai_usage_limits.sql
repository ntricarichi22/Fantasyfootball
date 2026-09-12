-- Additive, rerunnable AI accounting. UTC calendar months; amounts are integer USD micros.
CREATE TABLE IF NOT EXISTS public.ai_usage_reservations (
  id uuid PRIMARY KEY DEFAULT gen_random_uuid(), user_id uuid NOT NULL,
  month_start date NOT NULL, feature text NOT NULL, model text NOT NULL,
  reserved_micros bigint NOT NULL CHECK (reserved_micros > 0), actual_micros bigint,
  status text NOT NULL DEFAULT 'reserved' CHECK (status IN ('reserved','succeeded','failed','provider_error')),
  created_at timestamptz NOT NULL DEFAULT now(), reconciled_at timestamptz
);
CREATE INDEX IF NOT EXISTS ai_usage_reservations_user_month_idx ON public.ai_usage_reservations(user_id, month_start, created_at);
CREATE INDEX IF NOT EXISTS ai_usage_reservations_month_idx ON public.ai_usage_reservations(month_start);
ALTER TABLE public.ai_usage_reservations ENABLE ROW LEVEL SECURITY;
REVOKE ALL ON public.ai_usage_reservations FROM anon, authenticated;

CREATE OR REPLACE FUNCTION public.ai_reserve_usage(p_user_id uuid, p_feature text, p_model text, p_reserved_micros bigint, p_user_limit_micros bigint, p_pilot_limit_micros bigint, p_requests_per_minute integer, p_max_concurrent integer)
RETURNS TABLE(reservation_id uuid, used_micros bigint, remaining_micros bigint) LANGUAGE plpgsql SECURITY DEFINER SET search_path=public AS $$
DECLARE m date := date_trunc('month', timezone('UTC', now()))::date; uid bigint; total bigint; active integer; recent integer; rid uuid;
BEGIN
  IF p_reserved_micros <= 0 OR p_user_limit_micros <= 0 OR p_pilot_limit_micros <= 0 THEN RAISE EXCEPTION 'AI budget configuration invalid'; END IF;
  PERFORM pg_advisory_xact_lock(hashtextextended(p_user_id::text || m::text, 0)); PERFORM pg_advisory_xact_lock(hashtextextended('pilot' || m::text, 0));
  SELECT count(*) FILTER (WHERE status='reserved'), count(*) FILTER (WHERE created_at > now()-interval '1 minute') INTO active,recent FROM public.ai_usage_reservations WHERE user_id=p_user_id AND month_start=m;
  IF active >= p_max_concurrent THEN RAISE EXCEPTION 'Too many concurrent AI requests'; END IF;
  IF recent >= p_requests_per_minute THEN RAISE EXCEPTION 'AI request rate limit reached'; END IF;
  SELECT coalesce(sum(coalesce(actual_micros,reserved_micros)),0) INTO uid FROM public.ai_usage_reservations WHERE user_id=p_user_id AND month_start=m;
  SELECT coalesce(sum(coalesce(actual_micros,reserved_micros)),0) INTO total FROM public.ai_usage_reservations WHERE month_start=m;
  IF uid+p_reserved_micros > p_user_limit_micros THEN RAISE EXCEPTION 'Monthly per-user AI allowance exhausted'; END IF;
  IF total+p_reserved_micros > p_pilot_limit_micros THEN RAISE EXCEPTION 'Monthly pilot AI allowance exhausted'; END IF;
  INSERT INTO public.ai_usage_reservations(user_id,month_start,feature,model,reserved_micros) VALUES(p_user_id,m,p_feature,p_model,p_reserved_micros) RETURNING id INTO rid;
  RETURN QUERY SELECT rid,uid,p_user_limit_micros-uid-p_reserved_micros;
END $$;

CREATE OR REPLACE FUNCTION public.ai_reconcile_usage(p_reservation_id uuid,p_actual_micros bigint,p_outcome text) RETURNS void LANGUAGE plpgsql SECURITY DEFINER SET search_path=public AS $$
BEGIN
 IF p_actual_micros < 0 OR p_outcome NOT IN ('succeeded','failed','provider_error') THEN RAISE EXCEPTION 'Invalid reconciliation'; END IF;
 UPDATE public.ai_usage_reservations SET actual_micros=LEAST(p_actual_micros,reserved_micros),status=p_outcome,reconciled_at=now() WHERE id=p_reservation_id AND status='reserved';
 IF NOT FOUND THEN RAISE EXCEPTION 'Reservation unavailable'; END IF;
END $$;

CREATE OR REPLACE FUNCTION public.ai_get_quota(p_user_id uuid,p_user_limit_micros bigint,p_pilot_limit_micros bigint) RETURNS TABLE(used_micros bigint,remaining_micros bigint,pilot_used_micros bigint,pilot_remaining_micros bigint) LANGUAGE sql SECURITY DEFINER SET search_path=public AS $$
 WITH m AS (SELECT date_trunc('month',timezone('UTC',now()))::date d), u AS (SELECT coalesce(sum(coalesce(actual_micros,reserved_micros)),0)::bigint n FROM public.ai_usage_reservations,m WHERE user_id=p_user_id AND month_start=m.d), p AS (SELECT coalesce(sum(coalesce(actual_micros,reserved_micros)),0)::bigint n FROM public.ai_usage_reservations,m WHERE month_start=m.d) SELECT u.n,greatest(0,p_user_limit_micros-u.n),p.n,greatest(0,p_pilot_limit_micros-p.n) FROM u,p
$$;
REVOKE ALL ON FUNCTION public.ai_reserve_usage(uuid,text,text,bigint,bigint,bigint,integer,integer), FUNCTION public.ai_reconcile_usage(uuid,bigint,text), FUNCTION public.ai_get_quota(uuid,bigint,bigint) FROM PUBLIC, anon, authenticated;
GRANT EXECUTE ON FUNCTION public.ai_reserve_usage(uuid,text,text,bigint,bigint,bigint,integer,integer), FUNCTION public.ai_reconcile_usage(uuid,bigint,text), FUNCTION public.ai_get_quota(uuid,bigint,bigint) TO service_role;

-- Validation (read-only):
SELECT column_name,data_type,is_nullable FROM information_schema.columns WHERE table_schema='public' AND table_name='ai_usage_reservations' ORDER BY ordinal_position;
SELECT month_start,status,count(*),sum(coalesce(actual_micros,reserved_micros)) AS accounted_micros FROM public.ai_usage_reservations GROUP BY month_start,status ORDER BY month_start DESC,status;
