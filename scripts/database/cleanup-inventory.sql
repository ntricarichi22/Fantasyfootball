-- Strictly read-only metadata inventory for DB-01..DB-07. No temp objects.
BEGIN TRANSACTION READ ONLY;

-- 1. Columns first. Absence produces one row with null column metadata.
WITH candidates(name,tier) AS (VALUES
 ('league_seasons','dead_history'),('league_users','dead_history'),('league_teams','dead_history'),
 ('league_roster_snapshots','dead_history'),('league_roster_players','dead_history'),('league_drafts','dead_history'),
 ('league_draft_picks','dead_history'),('league_matchups','dead_history'),('league_matchup_teams','dead_history'),
 ('league_transactions','dead_history'),('league_transaction_assets','dead_history'),('league_traded_picks','dead_history'),
 ('league_playoff_bracket_games','dead_history'),('league_final_standings','dead_history'),('league_champions','dead_history'),
 ('slp_raw_global','raw_cache'),('slp_raw_smoke','raw_cache'),('flea_raw_global','raw_cache'),
 ('flea_raw_smoke','raw_cache'),('mfl_raw_global','raw_cache'),('mfl_raw_smoke','raw_cache'),
 ('watchlist','orphan_candidate'),('cfc_value_upload_staging','orphan_candidate'))
SELECT c.tier,c.name table_name,x.ordinal_position,x.column_name,x.data_type,x.is_nullable,x.column_default
FROM candidates c LEFT JOIN information_schema.columns x
 ON x.table_schema='public' AND x.table_name=c.name ORDER BY c.tier,c.name,x.ordinal_position;

-- 2. Public relation identity, kind, size and estimated rows.
WITH candidates(name,tier) AS (VALUES
 ('league_seasons','dead_history'),('league_users','dead_history'),('league_teams','dead_history'),
 ('league_roster_snapshots','dead_history'),('league_roster_players','dead_history'),('league_drafts','dead_history'),
 ('league_draft_picks','dead_history'),('league_matchups','dead_history'),('league_matchup_teams','dead_history'),
 ('league_transactions','dead_history'),('league_transaction_assets','dead_history'),('league_traded_picks','dead_history'),
 ('league_playoff_bracket_games','dead_history'),('league_final_standings','dead_history'),('league_champions','dead_history'),
 ('slp_raw_global','raw_cache'),('slp_raw_smoke','raw_cache'),('flea_raw_global','raw_cache'),
 ('flea_raw_smoke','raw_cache'),('mfl_raw_global','raw_cache'),('mfl_raw_smoke','raw_cache'),
 ('watchlist','orphan_candidate'),('cfc_value_upload_staging','orphan_candidate')),
public_relations AS (SELECT c.oid,c.relname,c.relkind FROM pg_class c JOIN pg_namespace n ON n.oid=c.relnamespace WHERE n.nspname='public')
SELECT c.tier,c.name,r.oid,r.relkind,CASE WHEN r.oid IS NULL THEN NULL ELSE pg_total_relation_size(r.oid) END bytes,
 st.n_live_tup estimated_rows,st.last_analyze,st.last_autoanalyze
FROM candidates c LEFT JOIN public_relations r ON r.relname=c.name LEFT JOIN pg_stat_user_tables st ON st.relid=r.oid
ORDER BY c.tier,c.name;

-- 3. Exact catalog dependencies in either direction (strong evidence).
WITH candidates AS (SELECT c.oid,c.relname FROM pg_class c JOIN pg_namespace n ON n.oid=c.relnamespace
 WHERE n.nspname='public' AND c.relname IN ('league_seasons','league_users','league_teams','league_roster_snapshots',
 'league_roster_players','league_drafts','league_draft_picks','league_matchups','league_matchup_teams','league_transactions',
 'league_transaction_assets','league_traded_picks','league_playoff_bracket_games','league_final_standings','league_champions',
 'slp_raw_global','slp_raw_smoke','flea_raw_global','flea_raw_smoke','mfl_raw_global','mfl_raw_smoke','watchlist','cfc_value_upload_staging'))
SELECT c.relname candidate,d.classid::regclass dependency_catalog,d.objid,d.objsubid,
 d.refclassid::regclass referenced_catalog,d.refobjid,d.refobjsubid,d.deptype
FROM candidates c JOIN pg_depend d ON d.objid=c.oid OR d.refobjid=c.oid ORDER BY c.relname,d.deptype,d.objid;

-- 4. Foreign keys and user triggers (human-readable exact definitions).
WITH candidates AS (SELECT c.oid,c.relname FROM pg_class c JOIN pg_namespace n ON n.oid=c.relnamespace
 WHERE n.nspname='public' AND c.relname ~ '^(league_|(slp|flea|mfl)_raw_)' OR n.nspname='public' AND c.relname IN ('watchlist','cfc_value_upload_staging'))
SELECT c.relname candidate,con.conname,con.conrelid::regclass child_relation,con.confrelid::regclass parent_relation,
 pg_get_constraintdef(con.oid,true) definition FROM candidates c JOIN pg_constraint con
 ON con.contype='f' AND (con.conrelid=c.oid OR con.confrelid=c.oid) ORDER BY c.relname,con.conname;
WITH candidates AS (SELECT c.oid,c.relname FROM pg_class c JOIN pg_namespace n ON n.oid=c.relnamespace
 WHERE n.nspname='public' AND (c.relname ~ '^(league_|(slp|flea|mfl)_raw_)' OR c.relname IN ('watchlist','cfc_value_upload_staging')))
SELECT c.relname candidate,t.tgname,pg_get_triggerdef(t.oid,true) definition FROM candidates c
JOIN pg_trigger t ON t.tgrelid=c.oid AND NOT t.tgisinternal ORDER BY c.relname,t.tgname;

-- 5. Text search is only a supplement: dynamic SQL and external jobs remain invisible.
-- pg_get_functiondef is restricted to ordinary functions/procedures.
WITH candidates(name) AS (VALUES ('league_seasons'),('league_users'),('league_teams'),('league_roster_snapshots'),
 ('league_roster_players'),('league_drafts'),('league_draft_picks'),('league_matchups'),('league_matchup_teams'),
 ('league_transactions'),('league_transaction_assets'),('league_traded_picks'),('league_playoff_bracket_games'),
 ('league_final_standings'),('league_champions'),('slp_raw_global'),('slp_raw_smoke'),('flea_raw_global'),
 ('flea_raw_smoke'),('mfl_raw_global'),('mfl_raw_smoke'),('watchlist'),('cfc_value_upload_staging')),
defs AS (SELECT p.oid,p.oid::regprocedure signature,pg_get_functiondef(p.oid) definition FROM pg_proc p
 JOIN pg_namespace n ON n.oid=p.pronamespace WHERE n.nspname='public' AND p.prokind IN ('f','p'))
SELECT c.name candidate,d.signature,d.definition FROM candidates c JOIN defs d ON d.definition ILIKE '%'||c.name||'%'
ORDER BY c.name,d.signature;

-- 6. Views/materialized views text supplement and scheduler availability.
WITH candidates(name) AS (VALUES ('league_seasons'),('league_users'),('league_teams'),('league_roster_snapshots'),
 ('league_roster_players'),('league_drafts'),('league_draft_picks'),('league_matchups'),('league_matchup_teams'),
 ('league_transactions'),('league_transaction_assets'),('league_traded_picks'),('league_playoff_bracket_games'),
 ('league_final_standings'),('league_champions'),('slp_raw_global'),('slp_raw_smoke'),('flea_raw_global'),
 ('flea_raw_smoke'),('mfl_raw_global'),('mfl_raw_smoke'),('watchlist'),('cfc_value_upload_staging')),
views AS (SELECT v.oid,n.nspname,v.relname,v.relkind,pg_get_viewdef(v.oid,true) definition FROM pg_class v
 JOIN pg_namespace n ON n.oid=v.relnamespace WHERE v.relkind IN ('v','m'))
SELECT c.name candidate,v.nspname dependent_schema,v.relname dependent_view,v.relkind,v.definition
FROM candidates c JOIN views v ON v.definition ILIKE '%'||c.name||'%' ORDER BY c.name,v.nspname,v.relname;
SELECT extname,extversion FROM pg_extension WHERE extname='pg_cron';

ROLLBACK;
