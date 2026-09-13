-- One-time invitation grants make membership creation explicit and revocation durable.
-- Existing production is a confirmed single league; abort rather than guess otherwise.
BEGIN;

SELECT table_name, column_name, data_type, is_nullable
FROM information_schema.columns
WHERE table_schema = 'public'
  AND table_name IN ('team_email_map', 'league_memberships', 'draft_state')
ORDER BY table_name, ordinal_position;

CREATE TABLE IF NOT EXISTS public.league_invitations (
  id uuid PRIMARY KEY DEFAULT gen_random_uuid(),
  league_id text NOT NULL,
  email text NOT NULL,
  roster_id text NOT NULL,
  state text NOT NULL DEFAULT 'active' CHECK (state IN ('active', 'revoked')),
  accepted_by uuid NULL REFERENCES auth.users(id) ON DELETE SET NULL,
  accepted_at timestamptz NULL,
  created_at timestamptz NOT NULL DEFAULT now(),
  updated_at timestamptz NOT NULL DEFAULT now(),
  UNIQUE (league_id, email)
);
CREATE INDEX IF NOT EXISTS league_invitations_accepted_by_idx
  ON public.league_invitations (accepted_by, league_id);
ALTER TABLE public.league_invitations ENABLE ROW LEVEL SECURITY;
ALTER TABLE public.league_invitations FORCE ROW LEVEL SECURITY;
REVOKE ALL ON public.league_invitations FROM PUBLIC, anon, authenticated;

CREATE TABLE IF NOT EXISTS public.auth_attempt_windows (
  fingerprint text NOT NULL CHECK (length(fingerprint) = 64),
  bucket_at timestamptz NOT NULL,
  attempt_count integer NOT NULL DEFAULT 1 CHECK (attempt_count > 0),
  PRIMARY KEY (fingerprint, bucket_at)
);
ALTER TABLE public.auth_attempt_windows ENABLE ROW LEVEL SECURITY;
ALTER TABLE public.auth_attempt_windows FORCE ROW LEVEL SECURITY;
REVOKE ALL ON public.auth_attempt_windows FROM PUBLIC, anon, authenticated;

DO $$
DECLARE league_count integer; only_league text; mapping_count bigint;
BEGIN
  SELECT count(*) INTO mapping_count FROM public.team_email_map;
  IF mapping_count = 0 THEN
    RETURN;
  END IF;
  SELECT count(DISTINCT league_id), min(league_id)
    INTO league_count, only_league FROM public.draft_state;
  IF league_count <> 1 OR only_league IS NULL THEN
    RAISE EXCEPTION 'invitation migration requires exactly one draft_state league; found %', league_count;
  END IF;

  INSERT INTO public.league_invitations (league_id, email, roster_id, accepted_by, accepted_at)
  SELECT only_league, lower(btrim(m.email)), m.roster_id, membership.user_id,
         CASE WHEN membership.user_id IS NOT NULL THEN now() ELSE NULL END
  FROM public.team_email_map m
  LEFT JOIN auth.users users ON lower(users.email) = lower(m.email)
  LEFT JOIN public.league_memberships membership
    ON membership.user_id = users.id AND membership.league_id = only_league
  ON CONFLICT (league_id, email) DO NOTHING;
END $$;

CREATE OR REPLACE FUNCTION public.accept_league_invitation(
  p_user_id uuid, p_email text, p_league_id text
) RETURNS TABLE(league_id text, roster_id text, role text)
LANGUAGE plpgsql SECURITY DEFINER SET search_path = public, auth AS $$
DECLARE invitation public.league_invitations%ROWTYPE;
BEGIN
  IF p_user_id IS NULL OR p_email IS NULL OR p_league_id IS NULL THEN RETURN; END IF;
  IF NOT EXISTS (
    SELECT 1 FROM auth.users u
    WHERE u.id = p_user_id AND lower(u.email) = lower(btrim(p_email))
  ) THEN RETURN; END IF;

  SELECT * INTO invitation FROM public.league_invitations i
  WHERE i.league_id = p_league_id AND i.email = lower(btrim(p_email))
    AND i.state = 'active' AND i.accepted_by IS NULL
  FOR UPDATE;
  IF NOT FOUND THEN RETURN; END IF;

  INSERT INTO public.league_memberships (user_id, league_id, roster_id, role)
  VALUES (p_user_id, invitation.league_id, invitation.roster_id, 'member');
  UPDATE public.league_invitations
    SET accepted_by = p_user_id, accepted_at = now(), updated_at = now()
    WHERE id = invitation.id;
  RETURN QUERY SELECT invitation.league_id, invitation.roster_id, 'member'::text;
END $$;

CREATE OR REPLACE FUNCTION public.revoke_league_access(p_user_id uuid, p_league_id text)
RETURNS void LANGUAGE plpgsql SECURITY DEFINER SET search_path = public AS $$
BEGIN
  UPDATE public.league_invitations SET state='revoked', updated_at=now()
  WHERE accepted_by=p_user_id AND league_id=p_league_id;
  DELETE FROM public.league_memberships WHERE user_id=p_user_id AND league_id=p_league_id;
END $$;

CREATE OR REPLACE FUNCTION public.claim_auth_attempt(
  p_fingerprint text, p_window_minutes integer, p_max_attempts integer
) RETURNS boolean LANGUAGE plpgsql SECURITY DEFINER SET search_path = public AS $$
DECLARE bucket timestamptz; attempts integer;
BEGIN
  IF p_fingerprint !~ '^[0-9a-f]{64}$' OR p_window_minutes NOT BETWEEN 1 AND 60
     OR p_max_attempts NOT BETWEEN 1 AND 100 THEN
    RAISE EXCEPTION 'invalid auth attempt bounds';
  END IF;
  PERFORM pg_advisory_xact_lock(hashtextextended('auth:' || p_fingerprint, 0));
  bucket := to_timestamp(floor(extract(epoch FROM now())/(p_window_minutes*60))*(p_window_minutes*60));
  INSERT INTO public.auth_attempt_windows(fingerprint,bucket_at) VALUES(p_fingerprint,bucket)
  ON CONFLICT (fingerprint,bucket_at) DO UPDATE
    SET attempt_count=auth_attempt_windows.attempt_count+1
  RETURNING attempt_count INTO attempts;
  -- Fixed retention bounds pseudonymous cardinality without process-local state.
  DELETE FROM public.auth_attempt_windows WHERE bucket_at < now()-interval '24 hours';
  RETURN attempts <= p_max_attempts;
END $$;

REVOKE ALL ON FUNCTION public.accept_league_invitation(uuid,text,text),
  public.revoke_league_access(uuid,text), public.claim_auth_attempt(text,integer,integer)
  FROM PUBLIC, anon, authenticated;
GRANT EXECUTE ON FUNCTION public.accept_league_invitation(uuid,text,text),
  public.revoke_league_access(uuid,text), public.claim_auth_attempt(text,integer,integer)
  TO service_role;
COMMIT;

SELECT c.relname, c.relrowsecurity, c.relforcerowsecurity
FROM pg_class c JOIN pg_namespace n ON n.oid=c.relnamespace
WHERE n.nspname='public' AND c.relname='league_invitations';
