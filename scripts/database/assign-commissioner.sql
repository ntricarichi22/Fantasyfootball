-- REVIEWED OPERATOR ACTION; NOT A MIGRATION. Executed only against synthetic CI fixtures.
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

CREATE TEMP TABLE commissioner_assignment_target ON COMMIT DROP AS
SELECT league_id,user_id
FROM public.league_memberships
WHERE league_id=:'league_id' AND user_id=:'user_id'::uuid
FOR UPDATE;

DO $$
BEGIN
  IF (SELECT count(*) FROM commissioner_assignment_target) <> 1 THEN
    RAISE EXCEPTION 'commissioner assignment requires exactly one existing membership';
  END IF;
END $$;

UPDATE public.league_memberships membership
SET role='commissioner', updated_at=now()
FROM commissioner_assignment_target target
WHERE membership.league_id=target.league_id AND membership.user_id=target.user_id;

INSERT INTO public.security_audit_log(actor_user_id,league_id,target_type,target_id,action,outcome,change_summary)
VALUES (:'actor_user_id'::uuid,:'league_id','membership',:'user_id',
  'assign_commissioner','success',jsonb_build_object('role','commissioner'));

SELECT league_id,user_id,roster_id,role
FROM public.league_memberships
WHERE league_id=:'league_id' AND user_id=:'user_id'::uuid;
COMMIT;
