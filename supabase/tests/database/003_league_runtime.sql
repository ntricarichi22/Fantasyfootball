BEGIN;
SELECT plan(22);
SELECT ok(NOT has_table_privilege('service_role','public.cfc_asset_ownership','UPDATE'),
 'service role cannot bypass ledger transactions');
SELECT ok(NOT has_schema_privilege('service_role','cfc_runtime_private','USAGE'),
 'private helpers are not directly callable by service callers');
SELECT ok(NOT EXISTS(SELECT 1 FROM pg_proc p JOIN pg_namespace n ON n.oid=p.pronamespace
 WHERE n.nspname='public' AND p.proname IN ('cfc_create_trade_offer','cfc_resolve_trade_offer','cfc_submit_draft_pick',
 'cfc_draft_command','cfc_refresh_runtime_snapshot','cfc_refresh_runtime_snapshot_system','cfc_tick_due_draft','cfc_get_league_runtime_public')
 AND (has_function_privilege('anon',p.oid,'EXECUTE') OR has_function_privilege('authenticated',p.oid,'EXECUTE'))),
 'no browser role can invoke runtime entry points');
SELECT ok(NOT EXISTS(SELECT 1 FROM pg_proc p JOIN pg_namespace n ON n.oid=p.pronamespace
 WHERE n.nspname='cfc_runtime_private' AND (NOT p.prosecdef OR NOT coalesce(p.proconfig @> ARRAY['search_path=""'],false))),
 'private functions use the reviewed fixed definer boundary');
SELECT is(public.cfc_get_league_runtime_public('pgtap-runtime-unknown')->>'initialized','false','unknown league does not silently bootstrap');
SELECT throws_ok($q$SELECT public.cfc_refresh_runtime_snapshot_system('pgtap-runtime-unknown',gen_random_uuid(),0,'{}')$q$,
 'PT503','snapshot_required','machine cannot create unknown leagues');
SELECT throws_ok($q$SELECT public.cfc_get_league_runtime('pgtap-runtime-unknown',gen_random_uuid(),gen_random_uuid())$q$,
 'PT401','session_inactive','unknown session fails closed');

INSERT INTO auth.users(id,instance_id,aud,role,email,created_at,updated_at)
VALUES('80000000-0000-0000-0000-000000000001','00000000-0000-0000-0000-000000000000','authenticated','authenticated','runtime-pgtap@example.invalid',now(),now());
INSERT INTO auth.sessions(id,user_id,created_at,updated_at)
VALUES('80000000-0000-0000-0000-000000000002','80000000-0000-0000-0000-000000000001',now(),now());
INSERT INTO public.league_memberships(user_id,league_id,roster_id,role)
VALUES('80000000-0000-0000-0000-000000000001','pgtap-runtime','1','member');
SELECT throws_ok($q$SELECT public.cfc_get_league_runtime('pgtap-other','80000000-0000-0000-0000-000000000001','80000000-0000-0000-0000-000000000002')$q$,
 'PT403','membership_required','current membership is league scoped');
SELECT lives_ok($q$SELECT public.cfc_refresh_runtime_snapshot('pgtap-runtime','80000000-0000-0000-0000-000000000001',
 '80000000-0000-0000-0000-000000000002','80000000-0000-0000-0000-000000000003',0,
 jsonb_build_object('observed_at',now(),'roster_ids',jsonb_build_array('1','2'),'draft_season',2026,'team_count',2,'round_count',1,'pick_seconds',1800,
 'assets','[{"asset_key":"pick:2026-1-1","asset_kind":"pick","owner_roster_id":"1","consumed":false},{"asset_key":"pick:2026-1-2","asset_kind":"pick","owner_roster_id":"2","consumed":false}]'::jsonb,
 'slots','[{"pick_index":0,"asset_key":"pick:2026-1-1","round":1,"slot":1},{"pick_index":1,"asset_key":"pick:2026-1-2","round":1,"slot":2}]'::jsonb))$q$,
 'validated member can bootstrap a paused complete runtime');
SELECT is((SELECT writes_enabled FROM public.cfc_league_runtime WHERE league_id='pgtap-runtime'),false,'bootstrap never enables writers');
SELECT throws_ok($q$SELECT public.cfc_draft_command('pgtap-runtime','80000000-0000-0000-0000-000000000001',
 '80000000-0000-0000-0000-000000000002',gen_random_uuid(),1,'start','{}')$q$,
 'PT503','runtime_paused','expanded deployment fails closed before controlled cutover');
UPDATE public.cfc_league_runtime SET writes_enabled=true WHERE league_id='pgtap-runtime';
SELECT throws_ok($q$SELECT public.cfc_draft_command('pgtap-runtime','80000000-0000-0000-0000-000000000001',
 '80000000-0000-0000-0000-000000000002',gen_random_uuid(),1,'start','{}')$q$,
 'PT403','commissioner_required','member cannot change commissioner clock controls');
SELECT throws_ok($q$SELECT public.cfc_tick_due_draft('pgtap-runtime',gen_random_uuid(),0)$q$,
 'PT409','revision_conflict','stale machine command fails without mutation');
INSERT INTO public.cfc_big_board_tiers(id,league_id,roster_id,tier_order)
VALUES('80000000-0000-0000-0000-000000000004','pgtap-runtime','1',5000);
SELECT throws_ok($q$INSERT INTO public.cfc_big_board_rankings(league_id,roster_id,player_id,tier_id,rank)
 VALUES('pgtap-other','1','test','80000000-0000-0000-0000-000000000004',1)$q$,
 '23503',NULL,'tier reference cannot cross league scope');
SELECT ok(has_function_privilege('service_role','public.cfc_get_draft_log(text,uuid,uuid,integer,boolean)','EXECUTE'),
 'service role can read a guarded consistent draft-log snapshot');
SELECT ok(NOT has_function_privilege('anon','public.cfc_get_draft_log(text,uuid,uuid,integer,boolean)','EXECUTE')
 AND NOT has_function_privilege('authenticated','public.cfc_get_draft_log(text,uuid,uuid,integer,boolean)','EXECUTE'),
 'browser roles cannot bypass the draft-log route');
INSERT INTO public.draft_log(league_id,draft_season,pick_index,roster_id,is_announced,is_skip)
VALUES('pgtap-runtime',2026,0,'1',true,true),('pgtap-runtime',2026,1,'2',false,false),
 ('pgtap-runtime',2025,2,'1',true,true),('pgtap-other',2026,0,'1',true,true);
SELECT is(jsonb_array_length(public.cfc_get_draft_log('pgtap-runtime','80000000-0000-0000-0000-000000000001',
 '80000000-0000-0000-0000-000000000002')->'data'),1,'default read returns only announced rows in the current league and season');
SELECT throws_ok($q$SELECT public.cfc_get_draft_log('pgtap-runtime','80000000-0000-0000-0000-000000000001',
 '80000000-0000-0000-0000-000000000002',NULL,true)$q$,
 'PT403','commissioner_required','member cannot request unpublished draft rows');
SELECT throws_ok($q$SELECT public.cfc_get_draft_log('pgtap-other','80000000-0000-0000-0000-000000000001',
 '80000000-0000-0000-0000-000000000002')$q$,
 'PT403','membership_required','draft-log reader rejects cross-league access');
SELECT is((public.cfc_get_draft_log('pgtap-runtime','80000000-0000-0000-0000-000000000001',
 '80000000-0000-0000-0000-000000000002',2025)->'data'->0->>'pick_index')::integer,2,
 'explicit historical season stays separate from the active draft');
UPDATE public.league_memberships SET role='commissioner' WHERE league_id='pgtap-runtime'
 AND user_id='80000000-0000-0000-0000-000000000001';
SELECT is(jsonb_array_length(public.cfc_get_draft_log('pgtap-runtime','80000000-0000-0000-0000-000000000001',
 '80000000-0000-0000-0000-000000000002',NULL,true)->'data'),2,
 'current commissioner can explicitly read unpublished same-league rows');
SELECT is((public.cfc_get_draft_log('pgtap-runtime','80000000-0000-0000-0000-000000000001',
 '80000000-0000-0000-0000-000000000002')->>'revision')::bigint,1::bigint,
 'draft-log snapshot includes the canonical runtime revision');
SELECT * FROM finish();
ROLLBACK;
