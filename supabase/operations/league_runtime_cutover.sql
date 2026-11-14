-- MANUAL CUTOVER, not an automatically applied migration. Read the runbook first.
-- Caller must explicitly SET cfc.runtime_cutover='approved' in this DB session.
-- Pause old mutation traffic/jobs and refresh every existing league before running.
BEGIN;
SET LOCAL lock_timeout='5s';
SET LOCAL statement_timeout='60s';
SELECT table_name,column_name,data_type FROM information_schema.columns WHERE table_schema='public'
 AND table_name IN ('cfc_league_runtime','cfc_asset_ownership','draft_log','draft_state',
 'trade_offers','trade_threads','trade_messages','cfc_pending_trade_overlays','team_email_map')
 ORDER BY table_name,ordinal_position;
-- Lock before validating so no old writer can invalidate the preconditions.
LOCK TABLE public.trade_offers,public.trade_threads,public.cfc_pending_trade_overlays,
 public.draft_state,public.draft_log,public.cfc_league_runtime IN ACCESS EXCLUSIVE MODE;
DO $$ BEGIN
 IF current_setting('cfc.runtime_cutover',true) IS DISTINCT FROM 'approved' THEN
  RAISE EXCEPTION 'Explicit reviewed cutover session setting required'; END IF;
 IF NOT EXISTS(SELECT 1 FROM public.cfc_league_runtime WHERE initialized_at IS NOT NULL) THEN
  RAISE EXCEPTION 'No initialized runtime; bootstrap verified snapshots before cutover'; END IF;
 IF EXISTS(SELECT 1 FROM (SELECT league_id FROM public.draft_state UNION SELECT league_id FROM public.trade_offers) old
  LEFT JOIN public.cfc_league_runtime r USING(league_id) WHERE r.initialized_at IS NULL) THEN
  RAISE EXCEPTION 'Every existing mutation league needs an initialized runtime'; END IF;
 IF EXISTS(SELECT 1 FROM public.draft_log l JOIN public.draft_state d ON d.league_id=l.league_id AND d.draft_season=l.draft_season
  LEFT JOIN public.cfc_asset_ownership a ON a.league_id=l.league_id AND a.asset_key='player:'||l.player_id
  WHERE l.player_id IS NOT NULL AND NOT l.is_skip AND
  (a.asset_key IS NULL OR a.draft_season IS DISTINCT FROM l.draft_season OR a.draft_pick_index IS DISTINCT FROM l.pick_index)) THEN
  RAISE EXCEPTION 'Current selections are missing runtime links; refresh under mutation pause'; END IF;
END $$;
REVOKE INSERT,UPDATE,DELETE,TRUNCATE,REFERENCES,TRIGGER ON public.trade_offers,public.trade_threads,
 public.cfc_pending_trade_overlays,public.draft_state,public.draft_log FROM PUBLIC,anon,authenticated,service_role;
GRANT SELECT ON public.trade_offers,public.trade_threads,public.trade_messages,public.cfc_pending_trade_overlays,
 public.draft_state,public.draft_log TO service_role;
-- Inventoried non-domain metadata callers. No status/ownership/clock privilege survives.
GRANT UPDATE(read_at,ai_quip) ON public.trade_offers TO service_role;
GRANT UPDATE(last_activity_at,last_message_at,unread_by_team_a,unread_by_team_b,updated_at)
 ON public.trade_threads TO service_role;
GRANT INSERT ON public.trade_messages TO service_role;

-- New deployment supplies explicit league/season conflict targets. Remove old ones
-- only now, otherwise the expansion would break the running deployment's upserts.
DO $$ DECLARE r record; t text; cols text; BEGIN
 FOR t,cols IN SELECT * FROM (VALUES
  ('team_email_map','email'),('cfc_big_board_tiers','roster_id,tier_order'),
  ('cfc_big_board_rankings','roster_id,player_id'),('cfc_big_board_stars','roster_id,player_id'),
  ('cfc_team_manual_value_overrides','team_id,asset_key'),('cfc_team_roster_players','team_id,sleeper_player_id')
 ) x(t,c) LOOP
  IF to_regclass('public.'||t) IS NULL THEN CONTINUE; END IF;
  FOR r IN SELECT c.conname,c.contype FROM pg_constraint c WHERE c.conrelid=to_regclass('public.'||t)
   AND (c.contype='u' OR (t='team_email_map' AND c.contype='p'))
   AND (SELECT string_agg(a.attname,',' ORDER BY k.ord) FROM unnest(c.conkey) WITH ORDINALITY k(n,ord)
    JOIN pg_attribute a ON a.attrelid=c.conrelid AND a.attnum=k.n)=cols LOOP
   EXECUTE format('ALTER TABLE public.%I DROP CONSTRAINT %I',t,r.conname);
   IF r.contype='p' THEN
    ALTER TABLE public.team_email_map ADD CONSTRAINT team_email_map_pkey PRIMARY KEY(league_id,email);
   END IF;
  END LOOP;
  EXECUTE format('ALTER TABLE public.%I ALTER COLUMN league_id DROP DEFAULT',t);
 END LOOP;
 IF to_regclass('public.cfc_director_memos') IS NOT NULL THEN
  ALTER TABLE public.cfc_director_memos ALTER COLUMN league_id DROP DEFAULT;
 END IF;
 IF EXISTS(SELECT 1 FROM pg_constraint c WHERE c.conrelid='public.draft_log'::regclass AND c.contype='p'
  AND array_length(c.conkey,1)=2) THEN
  ALTER TABLE public.draft_log DROP CONSTRAINT draft_log_pkey;
  ALTER TABLE public.draft_log ADD CONSTRAINT draft_log_pkey PRIMARY KEY(league_id,draft_season,pick_index);
 END IF;
END $$;
DROP INDEX IF EXISTS public.draft_log_player_unique;
-- Migration 020 also added this standalone global expression index. The
-- normalization trigger plus (league_id,email) unique index preserves identity.
DROP INDEX IF EXISTS public.team_email_map_normalized_email_key;
ALTER TABLE public.draft_log ALTER COLUMN draft_season DROP DEFAULT;
UPDATE public.cfc_league_runtime SET writes_enabled=true WHERE initialized_at IS NOT NULL;
DO $$ BEGIN
 IF has_table_privilege('service_role','public.trade_offers','INSERT')
 OR has_column_privilege('service_role','public.trade_offers','status','UPDATE')
 OR has_table_privilege('service_role','public.draft_log','INSERT')
 OR has_column_privilege('service_role','public.draft_state','current_pick_index','UPDATE') THEN
  RAISE EXCEPTION 'Direct domain write privilege remains; cutover aborted'; END IF;
END $$;
COMMIT;
