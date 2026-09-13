BEGIN TRANSACTION READ ONLY;
SELECT table_name,column_name,data_type,is_nullable,column_default,is_identity,identity_generation,is_generated,generation_expression
FROM information_schema.columns
WHERE table_schema='public' AND table_name IN ('cfc_assets','cfc_trade_values_current')
ORDER BY table_name,ordinal_position;
SELECT c.relname,con.conname,con.contype,pg_get_constraintdef(con.oid,true) definition
FROM pg_constraint con JOIN pg_class c ON c.oid=con.conrelid JOIN pg_namespace n ON n.oid=c.relnamespace
WHERE n.nspname='public' AND c.relname='cfc_assets' ORDER BY con.conname;
SELECT tablename,indexname,indexdef FROM pg_indexes
WHERE schemaname='public' AND tablename='cfc_assets' ORDER BY indexname;
SELECT pg_get_viewdef('public.cfc_trade_values_current'::regclass,true) view_definition;
SELECT asset_key,display_name,cfc_value
FROM public.cfc_trade_values_current
WHERE asset_type='pick_template'
ORDER BY split_part(display_name,'.',1)::integer,split_part(display_name,'.',2)::integer;
ROLLBACK;
