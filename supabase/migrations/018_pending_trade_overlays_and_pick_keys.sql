-- Additive source-of-truth support for accepted trades and durable pick keys.
-- Production execution remains rollout-gated with the application release.
SELECT table_name,column_name,data_type
FROM information_schema.columns
WHERE table_schema='public' AND table_name IN
 ('trade_offers','cfc_team_player_attachment','cfc_team_trade_values_current','cfc_team_draft_class_strength')
ORDER BY table_name,ordinal_position;

CREATE TABLE IF NOT EXISTS public.cfc_pending_trade_overlays (
  offer_id uuid PRIMARY KEY REFERENCES public.trade_offers(id) ON DELETE CASCADE,
  league_id text NOT NULL,
  from_team_id text NOT NULL,
  to_team_id text NOT NULL,
  assets_from jsonb NOT NULL CHECK (jsonb_typeof(assets_from)='array'),
  assets_to jsonb NOT NULL CHECK (jsonb_typeof(assets_to)='array'),
  accepted_at timestamptz,
  reconciled_at timestamptz,
  created_at timestamptz NOT NULL DEFAULT now()
);
CREATE INDEX IF NOT EXISTS cfc_pending_trade_overlays_active_idx
  ON public.cfc_pending_trade_overlays(league_id,accepted_at) WHERE accepted_at IS NOT NULL AND reconciled_at IS NULL;
ALTER TABLE public.cfc_pending_trade_overlays ENABLE ROW LEVEL SECURITY;
ALTER TABLE public.cfc_pending_trade_overlays FORCE ROW LEVEL SECURITY;
REVOKE ALL ON TABLE public.cfc_pending_trade_overlays FROM PUBLIC,anon,authenticated;
GRANT ALL ON TABLE public.cfc_pending_trade_overlays TO service_role;

-- Convert a retired slotted key (pick:YYYY-R-SS-RID) to the durable identity
-- (pick:YYYY-R-RID). Canonical keys and player ids pass through unchanged.
CREATE OR REPLACE FUNCTION public.cfc_durable_pick_key(value text)
RETURNS text LANGUAGE sql IMMUTABLE STRICT PARALLEL SAFE
SET search_path=public
AS $$
 SELECT CASE WHEN value ~ '^pick:[0-9]{4}-[0-9]+-(tbd|[0-9]+)-[^-]+$'
   THEN regexp_replace(value,'^(pick:[0-9]{4}-[0-9]+)-(?:tbd|[0-9]+)-([^-]+)$',E'\\1-\\2')
   ELSE value END
$$;

-- Migrate key-bearing tables without deleting a winning canonical row. The
-- duplicate loser is archived as JSON in a migration-local audit table.
CREATE TABLE IF NOT EXISTS public.cfc_pick_key_migration_018_archive (
  source_table text NOT NULL, old_key text NOT NULL, row_data jsonb NOT NULL,
  archived_at timestamptz NOT NULL DEFAULT now()
);
ALTER TABLE public.cfc_pick_key_migration_018_archive ENABLE ROW LEVEL SECURITY;
ALTER TABLE public.cfc_pick_key_migration_018_archive FORCE ROW LEVEL SECURITY;
REVOKE ALL ON TABLE public.cfc_pick_key_migration_018_archive FROM PUBLIC,anon,authenticated;
GRANT ALL ON TABLE public.cfc_pick_key_migration_018_archive TO service_role;

DO $$
DECLARE r record; new_key text;
BEGIN
 IF to_regclass('public.cfc_team_player_attachment') IS NOT NULL THEN
  FOR r IN SELECT ctid,* FROM public.cfc_team_player_attachment
    WHERE sleeper_player_id ~ '^pick:[0-9]{4}-[0-9]+-(tbd|[0-9]+)-[^-]+$'
  LOOP
   new_key:=public.cfc_durable_pick_key(r.sleeper_player_id);
   IF EXISTS(SELECT 1 FROM public.cfc_team_player_attachment x WHERE x.league_id=r.league_id AND x.team_id=r.team_id AND x.sleeper_player_id=new_key) THEN
    INSERT INTO public.cfc_pick_key_migration_018_archive VALUES('cfc_team_player_attachment',r.sleeper_player_id,to_jsonb(r)-'ctid',now());
    DELETE FROM public.cfc_team_player_attachment WHERE ctid=r.ctid;
   ELSE
    UPDATE public.cfc_team_player_attachment SET sleeper_player_id=new_key WHERE ctid=r.ctid;
   END IF;
  END LOOP;
 END IF;
 IF to_regclass('public.cfc_team_draft_class_strength') IS NOT NULL THEN
  FOR r IN SELECT ctid,* FROM public.cfc_team_draft_class_strength
    WHERE pick_key ~ '^pick:[0-9]{4}-[0-9]+-(tbd|[0-9]+)-[^-]+$'
  LOOP
   new_key:=public.cfc_durable_pick_key(r.pick_key);
   IF EXISTS(SELECT 1 FROM public.cfc_team_draft_class_strength x WHERE x.league_id=r.league_id AND x.team_id=r.team_id AND x.pick_key=new_key) THEN
    INSERT INTO public.cfc_pick_key_migration_018_archive VALUES('cfc_team_draft_class_strength',r.pick_key,to_jsonb(r)-'ctid',now());
    DELETE FROM public.cfc_team_draft_class_strength WHERE ctid=r.ctid;
   ELSE
    UPDATE public.cfc_team_draft_class_strength SET pick_key=new_key WHERE ctid=r.ctid;
   END IF;
  END LOOP;
 END IF;
 IF to_regclass('public.cfc_team_trade_values_current') IS NOT NULL THEN
  FOR r IN SELECT ctid,* FROM public.cfc_team_trade_values_current
    WHERE sleeper_player_id ~ '^pick:[0-9]{4}-[0-9]+-(tbd|[0-9]+)-[^-]+$'
  LOOP
   new_key:=public.cfc_durable_pick_key(r.sleeper_player_id);
   IF EXISTS(SELECT 1 FROM public.cfc_team_trade_values_current x WHERE x.league_id=r.league_id AND x.team_id=r.team_id AND x.sleeper_player_id=new_key) THEN
    INSERT INTO public.cfc_pick_key_migration_018_archive VALUES('cfc_team_trade_values_current',r.sleeper_player_id,to_jsonb(r)-'ctid',now());
    DELETE FROM public.cfc_team_trade_values_current WHERE ctid=r.ctid;
   ELSE
    UPDATE public.cfc_team_trade_values_current SET sleeper_player_id=new_key WHERE ctid=r.ctid;
   END IF;
  END LOOP;
 END IF;
END $$;

-- Stored offer assets are arrays of objects with a key property.
UPDATE public.trade_offers o SET
 assets_from=(SELECT jsonb_agg(CASE WHEN elem ? 'key' THEN jsonb_set(elem,'{key}',to_jsonb(public.cfc_durable_pick_key(elem->>'key'))) ELSE elem END ORDER BY ord) FROM jsonb_array_elements(o.assets_from) WITH ORDINALITY a(elem,ord)),
 assets_to=(SELECT jsonb_agg(CASE WHEN elem ? 'key' THEN jsonb_set(elem,'{key}',to_jsonb(public.cfc_durable_pick_key(elem->>'key'))) ELSE elem END ORDER BY ord) FROM jsonb_array_elements(o.assets_to) WITH ORDINALITY a(elem,ord))
WHERE o.assets_from::text ~ 'pick:[0-9]{4}-[0-9]+-(tbd|[0-9]+)-[^-]+' OR o.assets_to::text ~ 'pick:[0-9]{4}-[0-9]+-(tbd|[0-9]+)-[^-]+';

REVOKE ALL ON FUNCTION public.cfc_durable_pick_key(text) FROM PUBLIC,anon,authenticated;
GRANT EXECUTE ON FUNCTION public.cfc_durable_pick_key(text) TO service_role;

-- Validation: inspect existence/columns first; absent optional value tables are
-- reported rather than recreated. Offer count must be zero.
SELECT wanted.table_name,columns.column_name,columns.data_type
FROM (VALUES ('cfc_team_player_attachment'),('cfc_team_draft_class_strength'),
 ('cfc_team_trade_values_current'),('trade_offers'),('cfc_pending_trade_overlays')) wanted(table_name)
LEFT JOIN information_schema.columns columns ON columns.table_schema='public' AND columns.table_name=wanted.table_name
ORDER BY wanted.table_name,columns.ordinal_position;
SELECT count(*) offer_old_keys FROM public.trade_offers
WHERE assets_from::text ~ 'pick:[0-9]{4}-[0-9]+-(tbd|[0-9]+)-[^-]+'
   OR assets_to::text ~ 'pick:[0-9]{4}-[0-9]+-(tbd|[0-9]+)-[^-]+';
