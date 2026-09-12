BEGIN TRANSACTION READ ONLY;
SELECT table_name,column_name,data_type,is_nullable,column_default
FROM information_schema.columns
WHERE table_schema='public' AND table_name IN ('cfc_assets','cfc_trade_values_current')
ORDER BY table_name,ordinal_position;
SELECT asset_key,display_name,cfc_value
FROM public.cfc_trade_values_current
WHERE asset_type='pick_template'
ORDER BY split_part(display_name,'.',1)::integer,split_part(display_name,'.',2)::integer;
ROLLBACK;
