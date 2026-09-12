-- CI-ONLY clean-database baseline. Never apply to an existing or production DB.
--
-- Provenance (reviewed 2026-09-12): definitions are transcribed from the saved
-- Supabase SQL snippets named "Trade offers and messages tables", "Canonical
-- Value Store and Rebuild Pipeline", and "Fantasy Football Master Schema".
-- The dashboard did not expose creation or execution timestamps, so these are
-- saved source artifacts, not a claim about an executed historical snapshot.
-- Draft/strategy definitions are the verified live catalog shape with changes
-- made by checked-in migrations 005-008/011 removed. No data/reset/drop/seed
-- statements from the saved scripts are included.

CREATE TABLE public.trade_offers (
  id uuid PRIMARY KEY DEFAULT gen_random_uuid(), league_id text NOT NULL,
  from_team_id text NOT NULL, to_team_id text NOT NULL,
  assets_from jsonb NOT NULL, assets_to jsonb NOT NULL,
  from_value int NOT NULL DEFAULT 0, to_value int NOT NULL DEFAULT 0,
  grade_label text NOT NULL DEFAULT 'Fair', status text NOT NULL DEFAULT 'pending',
  parent_offer_id uuid, created_at timestamptz NOT NULL DEFAULT now(),
  updated_at timestamptz NOT NULL DEFAULT now(), read_at timestamptz
);
CREATE INDEX trade_offers_to_team_pending_idx ON public.trade_offers (to_team_id, status);
CREATE INDEX trade_offers_league_idx ON public.trade_offers (league_id);

CREATE TABLE public.trade_messages (
  id uuid PRIMARY KEY DEFAULT gen_random_uuid(), league_id text NOT NULL,
  offer_id uuid REFERENCES public.trade_offers(id) ON DELETE CASCADE,
  from_team_id text NOT NULL, message text NOT NULL,
  created_at timestamptz NOT NULL DEFAULT now()
);
CREATE INDEX trade_messages_offer_idx ON public.trade_messages (offer_id);

CREATE TABLE public.cfc_value_sources (
  source_key text PRIMARY KEY, source_name text NOT NULL,
  source_type text NOT NULL CHECK (source_type IN ('api','spreadsheet','manual')),
  is_enabled boolean NOT NULL DEFAULT true,
  created_at timestamptz NOT NULL DEFAULT now(), updated_at timestamptz NOT NULL DEFAULT now()
);
CREATE TABLE public.cfc_value_settings (
  setting_key text PRIMARY KEY, numeric_value numeric(18,6), text_value text,
  updated_at timestamptz NOT NULL DEFAULT now(),
  CHECK (numeric_value IS NOT NULL OR text_value IS NOT NULL)
);
CREATE TABLE public.cfc_position_multipliers (
  position text PRIMARY KEY, multiplier numeric(10,6) NOT NULL,
  updated_at timestamptz NOT NULL DEFAULT now()
);
CREATE TABLE public.cfc_assets (
  asset_id uuid PRIMARY KEY DEFAULT gen_random_uuid(), asset_key text NOT NULL UNIQUE,
  asset_type text NOT NULL CHECK (asset_type IN ('player','pick_template','pick')),
  display_name text NOT NULL, sleeper_player_id text, position text, birth_date date,
  age_override integer, pick_round integer, pick_number integer,
  is_active boolean NOT NULL DEFAULT true, manual_override_value numeric(18,6),
  manual_override_reason text, created_at timestamptz NOT NULL DEFAULT now(),
  updated_at timestamptz NOT NULL DEFAULT now()
);
CREATE TABLE public.cfc_value_upload_staging (
  staging_id bigint GENERATED ALWAYS AS IDENTITY PRIMARY KEY,
  import_batch text NOT NULL, source_key text NOT NULL REFERENCES public.cfc_value_sources(source_key),
  asset_key text NOT NULL, asset_type text NOT NULL CHECK (asset_type IN ('player','pick_template','pick')),
  display_name text NOT NULL, sleeper_player_id text, position text, birth_date date,
  age_override integer, pick_round integer, pick_number integer, raw_value numeric(18,6),
  source_101_value numeric(18,6), multiple_101 numeric(18,6), source_updated_at timestamptz,
  created_at timestamptz NOT NULL DEFAULT now()
);
CREATE TABLE public.cfc_asset_source_values (
  id bigint GENERATED ALWAYS AS IDENTITY PRIMARY KEY,
  asset_key text NOT NULL REFERENCES public.cfc_assets(asset_key) ON DELETE CASCADE,
  source_key text NOT NULL REFERENCES public.cfc_value_sources(source_key),
  raw_value numeric(18,6), source_101_value numeric(18,6), multiple_101 numeric(18,6),
  import_batch text, source_updated_at timestamptz,
  created_at timestamptz NOT NULL DEFAULT now(), updated_at timestamptz NOT NULL DEFAULT now(),
  CONSTRAINT cfc_asset_source_values_unique UNIQUE (asset_key, source_key)
);
CREATE TABLE public.cfc_asset_calculations (
  asset_key text PRIMARY KEY REFERENCES public.cfc_assets(asset_key) ON DELETE CASCADE,
  source_count integer NOT NULL DEFAULT 0, composite_101_multiple numeric(18,6),
  composite_value numeric(18,6), elite_multiplier_applied numeric(18,6),
  position_multiplier_applied numeric(18,6), computed_cfc_value numeric(18,6),
  final_cfc_value numeric(18,6), rebuilt_at timestamptz NOT NULL DEFAULT now()
);
CREATE INDEX cfc_assets_asset_type_idx ON public.cfc_assets(asset_type);
CREATE INDEX cfc_assets_sleeper_player_id_idx ON public.cfc_assets(sleeper_player_id);
CREATE INDEX cfc_assets_position_idx ON public.cfc_assets(position);
CREATE INDEX cfc_value_upload_staging_batch_idx ON public.cfc_value_upload_staging(import_batch);
CREATE INDEX cfc_value_upload_staging_asset_idx ON public.cfc_value_upload_staging(asset_key, source_key);
CREATE INDEX cfc_asset_source_values_asset_idx ON public.cfc_asset_source_values(asset_key);
CREATE INDEX cfc_asset_source_values_source_idx ON public.cfc_asset_source_values(source_key);

CREATE OR REPLACE FUNCTION public.cfc_rebuild_value_layers() RETURNS void
LANGUAGE plpgsql SET search_path = public AS $$
DECLARE v_base numeric(18,6); v_elite numeric(18,6); v_elite_multiplier numeric(18,6);
BEGIN
  SELECT numeric_value INTO v_base FROM public.cfc_value_settings WHERE setting_key='league_101_value';
  SELECT numeric_value INTO v_elite FROM public.cfc_value_settings WHERE setting_key='elite_threshold';
  SELECT numeric_value INTO v_elite_multiplier FROM public.cfc_value_settings WHERE setting_key='elite_multiplier';
  DELETE FROM public.cfc_asset_calculations WHERE asset_key IS NOT NULL;
  INSERT INTO public.cfc_asset_calculations (
    asset_key, source_count, composite_101_multiple, composite_value,
    elite_multiplier_applied, position_multiplier_applied, computed_cfc_value,
    final_cfc_value, rebuilt_at
  )
  WITH enabled AS (
    SELECT sv.asset_key, sv.multiple_101 FROM public.cfc_asset_source_values sv
    JOIN public.cfc_value_sources s USING (source_key)
    WHERE s.is_enabled AND sv.multiple_101 IS NOT NULL
  ), medians AS (
    SELECT asset_key, count(*) source_count,
      percentile_cont(0.5) WITHIN GROUP (ORDER BY multiple_101)::numeric(18,6) multiple
    FROM enabled GROUP BY asset_key
  )
  SELECT a.asset_key, coalesce(m.source_count,0), m.multiple,
    round((m.multiple*v_base)::numeric,6),
    CASE WHEN a.asset_type='player' AND m.multiple*v_base>v_elite THEN v_elite_multiplier ELSE 1 END,
    CASE WHEN a.asset_type='player' THEN coalesce(pm.multiplier,1) ELSE 1 END,
    round((m.multiple*v_base*
      CASE WHEN a.asset_type='player' AND m.multiple*v_base>v_elite THEN v_elite_multiplier ELSE 1 END*
      CASE WHEN a.asset_type='player' THEN coalesce(pm.multiplier,1) ELSE 1 END)::numeric,6),
    round(coalesce(a.manual_override_value,m.multiple*v_base*
      CASE WHEN a.asset_type='player' AND m.multiple*v_base>v_elite THEN v_elite_multiplier ELSE 1 END*
      CASE WHEN a.asset_type='player' THEN coalesce(pm.multiplier,1) ELSE 1 END)::numeric,6), now()
  FROM public.cfc_assets a LEFT JOIN medians m USING (asset_key)
  LEFT JOIN public.cfc_position_multipliers pm ON pm.position=a.position WHERE a.is_active;
END $$;

CREATE VIEW public.cfc_trade_values_current AS SELECT
  a.asset_id,a.asset_key,a.asset_type,a.display_name,a.sleeper_player_id,a.position,
  a.birth_date,a.age_override,a.pick_round,a.pick_number,c.source_count,
  c.composite_101_multiple,c.composite_value,c.elite_multiplier_applied,
  c.position_multiplier_applied,c.computed_cfc_value,c.final_cfc_value AS cfc_value,
  a.manual_override_value,a.manual_override_reason,c.rebuilt_at
FROM public.cfc_assets a LEFT JOIN public.cfc_asset_calculations c USING (asset_key)
WHERE a.is_active;

CREATE TABLE public.ff_master_franchises (
  franchise_id uuid PRIMARY KEY DEFAULT gen_random_uuid(), canonical_franchise_name text NOT NULL,
  franchise_code text UNIQUE, active_flag boolean NOT NULL DEFAULT true, notes text,
  created_at timestamptz NOT NULL DEFAULT now(), updated_at timestamptz NOT NULL DEFAULT now()
);
CREATE TABLE public.ff_master_players (
  player_id uuid PRIMARY KEY DEFAULT gen_random_uuid(), canonical_player_name text NOT NULL,
  first_name text,last_name text,normalized_name text,primary_position text,nfl_team text,
  birth_date date,rookie_year int,active_status text,metadata_json jsonb NOT NULL DEFAULT '{}',
  created_at timestamptz NOT NULL DEFAULT now(),updated_at timestamptz NOT NULL DEFAULT now()
);
CREATE TABLE public.ff_master_draft_picks (
  draft_pick_id uuid PRIMARY KEY DEFAULT gen_random_uuid(),draft_year int NOT NULL,round int NOT NULL,
  pick_number int,original_franchise_id uuid NOT NULL REFERENCES public.ff_master_franchises(franchise_id) ON DELETE RESTRICT,
  current_franchise_id uuid REFERENCES public.ff_master_franchises(franchise_id) ON DELETE RESTRICT,
  selected_by_franchise_id uuid REFERENCES public.ff_master_franchises(franchise_id) ON DELETE RESTRICT,
  selected_player_id uuid REFERENCES public.ff_master_players(player_id) ON DELETE RESTRICT,
  source_platform text,metadata_json jsonb NOT NULL DEFAULT '{}',created_at timestamptz NOT NULL DEFAULT now(),
  CONSTRAINT uq_ff_master_draft_picks UNIQUE(draft_year,round,original_franchise_id)
);
CREATE TABLE public.ff_source_franchise_map (
  source_franchise_map_id uuid PRIMARY KEY DEFAULT gen_random_uuid(),platform text NOT NULL,
  source_league_id text NOT NULL,season_year int NOT NULL,source_team_id text,source_roster_id text,
  source_owner_id text,franchise_id uuid NOT NULL REFERENCES public.ff_master_franchises(franchise_id) ON DELETE CASCADE,
  confidence_score numeric(5,2),mapping_method text,notes text,created_at timestamptz NOT NULL DEFAULT now()
);
CREATE TABLE public.ff_source_player_map (
  source_player_map_id uuid PRIMARY KEY DEFAULT gen_random_uuid(),platform text NOT NULL,
  source_player_id text NOT NULL,source_player_name text,
  player_id uuid NOT NULL REFERENCES public.ff_master_players(player_id) ON DELETE CASCADE,
  confidence_score numeric(5,2),mapping_method text,notes text,created_at timestamptz NOT NULL DEFAULT now()
);
CREATE UNIQUE INDEX uq_ff_source_franchise_map_source_keys ON public.ff_source_franchise_map
  (platform,source_league_id,season_year,coalesce(source_team_id,''),coalesce(source_roster_id,''));
CREATE UNIQUE INDEX uq_ff_source_player_map_source_player ON public.ff_source_player_map(platform,source_player_id);

-- Verified current catalog reversed through checked-in migrations 005-008.
CREATE TABLE public.draft_log (
  pick_index integer PRIMARY KEY,pick_number text,team_count integer DEFAULT 0,team_name text,
  roster_id text,player_id text,player_name text,positions jsonb DEFAULT '[]',nfl_team text
);
CREATE TABLE public.draft_state (
  league_id text PRIMARY KEY,status text NOT NULL DEFAULT 'not_started',
  seconds_remaining numeric NOT NULL DEFAULT 1800,clock_started_at timestamptz
);

-- Verified current catalog with only columns introduced by migration 011 removed.
CREATE OR REPLACE FUNCTION public.cfc_set_updated_at() RETURNS trigger LANGUAGE plpgsql
SET search_path = public AS $$ BEGIN NEW.updated_at=now(); RETURN NEW; END $$;
CREATE TABLE public.cfc_team_strategy_profiles (
  league_id text NOT NULL,team_id text NOT NULL,wants_more text[] NOT NULL DEFAULT '{}',
  qb_market text NOT NULL DEFAULT 'hold',rb_market text NOT NULL DEFAULT 'hold',
  picks_market text NOT NULL DEFAULT 'hold',own_guys_preference text NOT NULL DEFAULT 'neutral',
  created_at timestamptz NOT NULL DEFAULT now(),updated_at timestamptz NOT NULL DEFAULT now(),
  gm_persona text NOT NULL DEFAULT 'straight_shooter',pc_market text NOT NULL DEFAULT 'hold',
  picks_sell_move text[] NOT NULL DEFAULT '{}', PRIMARY KEY(league_id,team_id)
);
