-- Keep invitation identity case/whitespace invariant at the database boundary.
-- Production catalog for this table was confirmed before this migration was written.
BEGIN;

SELECT table_name, column_name, data_type, is_nullable
FROM information_schema.columns
WHERE table_schema = 'public' AND table_name = 'league_invitations'
ORDER BY ordinal_position;

DO $$
BEGIN
  IF EXISTS (
    SELECT 1
    FROM public.league_invitations
    GROUP BY league_id, lower(btrim(email))
    HAVING count(*) > 1
  ) THEN
    RAISE EXCEPTION 'league_invitations contains normalized email collisions; review them before migration 020';
  END IF;
END $$;

UPDATE public.league_invitations SET email = lower(btrim(email))
WHERE email IS DISTINCT FROM lower(btrim(email));

CREATE OR REPLACE FUNCTION public.normalize_league_invitation_email()
RETURNS trigger LANGUAGE plpgsql SET search_path = public AS $$
BEGIN
  NEW.email := lower(btrim(NEW.email));
  IF NEW.email = '' THEN RAISE EXCEPTION 'invitation email cannot be blank'; END IF;
  RETURN NEW;
END $$;

DROP TRIGGER IF EXISTS normalize_league_invitation_email ON public.league_invitations;
CREATE TRIGGER normalize_league_invitation_email
BEFORE INSERT OR UPDATE OF email ON public.league_invitations
FOR EACH ROW EXECUTE FUNCTION public.normalize_league_invitation_email();

CREATE UNIQUE INDEX IF NOT EXISTS league_invitations_normalized_email_key
ON public.league_invitations (league_id, lower(btrim(email)));

REVOKE ALL ON FUNCTION public.normalize_league_invitation_email() FROM PUBLIC, anon, authenticated;
COMMIT;

SELECT indexname, indexdef
FROM pg_indexes
WHERE schemaname = 'public' AND tablename = 'league_invitations'
ORDER BY indexname;
