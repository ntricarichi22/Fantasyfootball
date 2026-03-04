-- Migration 008: schema introspection helper for schema-safe ingest payloads
--
-- This function is called once per table per ingest request to obtain the list
-- of columns that actually exist in the deployed Supabase schema.  The ingest
-- pipeline (sleeperIngest.ts) uses the result to strip any key from an upsert
-- payload that does not have a matching column, preventing failures whenever
-- the code and the deployed schema temporarily drift apart.
--
-- SECURITY DEFINER is required because PostgREST does not expose
-- information_schema in its default schema search path.  Running the function
-- as the owner (postgres/supabase_admin) lets it read column metadata even
-- when called by a service-role client.  The function itself only reads
-- read-only column metadata for the public schema — no sensitive data is
-- exposed.

CREATE OR REPLACE FUNCTION slp_get_table_columns(p_table text)
RETURNS text[]
LANGUAGE sql
STABLE
SECURITY DEFINER
AS $$
  SELECT coalesce(
    array_agg(column_name::text ORDER BY ordinal_position),
    ARRAY[]::text[]
  )
  FROM information_schema.columns
  WHERE table_schema = 'public'
    AND table_name   = p_table;
$$;
