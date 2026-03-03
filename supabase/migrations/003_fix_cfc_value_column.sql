-- Migration 003: Fix cfc_apply_value_upload to use the correct column name.
--
-- Root cause of the regression introduced by migration 002:
--   Step 4 of cfc_apply_value_upload used the column name "trade_value" but the
--   production cfc_trade_values_current table stores the column as "cfc_value".
--   Because the entire function runs in a single PL/pgSQL transaction, the
--   "column trade_value does not exist" error in step 4 caused a full rollback
--   of all four steps, meaning nothing ever reached cfc_assets or
--   cfc_trade_values_current even though staging rows were committed beforehand
--   by the calling JavaScript code.
--
-- Additionally, the function omitted sleeper_player_id from the
--   cfc_trade_values_current INSERT, so newly backfilled players could not be
--   looked up by sleeper_player_id.
--
-- This migration:
--   1. Ensures cfc_trade_values_current has a sleeper_player_id column.
--   2. Adds UNIQUE constraints required for ON CONFLICT if they do not exist.
--   3. Recreates cfc_apply_value_upload with the correct column name "cfc_value"
--      and populates sleeper_player_id from the staging rows.

-- ── 0. Ensure required columns and constraints exist ─────────────────────────

ALTER TABLE public.cfc_trade_values_current
  ADD COLUMN IF NOT EXISTS sleeper_player_id TEXT;

-- Unique constraint on cfc_trade_values_current.asset_key (needed for ON CONFLICT)
DO $$
BEGIN
  IF NOT EXISTS (
    SELECT 1 FROM pg_constraint
    WHERE conname = 'cfc_trade_values_current_asset_key_key'
      AND conrelid = 'public.cfc_trade_values_current'::regclass
  ) THEN
    ALTER TABLE public.cfc_trade_values_current
      ADD CONSTRAINT cfc_trade_values_current_asset_key_key UNIQUE (asset_key);
  END IF;
END
$$;

-- Unique constraint on cfc_asset_calculations.asset_key (needed for ON CONFLICT)
DO $$
BEGIN
  IF NOT EXISTS (
    SELECT 1 FROM pg_constraint
    WHERE conname = 'cfc_asset_calculations_asset_key_key'
      AND conrelid = 'public.cfc_asset_calculations'::regclass
  ) THEN
    ALTER TABLE public.cfc_asset_calculations
      ADD CONSTRAINT cfc_asset_calculations_asset_key_key UNIQUE (asset_key);
  END IF;
END
$$;

-- ── 1. Recreate the function with correct column names ────────────────────────

CREATE OR REPLACE FUNCTION public.cfc_apply_value_upload(p_batch TEXT)
  RETURNS void
  LANGUAGE plpgsql
  SECURITY DEFINER
  SET search_path = public
AS $$
BEGIN
  -- ── Step 1. Upsert player assets ─────────────────────────────────────────
  INSERT INTO cfc_assets (
    asset_key,
    asset_type,
    display_name,
    sleeper_player_id,
    position,
    birth_date,
    updated_at
  )
  SELECT DISTINCT ON (asset_key)
    asset_key,
    asset_type,
    display_name,
    sleeper_player_id,
    position,
    birth_date,
    NOW()
  FROM cfc_value_upload_staging
  WHERE import_batch = p_batch
  ORDER BY asset_key,
           (position IS NOT NULL) DESC,
           (birth_date IS NOT NULL) DESC
  ON CONFLICT (asset_key) DO UPDATE SET
    display_name      = EXCLUDED.display_name,
    sleeper_player_id = COALESCE(EXCLUDED.sleeper_player_id, cfc_assets.sleeper_player_id),
    position          = COALESCE(EXCLUDED.position, cfc_assets.position),
    birth_date        = COALESCE(EXCLUDED.birth_date, cfc_assets.birth_date),
    updated_at        = NOW();

  -- ── Step 2. Replace source values for this batch ──────────────────────────
  DELETE FROM cfc_asset_source_values
  WHERE import_batch = p_batch;

  INSERT INTO cfc_asset_source_values (
    import_batch,
    asset_key,
    source_key,
    raw_value,
    source_101_value,
    multiple_101
  )
  SELECT
    import_batch,
    asset_key,
    source_key,
    raw_value,
    source_101_value,
    multiple_101
  FROM cfc_value_upload_staging
  WHERE import_batch = p_batch;

  -- ── Step 3. Recalculate per-asset aggregates ──────────────────────────────
  INSERT INTO cfc_asset_calculations (
    asset_key,
    import_batch,
    avg_multiple_101,
    source_count,
    updated_at
  )
  SELECT
    asset_key,
    p_batch,
    AVG(multiple_101),
    COUNT(*),
    NOW()
  FROM cfc_value_upload_staging
  WHERE import_batch = p_batch
  GROUP BY asset_key
  ON CONFLICT (asset_key) DO UPDATE SET
    import_batch      = EXCLUDED.import_batch,
    avg_multiple_101  = EXCLUDED.avg_multiple_101,
    source_count      = EXCLUDED.source_count,
    updated_at        = NOW();

  -- ── Step 4. Rebuild current trade values ──────────────────────────────────
  -- Uses cfc_value (the correct column name in cfc_trade_values_current).
  -- Derives sleeper_player_id via a single JOIN on the staging table.
  INSERT INTO cfc_trade_values_current (
    asset_key,
    sleeper_player_id,
    cfc_value,
    import_batch,
    updated_at
  )
  SELECT
    c.asset_key,
    sid.sleeper_player_id,
    ROUND(c.avg_multiple_101 * 1000)::INTEGER,
    p_batch,
    NOW()
  FROM cfc_asset_calculations c
  LEFT JOIN LATERAL (
    SELECT s.sleeper_player_id
    FROM cfc_value_upload_staging s
    WHERE s.import_batch = p_batch
      AND s.asset_key    = c.asset_key
    LIMIT 1
  ) sid ON TRUE
  WHERE c.import_batch = p_batch
  ON CONFLICT (asset_key) DO UPDATE SET
    sleeper_player_id = COALESCE(EXCLUDED.sleeper_player_id, cfc_trade_values_current.sleeper_player_id),
    cfc_value         = EXCLUDED.cfc_value,
    import_batch      = EXCLUDED.import_batch,
    updated_at        = NOW();

  -- "trade values raw upload" is intentionally NOT touched here.
END;
$$;
