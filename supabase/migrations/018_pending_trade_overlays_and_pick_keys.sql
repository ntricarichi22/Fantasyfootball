-- Additive source-of-truth support for accepted trades and durable pick keys.
-- Production execution remains rollout-gated with the application release.
SELECT table_name,column_name,data_type
FROM information_schema.columns
WHERE table_schema='public' AND table_name IN
 ('trade_offers','cfc_team_player_attachment','cfc_asset_calculations','cfc_asset_source_values',
  'cfc_assets','cfc_team_draft_class_strength','cfc_team_manual_value_overrides',
  'cfc_trade_values_current','watchlist')
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
  -- Parent assets first. A replacement parent is created before children move;
  -- child uniqueness collisions are archived and merged without touching
  -- GENERATED ALWAYS identity values.
  FOR r IN SELECT ctid,* FROM public.cfc_assets
    WHERE asset_key ~ '^pick:[0-9]{4}-[0-9]+-(tbd|[0-9]+)-[^-]+$'
  LOOP
    new_key := public.cfc_durable_pick_key(r.asset_key);
    INSERT INTO public.cfc_pick_key_migration_018_archive(source_table,old_key,row_data)
      VALUES('cfc_assets',r.asset_key,to_jsonb(r)-'ctid');
    IF NOT EXISTS (SELECT 1 FROM public.cfc_assets WHERE asset_key=new_key) THEN
      INSERT INTO public.cfc_assets(asset_key,asset_type,display_name,sleeper_player_id,position,birth_date,
        age_override,pick_round,pick_number,is_active,manual_override_value,manual_override_reason,created_at,updated_at,years_exp)
      VALUES(new_key,r.asset_type,r.display_name,r.sleeper_player_id,r.position,r.birth_date,
        r.age_override,r.pick_round,r.pick_number,r.is_active,r.manual_override_value,r.manual_override_reason,r.created_at,r.updated_at,r.years_exp);
    END IF;

    INSERT INTO public.cfc_pick_key_migration_018_archive(source_table,old_key,row_data)
      SELECT 'cfc_asset_calculations',r.asset_key,to_jsonb(c) FROM public.cfc_asset_calculations c WHERE c.asset_key=r.asset_key;
    DELETE FROM public.cfc_asset_calculations old WHERE old.asset_key=r.asset_key
      AND EXISTS (SELECT 1 FROM public.cfc_asset_calculations n WHERE n.asset_key=new_key);
    UPDATE public.cfc_asset_calculations SET asset_key=new_key WHERE asset_key=r.asset_key;

    INSERT INTO public.cfc_pick_key_migration_018_archive(source_table,old_key,row_data)
      SELECT 'cfc_asset_source_values',r.asset_key,to_jsonb(c) FROM public.cfc_asset_source_values c WHERE c.asset_key=r.asset_key;
    DELETE FROM public.cfc_asset_source_values old WHERE old.asset_key=r.asset_key
      AND EXISTS (SELECT 1 FROM public.cfc_asset_source_values n WHERE n.asset_key=new_key AND n.source_key=old.source_key);
    UPDATE public.cfc_asset_source_values SET asset_key=new_key WHERE asset_key=r.asset_key;

    INSERT INTO public.cfc_pick_key_migration_018_archive(source_table,old_key,row_data)
      SELECT 'cfc_team_manual_value_overrides',r.asset_key,to_jsonb(c) FROM public.cfc_team_manual_value_overrides c WHERE c.asset_key=r.asset_key;
    DELETE FROM public.cfc_team_manual_value_overrides old WHERE old.asset_key=r.asset_key
      AND EXISTS (SELECT 1 FROM public.cfc_team_manual_value_overrides n WHERE n.asset_key=new_key AND n.team_id=old.team_id);
    UPDATE public.cfc_team_manual_value_overrides SET asset_key=new_key WHERE asset_key=r.asset_key;
    DELETE FROM public.cfc_assets WHERE asset_key=r.asset_key;
  END LOOP;

  FOR r IN SELECT ctid,* FROM public.cfc_team_draft_class_strength
    WHERE pick_key ~ '^pick:[0-9]{4}-[0-9]+-(tbd|[0-9]+)-[^-]+$'
  LOOP
    new_key:=public.cfc_durable_pick_key(r.pick_key);
    INSERT INTO public.cfc_pick_key_migration_018_archive VALUES('cfc_team_draft_class_strength',r.pick_key,to_jsonb(r)-'ctid',now());
    IF EXISTS (SELECT 1 FROM public.cfc_team_draft_class_strength n WHERE n.league_id=r.league_id AND n.team_id=r.team_id AND n.pick_key=new_key)
      THEN DELETE FROM public.cfc_team_draft_class_strength WHERE ctid=r.ctid;
      ELSE UPDATE public.cfc_team_draft_class_strength SET pick_key=new_key WHERE ctid=r.ctid; END IF;
  END LOOP;
  FOR r IN SELECT ctid,* FROM public.watchlist
    WHERE asset_key ~ '^pick:[0-9]{4}-[0-9]+-(tbd|[0-9]+)-[^-]+$'
  LOOP
    new_key:=public.cfc_durable_pick_key(r.asset_key);
    INSERT INTO public.cfc_pick_key_migration_018_archive VALUES('watchlist',r.asset_key,to_jsonb(r)-'ctid',now());
    IF EXISTS (SELECT 1 FROM public.watchlist n WHERE n.league_id=r.league_id AND n.team_id=r.team_id AND n.asset_key=new_key)
      THEN DELETE FROM public.watchlist WHERE ctid=r.ctid;
      ELSE UPDATE public.watchlist SET asset_key=new_key WHERE ctid=r.ctid; END IF;
  END LOOP;
  FOR r IN SELECT ctid,* FROM public.cfc_team_player_attachment
    WHERE sleeper_player_id ~ '^pick:[0-9]{4}-[0-9]+-(tbd|[0-9]+)-[^-]+$'
  LOOP
    new_key:=public.cfc_durable_pick_key(r.sleeper_player_id);
    INSERT INTO public.cfc_pick_key_migration_018_archive VALUES('cfc_team_player_attachment',r.sleeper_player_id,to_jsonb(r)-'ctid',now());
    IF EXISTS (SELECT 1 FROM public.cfc_team_player_attachment n WHERE n.league_id=r.league_id AND n.team_id=r.team_id AND n.sleeper_player_id=new_key)
      THEN DELETE FROM public.cfc_team_player_attachment WHERE ctid=r.ctid;
      ELSE UPDATE public.cfc_team_player_attachment SET sleeper_player_id=new_key WHERE ctid=r.ctid; END IF;
  END LOOP;
END $$;

-- Stored offer assets are arrays of objects with a key property.
INSERT INTO public.cfc_pick_key_migration_018_archive(source_table,old_key,row_data)
SELECT 'trade_offers',o.id::text,to_jsonb(o) FROM public.trade_offers o
WHERE o.assets_from::text ~ 'pick:[0-9]{4}-[0-9]+-(tbd|[0-9]+)-[^-]+'
   OR o.assets_to::text ~ 'pick:[0-9]{4}-[0-9]+-(tbd|[0-9]+)-[^-]+';
UPDATE public.trade_offers o SET
 assets_from=(SELECT jsonb_agg(CASE WHEN elem ? 'key' THEN jsonb_set(elem,'{key}',to_jsonb(public.cfc_durable_pick_key(elem->>'key'))) ELSE elem END ORDER BY ord) FROM jsonb_array_elements(o.assets_from) WITH ORDINALITY a(elem,ord)),
 assets_to=(SELECT jsonb_agg(CASE WHEN elem ? 'key' THEN jsonb_set(elem,'{key}',to_jsonb(public.cfc_durable_pick_key(elem->>'key'))) ELSE elem END ORDER BY ord) FROM jsonb_array_elements(o.assets_to) WITH ORDINALITY a(elem,ord))
WHERE o.assets_from::text ~ 'pick:[0-9]{4}-[0-9]+-(tbd|[0-9]+)-[^-]+' OR o.assets_to::text ~ 'pick:[0-9]{4}-[0-9]+-(tbd|[0-9]+)-[^-]+';

REVOKE ALL ON FUNCTION public.cfc_durable_pick_key(text) FROM PUBLIC,anon,authenticated;
GRANT EXECUTE ON FUNCTION public.cfc_durable_pick_key(text) TO service_role;

-- Validation: inspect existence/columns first; absent optional value tables are
-- reported rather than recreated. Offer count must be zero.
SELECT wanted.table_name,columns.column_name,columns.data_type
FROM (VALUES ('cfc_team_player_attachment'),('cfc_asset_calculations'),('cfc_asset_source_values'),
 ('cfc_assets'),('cfc_team_draft_class_strength'),('cfc_team_manual_value_overrides'),
 ('cfc_trade_values_current'),('watchlist'),('trade_offers'),('cfc_pending_trade_overlays')) wanted(table_name)
LEFT JOIN information_schema.columns columns ON columns.table_schema='public' AND columns.table_name=wanted.table_name
ORDER BY wanted.table_name,columns.ordinal_position;
SELECT count(*) offer_old_keys FROM public.trade_offers
WHERE assets_from::text ~ 'pick:[0-9]{4}-[0-9]+-(tbd|[0-9]+)-[^-]+'
   OR assets_to::text ~ 'pick:[0-9]{4}-[0-9]+-(tbd|[0-9]+)-[^-]+';
SELECT source_table,count(*) archived_rows
FROM public.cfc_pick_key_migration_018_archive GROUP BY source_table ORDER BY source_table;
