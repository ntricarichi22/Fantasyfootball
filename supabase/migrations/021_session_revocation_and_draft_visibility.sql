-- Confirmed against the live Supabase catalog on 2026-11-14. Rerunnable.
SELECT table_schema, table_name, column_name, data_type
FROM information_schema.columns
WHERE (table_schema = 'auth' AND table_name IN ('sessions', 'users'))
   OR (table_schema = 'public' AND table_name IN ('draft_log', 'league_memberships'))
ORDER BY table_schema, table_name, ordinal_position;

BEGIN;
SET LOCAL lock_timeout = '5s';
SET LOCAL statement_timeout = '30s';

-- The server has already verified the signed cookie. This service-only check
-- makes provider logout, session expiry, account bans, and deletion authoritative.
CREATE OR REPLACE FUNCTION public.is_auth_session_active(p_session_id uuid, p_user_id uuid)
RETURNS boolean
LANGUAGE sql STABLE SECURITY DEFINER
SET search_path = ''
AS $$
  SELECT EXISTS (
    SELECT 1 FROM auth.sessions AS session
    JOIN auth.users AS account ON account.id = session.user_id
    WHERE session.id = p_session_id
      AND session.user_id = p_user_id
      AND (session.not_after IS NULL OR session.not_after > now())
      AND account.deleted_at IS NULL
      AND (account.banned_until IS NULL OR account.banned_until <= now())
  );
$$;
REVOKE ALL ON FUNCTION public.is_auth_session_active(uuid, uuid) FROM PUBLIC, anon, authenticated;
GRANT EXECUTE ON FUNCTION public.is_auth_session_active(uuid, uuid) TO service_role;

-- League membership alone must not disclose an opponent's unannounced pick.
DROP POLICY IF EXISTS draft_log_league_member ON public.draft_log;
CREATE POLICY draft_log_league_member ON public.draft_log
FOR SELECT TO authenticated
USING (
  EXISTS (
    SELECT 1 FROM public.league_memberships AS membership
    WHERE membership.user_id = (SELECT auth.uid())
      AND membership.league_id = draft_log.league_id
      AND (
        draft_log.is_announced
        OR membership.roster_id = draft_log.roster_id
        OR membership.role IN ('commissioner', 'admin')
      )
  )
);

DO $$
BEGIN
  IF has_function_privilege('anon', 'public.is_auth_session_active(uuid,uuid)', 'EXECUTE')
     OR has_function_privilege('authenticated', 'public.is_auth_session_active(uuid,uuid)', 'EXECUTE')
     OR NOT has_function_privilege('service_role', 'public.is_auth_session_active(uuid,uuid)', 'EXECUTE') THEN
    RAISE EXCEPTION 'Session activity RPC grants are unsafe';
  END IF;
  IF public.is_auth_session_active(NULL, NULL)
     OR public.is_auth_session_active('00000000-0000-0000-0000-000000000000', '00000000-0000-0000-0000-000000000000') THEN
    RAISE EXCEPTION 'Missing sessions must fail closed';
  END IF;
END $$;
COMMIT;

SELECT policyname, roles, cmd, qual FROM pg_policies
WHERE schemaname = 'public' AND tablename = 'draft_log';
SELECT has_function_privilege('service_role', 'public.is_auth_session_active(uuid,uuid)', 'EXECUTE') AS service_can_execute,
       has_function_privilege('anon', 'public.is_auth_session_active(uuid,uuid)', 'EXECUTE') AS anon_can_execute,
       has_function_privilege('authenticated', 'public.is_auth_session_active(uuid,uuid)', 'EXECUTE') AS user_can_execute;
