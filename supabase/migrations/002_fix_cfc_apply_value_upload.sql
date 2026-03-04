-- Migration: Fix cfc_apply_value_upload to remove unfiltered DELETE statements
--
-- Root cause: the previous version of this function contained a
-- `DELETE FROM public."trade values raw upload"` with no WHERE clause.
-- PostgREST rejects unfiltered DELETE requests with "DELETE requires a WHERE
-- clause" when the function is called via client.rpc(). The function appeared
-- to work when invoked directly in the Supabase SQL editor because that context
-- uses the postgres superuser role, which bypasses the restriction. The service
-- role used by the JS client does not.
--
-- Fix summary:
--   1. Removed DELETE from "trade values raw upload" entirely (not needed here).
--   2. Replaced unfiltered DELETEs on canonical tables with per-batch filtered
--      DELETEs or UPSERT (INSERT … ON CONFLICT DO UPDATE).
--   3. All remaining DELETEs are filtered by import_batch = p_batch.
--   4. Added unique constraint on cfc_value_upload_staging so the import route
--      can use UPSERT instead of DELETE + INSERT, avoiding staging deletes.
--
-- NOTE: Column names below match the staging table written by the import route.
--       If your cfc_assets / cfc_asset_source_values / cfc_asset_calculations /
--       cfc_trade_values_current tables use different column names, adjust the
--       INSERT/UPSERT blocks accordingly before running this migration.

-- ── Add unique constraint to staging table (idempotent) ──────────────────────
DO $$
BEGIN
  IF NOT EXISTS (
    SELECT 1 FROM pg_constraint
    WHERE conname = 'cfc_value_upload_staging_batch_asset_source_key'
  ) THEN
    ALTER TABLE public.cfc_value_upload_staging
      ADD CONSTRAINT cfc_value_upload_staging_batch_asset_source_key
      UNIQUE (import_batch, asset_key, source_key);
  END IF;
END
$$;

CREATE OR REPLACE FUNCTION public.cfc_apply_value_upload(p_batch TEXT)
  RETURNS void
  LANGUAGE plpgsql
  SECURITY DEFINER
  SET search_path = public
AS $$
BEGIN
  -- ── 1. Upsert player assets ────────────────────────────────────────────
  -- Uses DISTINCT ON to pick one representative row per asset_key.
  -- Prefers rows where position and birth_date are not null.
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
    position          = COALESCE(EXCLUDED.position, cfc_assets.position),
    birth_date        = COALESCE(EXCLUDED.birth_date, cfc_assets.birth_date),
    updated_at        = NOW();

  -- ── 2. Replace source values for this batch ───────────────────────────
  -- Filtered DELETE (only removes rows for p_batch) then re-insert.
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

  -- ── 3. Recalculate per-asset aggregates ───────────────────────────────
  -- Upsert so that re-running the same batch is idempotent.
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

  -- ── 4. Rebuild current trade values ──────────────────────────────────
  -- NOTE: the column is cfc_value, not trade_value.  If you see a
  -- "column trade_value does not exist" error, run migration 003 instead.
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
  -- It is a read-only source for the import pipeline and must not be deleted.
END;
$$;
