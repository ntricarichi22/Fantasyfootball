-- Follow-up validation for the canonical saved value-store shape. Migration 002
-- now writes source values and invokes the canonical rebuild rather than trying
-- to INSERT into cfc_trade_values_current, which is a view.
DO $$
BEGIN
  IF NOT EXISTS (
    SELECT 1 FROM pg_class c JOIN pg_namespace n ON n.oid=c.relnamespace
    WHERE n.nspname='public' AND c.relname='cfc_trade_values_current' AND c.relkind='v'
  ) THEN RAISE EXCEPTION 'cfc_trade_values_current must be the reviewed view'; END IF;
  IF NOT EXISTS (
    SELECT 1 FROM information_schema.columns WHERE table_schema='public'
      AND table_name='cfc_asset_calculations' AND column_name='final_cfc_value'
  ) THEN RAISE EXCEPTION 'canonical cfc_asset_calculations shape is missing'; END IF;
END $$;
