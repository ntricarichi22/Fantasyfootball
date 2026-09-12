-- REVIEWED OPERATOR ACTION; NOT A MIGRATION AND NOT EXECUTED BY CI.
-- Run only after migrations 012-020, with a private direct database connection:
-- psql "$DATABASE_URL" -v ON_ERROR_STOP=1 -v league_id='<league>' -v user_id='<verified-auth-uuid>' -v actor_user_id='<operator-auth-uuid>' -f scripts/database/assign-commissioner.sql
BEGIN;
SELECT table_name,column_name,data_type,is_nullable,column_default
FROM information_schema.columns
WHERE table_schema='public' AND table_name='league_memberships'
ORDER BY ordinal_position;

DO $$ BEGIN
  IF to_regclass('public.league_memberships') IS NULL THEN
    RAISE EXCEPTION 'league_memberships is unavailable; apply reviewed security migrations first';
  END IF;
END $$;

UPDATE public.league_memberships
SET role='commissioner', updated_at=now()
WHERE league_id=:'league_id' AND user_id=:'user_id'::uuid;

-- CASE evaluates the failing cast only when cardinality is not exactly one;
-- ON_ERROR_STOP then aborts this transaction before COMMIT.
SELECT CASE WHEN count(*)=1 THEN 1 ELSE 'assignment_failed'::integer END AS exactly_one_current_commissioner
FROM public.league_memberships
WHERE league_id=:'league_id' AND user_id=:'user_id'::uuid
  AND role='commissioner';

INSERT INTO public.security_audit_log(actor_user_id,league_id,target_type,target_id,action,outcome,change_summary)
VALUES (:'actor_user_id'::uuid,:'league_id','membership',:'user_id',
  'assign_commissioner','success',jsonb_build_object('role','commissioner'));

SELECT league_id,user_id,roster_id,role
FROM public.league_memberships
WHERE league_id=:'league_id' AND user_id=:'user_id'::uuid;
COMMIT;
