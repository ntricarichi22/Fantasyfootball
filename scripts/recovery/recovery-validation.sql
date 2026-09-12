-- Privacy-safe, read-only manifest. It emits no application rows, emails, object
-- names, tokens, or other private records. Run with ON_ERROR_STOP and read-only.
BEGIN TRANSACTION READ ONLY;

SELECT 'postgres_version', current_setting('server_version');

SELECT 'extension', extname, extversion
FROM pg_extension
ORDER BY extname;

SELECT 'relation', n.nspname, c.relkind, count(*)
FROM pg_class c
JOIN pg_namespace n ON n.oid = c.relnamespace
WHERE n.nspname IN ('public', 'auth', 'storage')
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
WHERE n.nspname IN ('public', 'auth', 'storage')
  AND c.relkind IN ('r', 'p', 'v', 'm')
  AND a.attnum > 0 AND NOT a.attisdropped
GROUP BY n.nspname
ORDER BY n.nspname;

SELECT 'constraint-signature', n.nspname,
       md5(string_agg(c.relname || ':' || con.contype || ':' || pg_get_constraintdef(con.oid),
           E'\n' ORDER BY c.relname, con.conname))
FROM pg_constraint con
JOIN pg_class c ON c.oid = con.conrelid
JOIN pg_namespace n ON n.oid = c.relnamespace
WHERE n.nspname IN ('public', 'auth', 'storage')
GROUP BY n.nspname
ORDER BY n.nspname;

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
