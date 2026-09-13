-- READ-ONLY catalog capture for the remaining clean-database baseline gap.
-- Returns definitions only; it does not select application/auth rows.
WITH wanted(relname) AS (VALUES
 ('trade_offers'), ('trade_messages'), ('cfc_value_upload_staging'),
 ('cfc_assets'), ('cfc_asset_source_values'), ('cfc_asset_calculations'),
 ('cfc_trade_values_current'), ('ff_master_draft_picks'),
 ('ff_source_franchise_map'), ('ff_source_player_map'),
 ('mfl_mirror_draft_results'), ('draft_log'), ('draft_state'),
 ('cfc_team_strategy_profiles')
), relations AS (
 SELECT c.oid, n.nspname, c.relname, c.relkind, c.relrowsecurity, c.relforcerowsecurity,
        c.reloptions, pg_get_userbyid(c.relowner) owner
 FROM pg_class c JOIN pg_namespace n ON n.oid=c.relnamespace
 JOIN wanted w ON w.relname=c.relname WHERE n.nspname='public'
)
SELECT 'relation' section, r.relname object_name,
 jsonb_build_object('kind',r.relkind,'owner',r.owner,'rls',r.relrowsecurity,
   'forced',r.relforcerowsecurity,'options',r.reloptions) definition
FROM relations r
UNION ALL
SELECT 'column', r.relname,
 jsonb_agg(jsonb_build_object('ordinal',a.attnum,'name',a.attname,
   'type',pg_catalog.format_type(a.atttypid,a.atttypmod),'notnull',a.attnotnull,
   'identity',a.attidentity,'generated',a.attgenerated,
   'default',pg_get_expr(d.adbin,d.adrelid)) ORDER BY a.attnum)
FROM relations r JOIN pg_attribute a ON a.attrelid=r.oid AND a.attnum>0 AND NOT a.attisdropped
LEFT JOIN pg_attrdef d ON d.adrelid=a.attrelid AND d.adnum=a.attnum GROUP BY r.relname
UNION ALL
SELECT 'constraint', r.relname,
 jsonb_agg(jsonb_build_object('name',con.conname,'type',con.contype,
   'definition',pg_get_constraintdef(con.oid,true)) ORDER BY con.conname)
FROM relations r JOIN pg_constraint con ON con.conrelid=r.oid GROUP BY r.relname
UNION ALL
SELECT 'index', r.relname, jsonb_agg(pg_get_indexdef(i.indexrelid) ORDER BY ci.relname)
FROM relations r JOIN pg_index i ON i.indrelid=r.oid JOIN pg_class ci ON ci.oid=i.indexrelid GROUP BY r.relname
UNION ALL
SELECT 'trigger', r.relname,
 jsonb_agg(pg_get_triggerdef(t.oid,true) ORDER BY t.tgname)
FROM relations r JOIN pg_trigger t ON t.tgrelid=r.oid AND NOT t.tgisinternal GROUP BY r.relname
UNION ALL
SELECT 'view', r.relname, to_jsonb(pg_get_viewdef(r.oid,true))
FROM relations r WHERE r.relkind IN ('v','m')
ORDER BY object_name, section;

-- Definitions for every public function referenced by these objects/migrations.
SELECT p.oid::regprocedure::text signature, pg_get_functiondef(p.oid) definition,
       p.proacl privileges
FROM pg_proc p JOIN pg_namespace n ON n.oid=p.pronamespace
WHERE n.nspname='public' AND p.proname IN (
 'cfc_apply_value_upload','cfc_rebuild_value_layers','cfc_set_updated_at',
 'ff_rebuild_master_draft_picks_actual_results'
) ORDER BY signature;

-- Sequence ownership/start/increment for wanted relations.
SELECT seq_ns.nspname sequence_schema, seq.relname sequence_name,
       tbl.relname owned_by_table, col.attname owned_by_column,
       s.seqstart, s.seqincrement, s.seqmin, s.seqmax, s.seqcache, s.seqcycle
FROM pg_class seq JOIN pg_namespace seq_ns ON seq_ns.oid=seq.relnamespace
JOIN pg_sequence s ON s.seqrelid=seq.oid
LEFT JOIN pg_depend dep ON dep.classid='pg_class'::regclass AND dep.objid=seq.oid AND dep.deptype='a'
LEFT JOIN pg_class tbl ON tbl.oid=dep.refobjid
LEFT JOIN pg_attribute col ON col.attrelid=dep.refobjid AND col.attnum=dep.refobjsubid
WHERE seq.relkind='S' AND (tbl.relname IN (
 'trade_offers','trade_messages','cfc_value_upload_staging','cfc_assets',
 'cfc_asset_source_values','cfc_asset_calculations','ff_master_draft_picks',
 'ff_source_franchise_map','ff_source_player_map','mfl_mirror_draft_results',
 'draft_log','draft_state','cfc_team_strategy_profiles')
 OR seq.relname LIKE 'mfl_mirror_draft_results%')
ORDER BY sequence_schema, sequence_name;
