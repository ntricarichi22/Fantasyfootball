-- Read-only production inventory for DB-01..DB-07. Run before writing migration 018.
-- This script returns metadata only and does not read application/auth records.
BEGIN TRANSACTION READ ONLY;

CREATE TEMP TABLE audit_candidates(name text PRIMARY KEY, tier text NOT NULL) ON COMMIT DROP;
INSERT INTO audit_candidates(name, tier) VALUES
  ('league_seasons','dead_history'),('league_users','dead_history'),('league_teams','dead_history'),
  ('league_roster_snapshots','dead_history'),('league_roster_players','dead_history'),('league_drafts','dead_history'),
  ('league_draft_picks','dead_history'),('league_matchups','dead_history'),('league_matchup_teams','dead_history'),
  ('league_transactions','dead_history'),('league_transaction_assets','dead_history'),('league_traded_picks','dead_history'),
  ('league_playoff_bracket_games','dead_history'),('league_final_standings','dead_history'),('league_champions','dead_history'),
  ('slp_raw_global','raw_cache'),('slp_raw_smoke','raw_cache'),('flea_raw_global','raw_cache'),
  ('flea_raw_smoke','raw_cache'),('mfl_raw_global','raw_cache'),('mfl_raw_smoke','raw_cache'),
  ('watchlist','orphan_candidate'),('cfc_value_upload_staging','orphan_candidate');

-- Columns first: satisfies the schema-inspection gate and records actual names/types.
SELECT c.tier, c.name table_name, cols.ordinal_position, cols.column_name, cols.data_type,
       cols.is_nullable, cols.column_default
FROM audit_candidates c
LEFT JOIN information_schema.columns cols
  ON cols.table_schema='public' AND cols.table_name=c.name
ORDER BY c.tier,c.name,cols.ordinal_position;

SELECT c.tier,c.name,cls.relkind,pg_total_relation_size(cls.oid) bytes,
       st.n_live_tup estimated_rows,st.last_analyze,st.last_autoanalyze
FROM audit_candidates c
LEFT JOIN pg_class cls ON cls.relname=c.name
LEFT JOIN pg_namespace ns ON ns.oid=cls.relnamespace AND ns.nspname='public'
LEFT JOIN pg_stat_user_tables st ON st.relid=cls.oid
ORDER BY c.tier,c.name;

-- Views/materialized views whose stored definitions mention a candidate.
SELECT c.name candidate,n.nspname dependent_schema,v.relname dependent_view,v.relkind,
       pg_get_viewdef(v.oid,true) definition
FROM audit_candidates c
JOIN pg_class v ON v.relkind IN ('v','m')
JOIN pg_namespace n ON n.oid=v.relnamespace
WHERE pg_get_viewdef(v.oid,true) ILIKE '%'||c.name||'%'
ORDER BY c.name,n.nspname,v.relname;

-- Foreign keys in either direction.
SELECT c.name candidate, con.conname, con.conrelid::regclass child_relation,
       con.confrelid::regclass parent_relation, pg_get_constraintdef(con.oid,true) definition
FROM audit_candidates c
JOIN pg_class rel ON rel.relname=c.name
JOIN pg_namespace ns ON ns.oid=rel.relnamespace AND ns.nspname='public'
JOIN pg_constraint con ON con.contype='f' AND (con.conrelid=rel.oid OR con.confrelid=rel.oid)
ORDER BY c.name,con.conname;

-- User triggers and functions that mention candidates.
SELECT c.name candidate,t.tgname,rel.oid::regclass relation,pg_get_triggerdef(t.oid,true) definition
FROM audit_candidates c JOIN pg_class rel ON rel.relname=c.name
JOIN pg_namespace ns ON ns.oid=rel.relnamespace AND ns.nspname='public'
JOIN pg_trigger t ON t.tgrelid=rel.oid AND NOT t.tgisinternal ORDER BY c.name,t.tgname;
SELECT c.name candidate,p.oid::regprocedure signature,pg_get_functiondef(p.oid) definition
FROM audit_candidates c JOIN pg_proc p ON pg_get_functiondef(p.oid) ILIKE '%'||c.name||'%'
JOIN pg_namespace n ON n.oid=p.pronamespace AND n.nspname='public'
ORDER BY c.name,signature;

-- pg_cron may be absent. Query it separately only if the extension is installed:
SELECT extname,extversion FROM pg_extension WHERE extname='pg_cron';

ROLLBACK;
