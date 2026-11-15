-- Aggregate-only evidence. No customer rows, credentials, object paths or SQL
-- definitions leave the database. The runner keeps hashes private, logs booleans.
SELECT jsonb_build_object(
  'users',(SELECT count(*) FROM auth.users),
  'unbannedUsers',(SELECT count(*) FROM auth.users WHERE banned_until IS DISTINCT FROM '9999-12-31T00:00:00Z'::timestamptz),
  'sessions',(SELECT count(*) FROM auth.sessions),
  'refreshTokens',(SELECT count(*) FROM auth.refresh_tokens),
  'activeJobs',(SELECT count(*) FROM cron.job WHERE active),
  'unreviewedJobs',(SELECT count(*) FROM cron.job WHERE active AND
    (schedule IS DISTINCT FROM '0,15,30 13,14 * * 3' OR command IS DISTINCT FROM 'select league_sync.enqueue(true);')),
  'enabledSyncConfigs',(SELECT count(*) FROM league_sync.config WHERE enabled),
  'queuedHttp',(SELECT count(*) FROM net.http_request_queue),
  'customLogins',(SELECT count(*) FROM pg_roles WHERE rolname='llm_reader' AND rolcanlogin),
  'writeEnabledLeagues',(SELECT count(*) FROM public.cfc_league_runtime WHERE writes_enabled),
  'initializedLeagues',(SELECT count(*) FROM public.cfc_league_runtime WHERE initialized_at IS NOT NULL),
  'assets',(SELECT count(*) FROM public.cfc_asset_ownership),
  'slots',(SELECT count(*) FROM public.cfc_draft_slots),
  'trades',(SELECT count(*) FROM public.trade_offers),
  'storageObjects',(SELECT count(*) FROM storage.objects WHERE NOT coalesce(is_delete_marker,false)),
  'storageBuckets',(SELECT count(*) FROM storage.buckets),
  'subscriptions',(SELECT count(*) FROM pg_subscription),
  'foreignServers',(SELECT count(*) FROM pg_foreign_server),
  'networkTriggers',(SELECT count(*) FROM pg_trigger t JOIN pg_proc p ON p.oid=t.tgfoid WHERE NOT t.tgisinternal
    AND p.prosrc~*'(net[.]http|http_post|http_get|https?://|dblink|enqueue|vault)'),
  'invalidForeignKeys',(SELECT count(*) FROM pg_constraint WHERE contype='f' AND NOT convalidated),
  'browserCommandAllowed',has_function_privilege('authenticated','public.cfc_create_trade_offer(text,uuid,uuid,uuid,bigint,jsonb)','EXECUTE'),
  'serviceDirectWriteAllowed',has_table_privilege('service_role','public.cfc_asset_ownership','UPDATE'),
  'schemaDigest',(SELECT md5(string_agg(table_schema||'.'||table_name||'.'||column_name||':'||data_type||':'||is_nullable,E'\n'
    ORDER BY table_schema,table_name,ordinal_position)) FROM information_schema.columns
    WHERE table_schema IN ('public','auth','storage','cfc_runtime_private')),
  'policyDigest',(SELECT md5(string_agg(schemaname||'.'||tablename||'.'||policyname||':'||roles::text||':'||cmd||':'||coalesce(qual,'')||':'||coalesce(with_check,''),E'\n'
    ORDER BY schemaname,tablename,policyname)) FROM pg_policies WHERE schemaname IN ('public','auth','storage','cfc_runtime_private')),
  'functionDigest',(SELECT md5(string_agg(n.nspname||'.'||p.proname||':'||pg_get_function_identity_arguments(p.oid)||':'||
    pg_get_userbyid(p.proowner)||':'||pg_get_functiondef(p.oid)||':'||coalesce(p.proacl::text,''),E'\n'
    ORDER BY n.nspname,p.proname,pg_get_function_identity_arguments(p.oid))) FROM pg_proc p JOIN pg_namespace n ON n.oid=p.pronamespace
    WHERE n.nspname IN ('public','auth','storage','cfc_runtime_private') AND p.prokind IN ('f','p')),
  'rlsDigest',(SELECT md5(string_agg(n.nspname||'.'||c.relname||':'||c.relrowsecurity||':'||c.relforcerowsecurity||':'||
    pg_get_userbyid(c.relowner)||':'||coalesce(c.relacl::text,''),E'\n' ORDER BY n.nspname,c.relname))
    FROM pg_class c JOIN pg_namespace n ON n.oid=c.relnamespace WHERE n.nspname IN ('public','auth','storage','cfc_runtime_private') AND c.relkind IN ('r','p','v','m','S')),
  'constraintDigest',(SELECT md5(string_agg(n.nspname||'.'||c.relname||':'||con.conname||':'||pg_get_constraintdef(con.oid),E'\n'
    ORDER BY n.nspname,c.relname,con.conname)) FROM pg_constraint con JOIN pg_class c ON c.oid=con.conrelid JOIN pg_namespace n ON n.oid=c.relnamespace
    WHERE n.nspname IN ('public','auth','storage','cfc_runtime_private')),
  'migrationDigest',(SELECT md5(string_agg(version||':'||coalesce(statements::text,''),E'\n' ORDER BY version)) FROM supabase_migrations.schema_migrations),
  'assetDigest',(SELECT md5(coalesce(string_agg(md5(to_jsonb(t)::text),'' ORDER BY league_id,asset_key),'')) FROM public.cfc_asset_ownership t),
  'slotDigest',(SELECT md5(coalesce(string_agg(md5(to_jsonb(t)::text),'' ORDER BY league_id,draft_season,pick_index),'')) FROM public.cfc_draft_slots t),
  'tradeDigest',(SELECT md5(coalesce(string_agg(md5(to_jsonb(t)::text),'' ORDER BY id),'')) FROM public.trade_offers t),
  'draftDigest',(SELECT md5(coalesce(string_agg(md5(to_jsonb(t)::text),'' ORDER BY league_id,draft_season,pick_index),'')) FROM public.draft_log t)
) AS evidence;
