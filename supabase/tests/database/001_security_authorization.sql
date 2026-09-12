BEGIN;
SELECT plan(23);

SELECT ok(public.claim_security_alert('database-test-alert', 'application_error', 15, 12) IS NOT NULL,
  'first alert in a window receives a durable claim');
SELECT is(public.claim_security_alert('database-test-alert', 'application_error', 15, 12), NULL::uuid,
  'duplicate alert in the same window is suppressed');

INSERT INTO auth.users (id, instance_id, aud, role, email, encrypted_password, created_at, updated_at)
VALUES
 ('10000000-0000-0000-0000-000000000001', '00000000-0000-0000-0000-000000000000', 'authenticated', 'authenticated', 'security-a@example.invalid', '', now(), now()),
 ('20000000-0000-0000-0000-000000000002', '00000000-0000-0000-0000-000000000000', 'authenticated', 'authenticated', 'security-b@example.invalid', '', now(), now()),
 ('30000000-0000-0000-0000-000000000003', '00000000-0000-0000-0000-000000000000', 'authenticated', 'authenticated', 'invited@example.invalid', '', now(), now());
INSERT INTO public.league_memberships (user_id, league_id, roster_id)
VALUES
 ('10000000-0000-0000-0000-000000000001', 'security-league-a', '1'),
 ('20000000-0000-0000-0000-000000000002', 'security-league-b', '2');
INSERT INTO public.draft_state (league_id) VALUES ('security-league-a'), ('security-league-b');
INSERT INTO public.draft_log (league_id, pick_index, player_id, submitted_at)
VALUES ('security-league-a', 900001, 'security-player-a', now()),
       ('security-league-b', 900001, 'security-player-b', now());

INSERT INTO public.league_invitations (league_id,email,roster_id)
VALUES ('security-league-a','invited@example.invalid','3');
SELECT is((SELECT count(*) FROM public.accept_league_invitation(
  '30000000-0000-0000-0000-000000000003','invited@example.invalid','security-league-a')),
  1::bigint, 'unused explicit invitation creates one membership');
SELECT is((SELECT count(*) FROM public.league_memberships
  WHERE user_id='30000000-0000-0000-0000-000000000003'), 1::bigint,
  'accepted invitation persists membership');
SELECT lives_ok($$SELECT public.revoke_league_access(
  '30000000-0000-0000-0000-000000000003','security-league-a')$$,
  'trusted revocation updates grant and membership atomically');
SELECT is((SELECT count(*) FROM public.accept_league_invitation(
  '30000000-0000-0000-0000-000000000003','invited@example.invalid','security-league-a')),
  0::bigint, 'revoked or consumed invitation cannot recreate membership');
SELECT ok(public.claim_auth_attempt(repeat('a',64), 5, 1),
  'first server auth attempt in a shared window is admitted');
SELECT ok(NOT public.claim_auth_attempt(repeat('a',64), 5, 1),
  'shared auth limiter rejects the next attempt over its bound');

SET LOCAL ROLE authenticated;
SELECT set_config('request.jwt.claim.sub', '10000000-0000-0000-0000-000000000001', true);

SELECT is((SELECT count(*)::integer FROM public.league_memberships), 1, 'member sees only own membership');
SELECT is((SELECT league_id FROM public.league_memberships), 'security-league-a', 'membership belongs to JWT actor');
SELECT is((SELECT count(*)::integer FROM public.draft_state), 1, 'member sees only own draft state');
SELECT is((SELECT league_id FROM public.draft_state), 'security-league-a', 'draft state is league scoped');
SELECT is((SELECT count(*)::integer FROM public.draft_log), 1, 'member sees only own draft log');
SELECT is((SELECT player_id FROM public.draft_log), 'security-player-a', 'cross-league draft pick is hidden');
SELECT ok(NOT has_table_privilege('authenticated', 'public.draft_log', 'INSERT'), 'authenticated cannot directly insert draft log');
SELECT ok(NOT has_table_privilege('authenticated', 'public.draft_state', 'UPDATE'), 'authenticated cannot directly update draft clock');
SELECT ok(NOT has_table_privilege('anon', 'public.draft_log', 'SELECT'), 'anonymous draft reads are denied');
SELECT ok(NOT has_table_privilege('authenticated', 'public.trade_offers', 'SELECT'), 'private trade offers are not directly readable');
SELECT ok(NOT has_table_privilege('authenticated', 'public.team_email_map', 'SELECT'), 'invitation email map is server-only');
SELECT ok(NOT has_function_privilege('authenticated', 'public.ai_get_quota(uuid,bigint,bigint)', 'EXECUTE'), 'AI quota RPC is service-only');
SELECT ok(NOT has_function_privilege('authenticated', 'public.claim_security_alert(text,text,integer,integer)', 'EXECUTE'),
  'authenticated clients cannot claim owner alert delivery');
SELECT ok(NOT has_function_privilege('authenticated', 'public.accept_league_invitation(uuid,text,text)', 'EXECUTE'),
  'authenticated clients cannot mint memberships directly');
SELECT ok(NOT has_function_privilege('authenticated', 'public.claim_auth_attempt(text,integer,integer)', 'EXECUTE'),
  'authenticated clients cannot bypass shared auth accounting');

SELECT * FROM finish();
ROLLBACK;
