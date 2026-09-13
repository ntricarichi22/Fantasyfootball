-- Security and multitenancy foundation. Review, then run as one rerunnable block.
-- This migration joins existing Auth users to the invitation map for rollout, but does not emit user rows.
BEGIN;

-- Required preflight: inspect the existing objects before any DDL.
SELECT table_schema, table_name, column_name, data_type, is_nullable
FROM information_schema.columns
WHERE table_schema IN ('public', 'storage', 'auth')
  AND table_name IN ('users', 'team_email_map', 'cfc_team_player_attachment', 'objects', 'buckets', 'draft_state')
ORDER BY table_schema, table_name, ordinal_position;

CREATE TABLE IF NOT EXISTS public.league_memberships (
  user_id    UUID        NOT NULL REFERENCES auth.users(id) ON DELETE CASCADE,
  league_id  TEXT        NOT NULL,
  roster_id  TEXT        NOT NULL,
  role       TEXT        NOT NULL DEFAULT 'member'
                         CHECK (role IN ('member', 'commissioner', 'admin')),
  created_at TIMESTAMPTZ NOT NULL DEFAULT now(),
  updated_at TIMESTAMPTZ NOT NULL DEFAULT now(),
  PRIMARY KEY (user_id, league_id),
  UNIQUE (league_id, roster_id)
);

CREATE INDEX IF NOT EXISTS league_memberships_league_roster_idx
  ON public.league_memberships (league_id, roster_id);

-- Compatibility backfill for the existing single league. This reads no rows
-- into output and does not change an existing membership/role. If draft_state
-- is not unambiguously single-league, stop rather than assign users incorrectly.
DO $$
DECLARE league_count INTEGER; only_league TEXT; missing_count INTEGER;
BEGIN
  SELECT count(*) INTO missing_count
  FROM auth.users users
  JOIN public.team_email_map mapping ON lower(mapping.email) = lower(users.email)
  WHERE users.email IS NOT NULL AND NOT EXISTS (
    SELECT 1 FROM public.league_memberships membership
    WHERE membership.user_id = users.id
  );
  IF missing_count = 0 THEN RETURN; END IF;
  SELECT count(DISTINCT league_id), min(league_id)
    INTO league_count, only_league FROM public.draft_state;
  IF league_count <> 1 OR only_league IS NULL THEN
    RAISE EXCEPTION 'membership backfill requires exactly one draft_state league; found %', league_count;
  END IF;
  INSERT INTO public.league_memberships (user_id, league_id, roster_id, role)
  SELECT users.id, only_league, mapping.roster_id, 'member'
  FROM auth.users users
  JOIN public.team_email_map mapping ON lower(mapping.email) = lower(users.email)
  WHERE users.email IS NOT NULL
  ON CONFLICT (user_id, league_id) DO NOTHING;
END $$;

ALTER TABLE public.league_memberships ENABLE ROW LEVEL SECURITY;
ALTER TABLE public.league_memberships FORCE ROW LEVEL SECURITY;

DROP POLICY IF EXISTS league_memberships_select_own ON public.league_memberships;
CREATE POLICY league_memberships_select_own
  ON public.league_memberships FOR SELECT TO authenticated
  USING (user_id = (SELECT auth.uid()));

REVOKE ALL ON TABLE public.league_memberships FROM anon;
REVOKE INSERT, UPDATE, DELETE, TRUNCATE, REFERENCES, TRIGGER
  ON TABLE public.league_memberships FROM authenticated;
GRANT SELECT ON TABLE public.league_memberships TO authenticated;

-- The invitation map contains account email addresses. It is server-only.
ALTER TABLE public.team_email_map ENABLE ROW LEVEL SECURITY;
ALTER TABLE public.team_email_map FORCE ROW LEVEL SECURITY;
REVOKE ALL ON TABLE public.team_email_map FROM anon, authenticated;

-- Confirmed team-private table. Members may access only their own roster in
-- their own league; server service-role operations continue to bypass RLS.
ALTER TABLE public.cfc_team_player_attachment ENABLE ROW LEVEL SECURITY;
ALTER TABLE public.cfc_team_player_attachment FORCE ROW LEVEL SECURITY;

DROP POLICY IF EXISTS cfc_team_player_attachment_member_select
  ON public.cfc_team_player_attachment;
CREATE POLICY cfc_team_player_attachment_member_select
  ON public.cfc_team_player_attachment FOR SELECT TO authenticated
  USING (EXISTS (
    SELECT 1 FROM public.league_memberships membership
    WHERE membership.user_id = (SELECT auth.uid())
      AND membership.league_id = cfc_team_player_attachment.league_id
      AND membership.roster_id = cfc_team_player_attachment.team_id
  ));

DROP POLICY IF EXISTS cfc_team_player_attachment_member_insert
  ON public.cfc_team_player_attachment;
CREATE POLICY cfc_team_player_attachment_member_insert
  ON public.cfc_team_player_attachment FOR INSERT TO authenticated
  WITH CHECK (EXISTS (
    SELECT 1 FROM public.league_memberships membership
    WHERE membership.user_id = (SELECT auth.uid())
      AND membership.league_id = cfc_team_player_attachment.league_id
      AND membership.roster_id = cfc_team_player_attachment.team_id
  ));

DROP POLICY IF EXISTS cfc_team_player_attachment_member_update
  ON public.cfc_team_player_attachment;
CREATE POLICY cfc_team_player_attachment_member_update
  ON public.cfc_team_player_attachment FOR UPDATE TO authenticated
  USING (EXISTS (
    SELECT 1 FROM public.league_memberships membership
    WHERE membership.user_id = (SELECT auth.uid())
      AND membership.league_id = cfc_team_player_attachment.league_id
      AND membership.roster_id = cfc_team_player_attachment.team_id
  ))
  WITH CHECK (EXISTS (
    SELECT 1 FROM public.league_memberships membership
    WHERE membership.user_id = (SELECT auth.uid())
      AND membership.league_id = cfc_team_player_attachment.league_id
      AND membership.roster_id = cfc_team_player_attachment.team_id
  ));

DROP POLICY IF EXISTS cfc_team_player_attachment_member_delete
  ON public.cfc_team_player_attachment;
CREATE POLICY cfc_team_player_attachment_member_delete
  ON public.cfc_team_player_attachment FOR DELETE TO authenticated
  USING (EXISTS (
    SELECT 1 FROM public.league_memberships membership
    WHERE membership.user_id = (SELECT auth.uid())
      AND membership.league_id = cfc_team_player_attachment.league_id
      AND membership.roster_id = cfc_team_player_attachment.team_id
  ));

REVOKE ALL ON TABLE public.cfc_team_player_attachment FROM anon;
GRANT SELECT, INSERT, UPDATE, DELETE
  ON TABLE public.cfc_team_player_attachment TO authenticated;

COMMIT;

-- Validation: inspect definitions and privilege boundaries (no private rows).
SELECT namespace.nspname AS schemaname, class.relname AS tablename,
       class.relrowsecurity AS rowsecurity,
       class.relforcerowsecurity AS forcerowsecurity
FROM pg_catalog.pg_class class
JOIN pg_catalog.pg_namespace namespace ON namespace.oid = class.relnamespace
WHERE namespace.nspname = 'public'
  AND class.relname IN ('league_memberships', 'team_email_map', 'cfc_team_player_attachment')
ORDER BY class.relname;

SELECT schemaname, tablename, policyname, roles, cmd, qual, with_check
FROM pg_policies
WHERE schemaname = 'public'
  AND tablename IN ('league_memberships', 'team_email_map', 'cfc_team_player_attachment')
ORDER BY tablename, policyname;

SELECT grantee, table_name, privilege_type
FROM information_schema.role_table_grants
WHERE table_schema = 'public'
  AND table_name IN ('league_memberships', 'team_email_map', 'cfc_team_player_attachment')
  AND grantee IN ('anon', 'authenticated')
ORDER BY table_name, grantee, privilege_type;
