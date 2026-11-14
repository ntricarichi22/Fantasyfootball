-- Audited against owkxkpkdffhcordlxqte on 2026-11-14. Rerunnable.
-- Restrict the model's database credential to the nine confirmed history tables.
-- No table data, warehouse definitions, or API/service-role grants are changed.
SELECT table_schema, table_name, column_name, data_type
FROM information_schema.columns
WHERE table_schema = 'public' AND table_name IN (
  'llm_franchises', 'llm_players', 'llm_seasons', 'llm_season_weeks',
  'llm_season_records', 'llm_team_games', 'llm_player_games',
  'llm_draft_picks', 'llm_transactions'
)
ORDER BY table_name, ordinal_position;

BEGIN;
SET LOCAL lock_timeout = '5s';
SET LOCAL statement_timeout = '30s';

DO $preflight$
DECLARE relation_name text;
BEGIN
  IF NOT EXISTS (SELECT 1 FROM pg_roles WHERE rolname = 'llm_reader'
    AND NOT rolsuper AND NOT rolcreatedb AND NOT rolcreaterole AND NOT rolbypassrls) THEN
    RAISE EXCEPTION 'Expected a nonprivileged existing llm_reader role';
  END IF;
  FOREACH relation_name IN ARRAY ARRAY[
    'llm_franchises', 'llm_players', 'llm_seasons', 'llm_season_weeks',
    'llm_season_records', 'llm_team_games', 'llm_player_games',
    'llm_draft_picks', 'llm_transactions'
  ] LOOP
    IF NOT EXISTS (SELECT 1 FROM pg_class c JOIN pg_namespace n ON n.oid = c.relnamespace
      WHERE n.nspname = 'public' AND c.relname = relation_name AND c.relkind = 'r') THEN
      RAISE EXCEPTION 'Confirmed history table is missing: %', relation_name;
    END IF;
  END LOOP;
END $preflight$;

REVOKE ALL ON ALL TABLES IN SCHEMA public FROM llm_reader;
REVOKE ALL ON ALL SEQUENCES IN SCHEMA public FROM llm_reader;
REVOKE ALL ON ALL FUNCTIONS IN SCHEMA public FROM llm_reader;
GRANT USAGE ON SCHEMA public TO llm_reader;
GRANT SELECT ON TABLE
  public.llm_franchises, public.llm_players, public.llm_seasons,
  public.llm_season_weeks, public.llm_season_records, public.llm_team_games,
  public.llm_player_games, public.llm_draft_picks, public.llm_transactions
TO llm_reader;

ALTER ROLE llm_reader SET search_path = pg_catalog, public;
ALTER ROLE llm_reader SET default_transaction_read_only = on;
ALTER ROLE llm_reader SET statement_timeout = '5s';
ALTER ROLE llm_reader SET lock_timeout = '1s';
ALTER ROLE llm_reader SET idle_in_transaction_session_timeout = '10s';

-- All twelve existing mutable-path routines were inspected: they are invoker
-- functions using only pg_catalog and public. Put pg_temp last to prevent
-- temporary objects from shadowing application relations.
ALTER FUNCTION public.cfc_big_board_touch_updated_at() SET search_path = pg_catalog, public, pg_temp;
ALTER FUNCTION public.cfc_get_player_age_bucket(text, date, integer) SET search_path = pg_catalog, public, pg_temp;
ALTER FUNCTION public.cfc_get_player_age_bucket(text, date, integer, integer) SET search_path = pg_catalog, public, pg_temp;
ALTER FUNCTION public.cfc_rebuild_value_layers() SET search_path = pg_catalog, public, pg_temp;
ALTER FUNCTION public.cfc_set_updated_at() SET search_path = pg_catalog, public, pg_temp;
ALTER FUNCTION public.ff_epoch_millis_to_timestamptz(text) SET search_path = pg_catalog, public, pg_temp;
ALTER FUNCTION public.ff_jsonb_force_array(jsonb) SET search_path = pg_catalog, public, pg_temp;
ALTER FUNCTION public.ff_try_bigint(text) SET search_path = pg_catalog, public, pg_temp;
ALTER FUNCTION public.ff_try_bool_text(text) SET search_path = pg_catalog, public, pg_temp;
ALTER FUNCTION public.ff_try_int(text) SET search_path = pg_catalog, public, pg_temp;
ALTER FUNCTION public.ff_try_numeric(text) SET search_path = pg_catalog, public, pg_temp;
ALTER FUNCTION public.set_updated_at() SET search_path = pg_catalog, public, pg_temp;

DO $validate$
DECLARE unexpected integer; readable integer;
BEGIN
  SELECT count(*) INTO unexpected
  FROM pg_class c JOIN pg_namespace n ON n.oid = c.relnamespace
  WHERE n.nspname = 'public' AND c.relkind IN ('r','p','v','m')
    AND (has_table_privilege('llm_reader', c.oid, 'INSERT,UPDATE,DELETE,TRUNCATE')
      OR (has_table_privilege('llm_reader', c.oid, 'SELECT') AND c.relname <> ALL(ARRAY[
        'llm_franchises','llm_players','llm_seasons','llm_season_weeks',
        'llm_season_records','llm_team_games','llm_player_games','llm_draft_picks','llm_transactions'
      ])));
  IF unexpected <> 0 THEN RAISE EXCEPTION 'Historian still has unexpected relation privileges'; END IF;
  SELECT count(*) INTO readable
  FROM pg_class c JOIN pg_namespace n ON n.oid = c.relnamespace
  WHERE n.nspname = 'public' AND c.relkind = 'r'
    AND has_table_privilege('llm_reader', c.oid, 'SELECT');
  IF readable <> 9 THEN RAISE EXCEPTION 'Expected exactly nine readable history tables; got %', readable; END IF;
END $validate$;
COMMIT;

-- Validation: exactly the nine approved tables; all write flags false.
SELECT c.relname,
  has_table_privilege('llm_reader', c.oid, 'SELECT') AS can_read,
  has_table_privilege('llm_reader', c.oid, 'INSERT,UPDATE,DELETE,TRUNCATE') AS can_write
FROM pg_class c JOIN pg_namespace n ON n.oid = c.relnamespace
WHERE n.nspname = 'public' AND c.relkind IN ('r','p','v','m')
  AND has_table_privilege('llm_reader', c.oid, 'SELECT')
ORDER BY c.relname;

-- Managed pg_net grants are owned by supabase_admin and inherited through
-- PUBLIC. postgres cannot revoke them. The application must still validate an
-- AST allowlist of relations/functions and execute each query in READ ONLY.
-- Role defaults apply to NEW connections; restart application pools on rollout.
