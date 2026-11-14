BEGIN;
SELECT plan(10);

SELECT ok(has_function_privilege('service_role', 'public.is_auth_session_active(uuid,uuid)', 'EXECUTE'),
  'service role can validate provider sessions');
SELECT ok(NOT has_function_privilege('anon', 'public.is_auth_session_active(uuid,uuid)', 'EXECUTE'),
  'anonymous callers cannot enumerate sessions');
SELECT ok(NOT has_function_privilege('authenticated', 'public.is_auth_session_active(uuid,uuid)', 'EXECUTE'),
  'browser users cannot enumerate sessions');
SELECT ok(NOT public.is_auth_session_active(NULL, NULL), 'null session fails closed');
SELECT ok(NOT public.is_auth_session_active('00000000-0000-0000-0000-000000000000',
  '00000000-0000-0000-0000-000000000000'), 'unknown session fails closed');

INSERT INTO auth.users (id, instance_id, aud, role, email, encrypted_password, created_at, updated_at)
VALUES ('60000000-0000-0000-0000-000000000006', '00000000-0000-0000-0000-000000000000',
  'authenticated', 'authenticated', 'draft-visibility@example.invalid', '', now(), now());
INSERT INTO public.league_memberships(user_id,league_id,roster_id,role)
VALUES ('60000000-0000-0000-0000-000000000006','visibility-league','1','member');
INSERT INTO public.draft_log(league_id,pick_index,roster_id,is_announced)
VALUES ('visibility-league',901001,'1',false),
       ('visibility-league',901002,'2',false),
       ('visibility-league',901003,'2',true),
       ('visibility-other-league',901004,'1',true);
SET LOCAL ROLE authenticated;
SELECT set_config('request.jwt.claim.sub','60000000-0000-0000-0000-000000000006',true);
SELECT is((SELECT count(*) FROM public.draft_log WHERE pick_index=901001),1::bigint,
  'member can see own pending selection');
SELECT is((SELECT count(*) FROM public.draft_log WHERE pick_index=901002),0::bigint,
  'member cannot see opponent pending selection');
SELECT is((SELECT count(*) FROM public.draft_log WHERE pick_index=901003),1::bigint,
  'member can see announced opponent selection');
SELECT is((SELECT count(*) FROM public.draft_log WHERE pick_index=901004),0::bigint,
  'member cannot see another league selection');
RESET ROLE;
UPDATE public.league_memberships SET role='commissioner'
WHERE user_id='60000000-0000-0000-0000-000000000006' AND league_id='visibility-league';
SET LOCAL ROLE authenticated;
SELECT is((SELECT count(*) FROM public.draft_log WHERE pick_index BETWEEN 901001 AND 901004),3::bigint,
  'commissioner can see every same-league selection but no other league');
RESET ROLE;
SELECT * FROM finish();
ROLLBACK;
