-- Privacy-safe, read-only manifest. It emits no application rows, emails, object
-- names, tokens, or other private records. Run with ON_ERROR_STOP and read-only.
BEGIN TRANSACTION READ ONLY;
SET LOCAL statement_timeout='60s';
SET LOCAL lock_timeout='5s';

SELECT 'postgres_version', current_setting('server_version');

SELECT 'extension', extname, extversion
FROM pg_extension
ORDER BY extname;

SELECT 'relation', n.nspname, c.relkind, count(*)
FROM pg_class c
JOIN pg_namespace n ON n.oid = c.relnamespace
WHERE n.nspname IN ('public', 'auth', 'storage', 'cfc_runtime_private')
  AND c.relkind IN ('r', 'p', 'v', 'm', 'S')
GROUP BY n.nspname, c.relkind
ORDER BY n.nspname, c.relkind;

SELECT 'column-signature', n.nspname,
       md5(string_agg(c.relname || ':' || a.attname || ':' ||
           pg_catalog.format_type(a.atttypid, a.atttypmod) || ':' || a.attnotnull,
           E'\n' ORDER BY c.relname, a.attnum))
FROM pg_attribute a
JOIN pg_class c ON c.oid = a.attrelid
JOIN pg_namespace n ON n.oid = c.relnamespace
WHERE n.nspname IN ('public', 'auth', 'storage', 'cfc_runtime_private')
  AND c.relkind IN ('r', 'p', 'v', 'm')
  AND a.attnum > 0 AND NOT a.attisdropped
GROUP BY n.nspname
ORDER BY n.nspname;

SELECT 'constraint-signature', n.nspname,
       md5(string_agg(c.relname || ':' || con.contype::text || ':' || pg_get_constraintdef(con.oid),
           E'\n' ORDER BY c.relname, con.conname))
FROM pg_constraint con
JOIN pg_class c ON c.oid = con.conrelid
JOIN pg_namespace n ON n.oid = c.relnamespace
WHERE n.nspname IN ('public', 'auth', 'storage', 'cfc_runtime_private')
GROUP BY n.nspname
ORDER BY n.nspname;

-- Hash security definitions without exposing their source or any application rows.
-- GRANT replay can reorder ACL storage without changing privileges. Compare every
-- effective grant by role name/privilege/grant option, including default ACLs.
-- Separate hashes identify owner, privilege or definition drift without source text.
SELECT 'function-signature', n.nspname,
       md5(string_agg(pg_get_function_identity_arguments(p.oid) || ':' || p.proname || ':' ||
           pg_get_userbyid(p.proowner), E'\n' ORDER BY p.proname, pg_get_function_identity_arguments(p.oid))) AS owners,
       md5(string_agg(pg_get_function_identity_arguments(p.oid) || ':' || p.proname || ':' ||
           acl.canonical, E'\n' ORDER BY p.proname, pg_get_function_identity_arguments(p.oid))) AS privileges,
       md5(string_agg(pg_get_function_identity_arguments(p.oid) || ':' || p.proname || ':' ||
           pg_get_functiondef(p.oid), E'\n' ORDER BY p.proname, pg_get_function_identity_arguments(p.oid))) AS definitions
FROM pg_proc p JOIN pg_namespace n ON n.oid=p.pronamespace
LEFT JOIN LATERAL (
  SELECT coalesce(jsonb_agg(jsonb_build_array(pg_get_userbyid(a.grantor),
      CASE WHEN a.grantee=0 THEN 'PUBLIC' ELSE pg_get_userbyid(a.grantee) END,
      a.privilege_type,a.is_grantable)
    ORDER BY pg_get_userbyid(a.grantor),
      CASE WHEN a.grantee=0 THEN 'PUBLIC' ELSE pg_get_userbyid(a.grantee) END,
      a.privilege_type,a.is_grantable)::text,'[]') canonical
  FROM aclexplode(coalesce(p.proacl,acldefault('f',p.proowner))) a
) acl ON true
WHERE n.nspname IN ('public','auth','storage','cfc_runtime_private') AND p.prokind IN ('f','p')
GROUP BY n.nspname ORDER BY n.nspname;

SELECT 'rls-signature', n.nspname,
       md5(string_agg(c.relname || ':' || c.relrowsecurity || ':' || c.relforcerowsecurity,
           E'\n' ORDER BY c.relname))
FROM pg_class c JOIN pg_namespace n ON n.oid=c.relnamespace
WHERE n.nspname IN ('public','auth','storage','cfc_runtime_private') AND c.relkind IN ('r','p')
GROUP BY n.nspname ORDER BY n.nspname;

SELECT 'policy-signature', schemaname,
       md5(string_agg(tablename || ':' || policyname || ':' || permissive || ':' || roles::text || ':' || cmd || ':' ||
           coalesce(qual,'') || ':' || coalesce(with_check,''), E'\n' ORDER BY tablename,policyname))
FROM pg_policies WHERE schemaname IN ('public','auth','storage','cfc_runtime_private')
GROUP BY schemaname ORDER BY schemaname;

SELECT 'table-grants-signature', table_schema,
       md5(string_agg(table_name || ':' || grantee || ':' || privilege_type || ':' || is_grantable,
           E'\n' ORDER BY table_name,grantee,privilege_type))
FROM information_schema.table_privileges
WHERE table_schema IN ('public','auth','storage','cfc_runtime_private')
GROUP BY table_schema ORDER BY table_schema;

-- Build one aggregate count per schema. psql's \gexec executes only generated
-- SELECT statements; identifiers are quoted and no table-level count is shown.
SELECT string_agg(
  format('SELECT %L, %L, sum(n) FROM (%s) counts;',
    'exact-rows', schema_name,
    (SELECT string_agg(format('SELECT count(*)::bigint AS n FROM %I.%I',
                              n.nspname, c.relname), ' UNION ALL ' ORDER BY c.relname)
     FROM pg_class c
     JOIN pg_namespace n ON n.oid = c.relnamespace
     WHERE n.nspname = schema_name AND c.relkind = 'r')),
  E'\n' ORDER BY schema_name)
FROM unnest(ARRAY['auth', 'public', 'storage']) AS schemas(schema_name)
WHERE EXISTS (
  SELECT 1 FROM pg_class c JOIN pg_namespace n ON n.oid = c.relnamespace
  WHERE n.nspname = schema_name AND c.relkind = 'r'
) \gexec

SELECT 'invalid-foreign-keys', count(*)
FROM pg_constraint
WHERE contype = 'f' AND NOT convalidated;

COMMIT;
