-- Live-catalog-informed Data API least-privilege boundary (2026-09-12 UTC).
-- Rerunnable. This script does not select application or auth rows.
BEGIN;

-- Required schema preflight before DDL. Review output against the captured catalog.
SELECT table_name, column_name, data_type, is_nullable
FROM information_schema.columns
WHERE table_schema = 'public'
  AND table_name IN (
    'active_teams', 'cfc_big_board_rankings', 'cfc_big_board_stars',
    'cfc_big_board_tiers', 'cfc_director_memos', 'cfc_studio_offer_feedback',
    'cfc_team_manual_value_overrides', 'cfc_team_player_attachment',
    'cfc_team_player_value_overrides', 'cfc_team_strategy_profiles',
    'cfc_trade_passes', 'draft_log', 'draft_state', 'rookie_prospects',
    'team_email_map', 'trade_messages', 'trade_offers', 'trade_threads', 'watchlist'
  )
ORDER BY table_name, ordinal_position;

-- Private/team and server-managed relations are only accessed by authenticated
-- Next.js handlers using the service role. Removing Data API privileges closes
-- both no-RLS tables and accidentally permissive policies without changing data.
REVOKE ALL ON ALL TABLES IN SCHEMA public FROM anon, authenticated;
REVOKE ALL ON ALL SEQUENCES IN SCHEMA public FROM anon, authenticated;
REVOKE ALL ON TABLE
  public.active_teams,
  public.cfc_big_board_rankings,
  public.cfc_big_board_stars,
  public.cfc_big_board_tiers,
  public.cfc_director_memos,
  public.cfc_studio_offer_feedback,
  public.cfc_team_manual_value_overrides,
  public.cfc_team_player_attachment,
  public.cfc_team_player_value_overrides,
  public.cfc_team_strategy_profiles,
  public.cfc_trade_passes,
  public.team_email_map,
  public.trade_messages,
  public.trade_offers,
  public.trade_threads,
  public.watchlist
FROM anon, authenticated;

-- Draft room clients use Supabase Auth + Realtime directly. Replace the verified
-- public-true policies with league-membership policies and least privileges.
DROP POLICY IF EXISTS "Allow all access to draft_log" ON public.draft_log;
DROP POLICY IF EXISTS "Allow all access to draft_state" ON public.draft_state;
DROP POLICY IF EXISTS "Allow all access to rookie_prospects" ON public.rookie_prospects;
DROP POLICY IF EXISTS "allow all (temp)" ON public.trade_messages;
DROP POLICY IF EXISTS msgs_insert_all ON public.trade_messages;
DROP POLICY IF EXISTS msgs_select_all ON public.trade_messages;

ALTER TABLE public.draft_log ENABLE ROW LEVEL SECURITY;
ALTER TABLE public.draft_log FORCE ROW LEVEL SECURITY;
ALTER TABLE public.draft_state ENABLE ROW LEVEL SECURITY;
ALTER TABLE public.draft_state FORCE ROW LEVEL SECURITY;
ALTER TABLE public.rookie_prospects ENABLE ROW LEVEL SECURITY;
ALTER TABLE public.rookie_prospects FORCE ROW LEVEL SECURITY;

DROP POLICY IF EXISTS draft_log_league_member ON public.draft_log;
CREATE POLICY draft_log_league_member ON public.draft_log
  FOR ALL TO authenticated
  USING (EXISTS (
    SELECT 1 FROM public.league_memberships m
    WHERE m.user_id = (SELECT auth.uid()) AND m.league_id = draft_log.league_id
  ))
  WITH CHECK (EXISTS (
    SELECT 1 FROM public.league_memberships m
    WHERE m.user_id = (SELECT auth.uid()) AND m.league_id = draft_log.league_id
  ));

DROP POLICY IF EXISTS draft_state_league_member ON public.draft_state;
CREATE POLICY draft_state_league_member ON public.draft_state
  FOR ALL TO authenticated
  USING (EXISTS (
    SELECT 1 FROM public.league_memberships m
    WHERE m.user_id = (SELECT auth.uid()) AND m.league_id = draft_state.league_id
  ))
  WITH CHECK (EXISTS (
    SELECT 1 FROM public.league_memberships m
    WHERE m.user_id = (SELECT auth.uid()) AND m.league_id = draft_state.league_id
  ));

DROP POLICY IF EXISTS rookie_prospects_authenticated_read ON public.rookie_prospects;
CREATE POLICY rookie_prospects_authenticated_read ON public.rookie_prospects
  FOR SELECT TO authenticated USING (true);

REVOKE ALL ON public.draft_log, public.draft_state, public.rookie_prospects FROM anon, authenticated;
GRANT SELECT, INSERT, UPDATE, DELETE ON public.draft_log, public.draft_state TO authenticated;
GRANT SELECT ON public.rookie_prospects TO authenticated;
GRANT SELECT ON public.league_memberships TO authenticated;

-- The 29 confirmed postgres-owned views are security-definer under the current
-- defaults. Deny direct API access pending definition/dependency review.
REVOKE ALL ON TABLE
  public.cfc_trade_values_current, public.ff_draft_picks_startup_v,
  public.slp_best_championship_performers, public.slp_best_conference_final_performers,
  public.slp_best_playoff_players, public.slp_biggest_playoff_bench_mistakes,
  public.slp_championship_starters, public.slp_lineup_shape_performance,
  public.slp_lineup_shapes, public.slp_most_common_championship_players,
  public.slp_most_traded_players, public.slp_player_career_totals,
  public.slp_player_franchise_profile, public.slp_player_playoff_summary,
  public.slp_player_profile_summary, public.slp_player_season_totals,
  public.slp_player_start_summary, public.slp_player_transaction_summary,
  public.slp_players_catalog_normalized_v, public.slp_players_most_teams,
  public.slp_playoff_team_performance, public.slp_playoff_true_games,
  public.slp_roster_team_names, public.slp_starter_game_log,
  public.slp_team_championship_history, public.slp_team_game_log,
  public.slp_team_season_summary, public.slp_weekly_high_scores,
  public.slp_worst_championship_bench_mistakes
FROM authenticated;

-- Functions remain server-only until each callable contract is reviewed.
REVOKE EXECUTE ON ALL FUNCTIONS IN SCHEMA public FROM PUBLIC, anon, authenticated;
GRANT EXECUTE ON ALL FUNCTIONS IN SCHEMA public TO service_role;

COMMIT;

-- Validation: no private relation privileges, no public-true policies, and no
-- anon/authenticated execution grants should be returned.
SELECT grantee, table_name, privilege_type
FROM information_schema.role_table_grants
WHERE table_schema = 'public' AND grantee IN ('anon', 'authenticated')
  AND table_name IN ('team_email_map','trade_threads','trade_offers','trade_messages',
    'watchlist','cfc_director_memos','cfc_team_strategy_profiles',
    'cfc_team_player_attachment','cfc_team_player_value_overrides','cfc_trade_passes')
ORDER BY table_name, grantee, privilege_type;
SELECT schemaname, tablename, policyname, roles, cmd, qual, with_check
FROM pg_policies WHERE schemaname = 'public' ORDER BY tablename, policyname;
SELECT routine_name, grantee, privilege_type
FROM information_schema.role_routine_grants
WHERE specific_schema = 'public' AND grantee IN ('anon','authenticated')
ORDER BY routine_name, grantee;
