BEGIN;
SELECT plan(40);

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
INSERT INTO public.league_invitations (league_id,email,roster_id)
VALUES ('normalization-league','  MIXED@example.invalid  ','4');
SELECT is((SELECT email FROM public.league_invitations WHERE league_id='normalization-league'),
  'mixed@example.invalid', 'future invitation writes normalize case and surrounding whitespace');
SELECT throws_ok(
  $$INSERT INTO public.league_invitations (league_id,email,roster_id)
    VALUES ('normalization-league','mixed@EXAMPLE.invalid','5')$$,
  '23505', NULL, 'normalized invitation identity rejects case-only duplicates');
SELECT throws_ok(
  $$INSERT INTO public.league_invitations (league_id,email,roster_id)
    VALUES ('normalization-league','   ','5')$$,
  'P0001', 'invitation email cannot be blank', 'blank normalized invitation identity fails closed');
INSERT INTO public.team_email_map(email,roster_id,team_name)
VALUES ('  Mapping@Example.invalid  ','mapping-roster','Mapping fixture');
SELECT is((SELECT email FROM public.team_email_map WHERE roster_id='mapping-roster'),
  'mapping@example.invalid', 'future auth-to-team mapping writes normalize email identity');
SELECT throws_ok(
  $$INSERT INTO public.team_email_map(email,roster_id,team_name)
    VALUES ('mapping@EXAMPLE.invalid','other-roster','Duplicate fixture')$$,
  '23505', NULL, 'auth-to-team mapping rejects normalized duplicate email identity');
SELECT throws_ok(
  $$INSERT INTO public.team_email_map(email,roster_id,team_name)
    VALUES ('   ','blank-roster','Blank fixture')$$,
  'P0001', 'invitation email cannot be blank', 'blank auth-to-team mapping identity fails closed');
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

INSERT INTO public.ff_master_franchises(franchise_id,canonical_franchise_name)
VALUES ('40000000-0000-0000-0000-000000000004','Sleeper test franchise');
INSERT INTO public.ff_master_players(player_id,canonical_player_name)
VALUES ('50000000-0000-0000-0000-000000000005','Sleeper test player');
INSERT INTO public.ff_source_franchise_map(platform,source_league_id,season_year,source_roster_id,franchise_id)
VALUES ('sleeper','security-source-league',2025,'7','40000000-0000-0000-0000-000000000004');
INSERT INTO public.ff_source_player_map(platform,source_player_id,player_id)
VALUES ('sleeper','security-source-player','50000000-0000-0000-0000-000000000005');
INSERT INTO public.slp_mirror_draft_results(season_year,source_league_id,draft_id,round,pick_number,roster_id,source_player_id,raw_pick_json)
VALUES (2025,'security-source-league','security-draft',1,1,'7','security-source-player','{}');
INSERT INTO public.ff_master_draft_picks(draft_year,round,pick_number,source_platform)
VALUES (2024,1,1,'mfl');
SELECT lives_ok('SELECT public.ff_rebuild_master_draft_picks_actual_results()',
  'actual-results rebuild executes without a hidden temp-table dependency');
SELECT is((SELECT count(*) FROM public.ff_master_draft_picks WHERE source_platform='mfl'), 1::bigint,
  'actual-results rebuild preserves MFL results');
SELECT is((SELECT count(*) FROM public.ff_master_draft_picks WHERE source_platform='sleeper'), 1::bigint,
  'actual-results rebuild materializes mapped Sleeper results once');
SELECT ok((SELECT original_franchise_id IS NULL AND current_franchise_id IS NULL
  FROM public.ff_master_draft_picks WHERE source_platform='sleeper'),
  'Sleeper actual result stores selected-by only, not pick ownership');
SELECT is(public.cfc_durable_pick_key('pick:2026-2-06-7'), 'pick:2026-2-7',
  'retired slotted pick keys migrate to durable identity');
SELECT is(public.cfc_durable_pick_key('pick:2027-2-7'), 'pick:2027-2-7',
  'durable pick keys remain unchanged');

-- Simulate the explicit trusted operator assignment. Authority is attached to
-- user+league membership, never the mutable franchise display name.
UPDATE public.league_memberships SET role='commissioner'
WHERE user_id='10000000-0000-0000-0000-000000000001' AND league_id='security-league-a';
INSERT INTO public.team_email_map(email,roster_id,team_name)
VALUES ('security-a@example.invalid','1','Original Name') ON CONFLICT (email) DO UPDATE SET team_name=excluded.team_name;
UPDATE public.team_email_map SET team_name='Renamed Franchise' WHERE roster_id='1';
SELECT is((SELECT role FROM public.league_memberships WHERE user_id='10000000-0000-0000-0000-000000000001'),
  'commissioner', 'commissioner authority survives a team rename');
SELECT is((SELECT role FROM public.league_memberships WHERE user_id='20000000-0000-0000-0000-000000000002'),
  'member', 'ordinary members are not promoted');

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
SELECT ok(NOT has_table_privilege('authenticated', 'public.league_memberships', 'UPDATE'),
  'members cannot self-promote');
SELECT ok(NOT has_table_privilege('authenticated', 'public.cfc_pending_trade_overlays', 'SELECT'),
  'pending trade overlays are server-only');
SELECT ok(NOT has_table_privilege('authenticated', 'public.cfc_pick_ladder_versions', 'SELECT'),
  'pick ladder provenance is server-only');
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
