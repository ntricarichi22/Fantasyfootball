-- Run only through the reviewed, exact-production-project operator connection.
-- First create the dedicated confirmed Auth identity through the Admin API with
-- app_metadata.purpose = 'storage-backup'; never add a league membership/invite.
-- On this same connection, set cfc.backup_reader_user_id to the returned UUID.
-- The UUID is an identity selector, not a credential. Keep its password private.
-- This rerunnable operation changes only two named SELECT policies: no grants,
-- account mutations, application objects, or canonical migration-history edits.
-- Removing these two policies revokes the access they grant to existing JWTs
-- (public object URLs remain public). Normal Auth token expiry still applies.

BEGIN;
SET LOCAL lock_timeout = '5s';
SET LOCAL statement_timeout = '30s';

-- Inspect the actual columns before any statement reads the existing tables.
SELECT table_schema, table_name, column_name, data_type
FROM information_schema.columns
WHERE (table_schema = 'auth' AND table_name = 'users')
   OR (table_schema = 'public' AND table_name IN ('league_memberships', 'league_invitations', 'team_email_map'))
   OR (table_schema = 'storage' AND table_name IN ('buckets', 'objects'))
ORDER BY table_schema, table_name, ordinal_position;

DO $backup_reader$
DECLARE
  backup_user_id uuid := nullif(current_setting('cfc.backup_reader_user_id', true), '')::uuid;
  backup_user record;
  target_table text;
  target_policy text;
  policy_grants jsonb := coalesce(nullif(current_setting('supautils.policy_grants', true), ''), '{}')::jsonb;
BEGIN
  IF backup_user_id IS NULL THEN
    RAISE EXCEPTION 'Set cfc.backup_reader_user_id to the dedicated Auth identity UUID';
  END IF;

  IF EXISTS (
    SELECT 1 FROM (VALUES
      ('auth', 'users', 'id', 'uuid'),
      ('auth', 'users', 'role', 'character varying'),
      ('auth', 'users', 'email', 'character varying'),
      ('auth', 'users', 'email_confirmed_at', 'timestamp with time zone'),
      ('auth', 'users', 'raw_app_meta_data', 'jsonb'),
      ('auth', 'users', 'is_anonymous', 'boolean'),
      ('auth', 'users', 'banned_until', 'timestamp with time zone'),
      ('auth', 'users', 'deleted_at', 'timestamp with time zone'),
      ('public', 'league_memberships', 'user_id', 'uuid'),
      ('public', 'league_invitations', 'email', 'text'),
      ('public', 'league_invitations', 'accepted_by', 'uuid'),
      ('public', 'team_email_map', 'email', 'text'),
      ('storage', 'buckets', 'id', 'text'),
      ('storage', 'objects', 'bucket_id', 'text'),
      ('storage', 'objects', 'metadata', 'jsonb'),
      ('storage', 'objects', 'updated_at', 'timestamp with time zone')
    ) required(schema_name, table_name, column_name, data_type)
    WHERE NOT EXISTS (
      SELECT 1 FROM information_schema.columns actual
      WHERE actual.table_schema = required.schema_name
        AND actual.table_name = required.table_name
        AND actual.column_name = required.column_name
        AND actual.data_type = required.data_type
    )
  ) THEN
    RAISE EXCEPTION 'Backup reader schema prerequisites differ from reviewed schema';
  END IF;

  SELECT role, email, email_confirmed_at, raw_app_meta_data, is_anonymous, deleted_at, banned_until
    INTO backup_user FROM auth.users WHERE id = backup_user_id FOR SHARE;
  IF NOT FOUND OR backup_user.role IS DISTINCT FROM 'authenticated'
     OR nullif(backup_user.email, '') IS NULL
     OR backup_user.email_confirmed_at IS NULL
     OR backup_user.raw_app_meta_data->>'purpose' IS DISTINCT FROM 'storage-backup'
     OR coalesce(backup_user.is_anonymous, false)
     OR backup_user.deleted_at IS NOT NULL
     OR backup_user.banned_until > now() THEN
    RAISE EXCEPTION 'Dedicated confirmed, active backup Auth identity required';
  END IF;
  IF EXISTS (SELECT 1 FROM public.league_memberships WHERE user_id = backup_user_id)
     OR EXISTS (SELECT 1 FROM public.league_invitations
                WHERE lower(btrim(email)) = lower(btrim(backup_user.email))
                   OR accepted_by = backup_user_id)
     OR EXISTS (SELECT 1 FROM public.team_email_map
                WHERE lower(btrim(email)) = lower(btrim(backup_user.email))) THEN
    RAISE EXCEPTION 'Backup identity must have no league membership or invitation';
  END IF;
  IF NOT EXISTS (SELECT 1 FROM pg_roles
                 WHERE rolname = 'authenticated' AND NOT rolsuper AND NOT rolbypassrls)
     OR EXISTS (SELECT 1 FROM pg_auth_members
                WHERE member = (SELECT oid FROM pg_roles WHERE rolname = 'authenticated'))
     OR NOT has_schema_privilege('authenticated', 'storage', 'USAGE') THEN
    RAISE EXCEPTION 'Unexpected authenticated role privileges';
  END IF;

  FOR target_table, target_policy IN
    SELECT * FROM (VALUES
      ('buckets', 'storage_backup_reader_buckets_select'),
      ('objects', 'storage_backup_reader_objects_select')
    ) targets(table_name, policy_name)
  LOOP
    IF NOT EXISTS (SELECT 1 FROM pg_class c JOIN pg_namespace n ON n.oid = c.relnamespace
                   WHERE n.nspname = 'storage' AND c.relname = target_table
                     AND c.relkind = 'r' AND c.relrowsecurity)
       OR NOT has_table_privilege('authenticated', format('storage.%I', target_table), 'SELECT') THEN
      RAISE EXCEPTION 'Expected Storage RLS and existing SELECT grant required';
    END IF;
    -- Hosted postgres is not the Storage owner. Its verified supautils policy
    -- grant permits policy DDL without assuming that role or changing ownership.
    IF NOT EXISTS (SELECT 1 FROM pg_class c JOIN pg_namespace n ON n.oid = c.relnamespace
                   WHERE n.nspname = 'storage' AND c.relname = target_table
                     AND (pg_has_role(current_user, c.relowner, 'USAGE')
                          OR (SELECT rolsuper FROM pg_roles WHERE rolname = current_user)))
       AND NOT coalesce((policy_grants->current_user) ? ('storage.' || target_table), false) THEN
      RAISE EXCEPTION 'Operator lacks reviewed Storage policy management privilege';
    END IF;
    -- This source currently has no other policies on either table. Stop if that
    -- changes, rather than overlook a permissive policy that also admits writes.
    IF EXISTS (SELECT 1 FROM pg_policies WHERE schemaname = 'storage'
               AND tablename = target_table AND policyname <> target_policy) THEN
      RAISE EXCEPTION 'Unreviewed existing Storage policy';
    END IF;
    EXECUTE format('DROP POLICY IF EXISTS %I ON storage.%I', target_policy, target_table);
    EXECUTE format(
      'CREATE POLICY %I ON storage.%I FOR SELECT TO authenticated USING ((SELECT auth.uid()) = %L::uuid)',
      target_policy, target_table, backup_user_id
    );
  END LOOP;
END
$backup_reader$;

-- Safe postconditions; no account email, UUID, object names, ETags or bytes.
SELECT
  (SELECT count(*) = 2 FROM pg_policies
    WHERE schemaname = 'storage' AND cmd = 'SELECT'
      AND roles = ARRAY['authenticated']::name[]
      AND ((tablename = 'buckets' AND policyname = 'storage_backup_reader_buckets_select')
        OR (tablename = 'objects' AND policyname = 'storage_backup_reader_objects_select')))
    AS two_read_policies_installed,
  (SELECT count(*) FROM pg_policies
    WHERE schemaname = 'storage' AND tablename IN ('buckets', 'objects')
      AND cmd <> 'SELECT') AS mutation_policy_count,
  (SELECT count(*) FROM public.league_memberships
    WHERE user_id = current_setting('cfc.backup_reader_user_id')::uuid) AS backup_memberships,
  (SELECT count(*) FROM storage.objects) AS objects,
  (SELECT max(updated_at) FROM storage.objects) AS latest_object_updated_at,
  (SELECT count(*) FROM storage.objects
    WHERE coalesce(metadata->>'eTag', metadata->>'etag', '') <> '') AS objects_with_metadata_etag;

COMMIT;

-- After applying, authenticate as the backup identity through the official Auth
-- password grant. Verify bucket/object listing and authenticated downloads; verify
-- league reads are empty and application RPC execution is denied. Do not attempt
-- a production upload/delete as a negative test. Exercise denied mutations with
-- this policy configuration in the disposable integration database instead.
-- authenticated still has its existing read-only rookie catalog access; this
-- operation does not represent that ordinary role as Storage-exclusive.
