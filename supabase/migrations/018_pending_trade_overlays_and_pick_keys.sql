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
DECLARE
  spec record;
  row_record record;
  new_key text;
BEGIN
  -- Each relation/key pair below was confirmed by the 2026-09-12 read-only
  -- production catalog capture. A conflicting canonical row is never deleted:
  -- the retired key remains readable and is reported by validation.
  FOR spec IN SELECT * FROM (VALUES
    ('cfc_team_player_attachment','sleeper_player_id'),
    ('cfc_asset_calculations','asset_key'),
    ('cfc_asset_source_values','asset_key'),
    ('cfc_assets','asset_key'),
    ('cfc_team_draft_class_strength','pick_key'),
    ('cfc_team_manual_value_overrides','asset_key'),
    ('watchlist','asset_key')
  ) AS confirmed(table_name,key_column)
  LOOP
    IF to_regclass('public.' || spec.table_name) IS NULL THEN CONTINUE; END IF;
    FOR row_record IN EXECUTE format(
      'SELECT ctid, %1$I AS old_key, to_jsonb(t) AS row_data FROM public.%2$I t WHERE %1$I ~ $1',
      spec.key_column, spec.table_name
    ) USING '^pick:[0-9]{4}-[0-9]+-(tbd|[0-9]+)-[^-]+$'
    LOOP
      new_key := public.cfc_durable_pick_key(row_record.old_key);
      INSERT INTO public.cfc_pick_key_migration_018_archive(source_table,old_key,row_data)
      VALUES(spec.table_name,row_record.old_key,row_record.row_data);
      EXECUTE format(
        'UPDATE public.%1$I old SET %2$I=$1 WHERE old.ctid=$2 AND NOT EXISTS (SELECT 1 FROM public.%1$I canonical WHERE canonical.%2$I=$1)',
        spec.table_name,spec.key_column
      ) USING new_key,row_record.ctid;
    END LOOP;
  END LOOP;
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
