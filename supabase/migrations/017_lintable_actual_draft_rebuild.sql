-- Replace the actual-results rebuild without rewriting applied migration 004.
-- The previous runtime temp table was valid at execution time but invisible to
-- plpgsql_check's static dependency analysis.
SELECT table_name, column_name, data_type
FROM information_schema.columns
WHERE table_schema = 'public'
  AND table_name IN ('ff_master_draft_picks', 'ff_source_franchise_map',
    'ff_source_player_map', 'slp_mirror_draft_results')
ORDER BY table_name, ordinal_position;

CREATE OR REPLACE FUNCTION public.ff_rebuild_master_draft_picks_actual_results()
RETURNS void
LANGUAGE plpgsql
SET search_path = public
AS $$
DECLARE missing_columns text;
BEGIN
  WITH required AS (
    SELECT * FROM (VALUES
      ('ff_master_draft_picks', 'draft_year'), ('ff_master_draft_picks', 'round'),
      ('ff_master_draft_picks', 'pick_number'), ('ff_master_draft_picks', 'selected_by_franchise_id'),
      ('ff_master_draft_picks', 'selected_player_id'), ('ff_master_draft_picks', 'original_franchise_id'),
      ('ff_master_draft_picks', 'current_franchise_id'), ('ff_master_draft_picks', 'source_platform'),
      ('ff_source_franchise_map', 'platform'), ('ff_source_franchise_map', 'source_league_id'),
      ('ff_source_franchise_map', 'source_roster_id'), ('ff_source_franchise_map', 'franchise_id'),
      ('ff_source_player_map', 'platform'), ('ff_source_player_map', 'source_player_id'),
      ('ff_source_player_map', 'player_id')
    ) AS t(table_name, column_name)
  ), found AS (
    SELECT table_name, column_name FROM information_schema.columns
    WHERE table_schema='public' AND table_name IN
      ('ff_master_draft_picks','ff_source_franchise_map','ff_source_player_map')
  )
  SELECT string_agg(required.table_name || '.' || required.column_name, ', ')
  INTO missing_columns FROM required LEFT JOIN found USING (table_name,column_name)
  WHERE found.column_name IS NULL;
  IF missing_columns IS NOT NULL THEN
    RAISE EXCEPTION 'Cannot rebuild ff_master_draft_picks. Missing required columns: %', missing_columns;
  END IF;

  -- Preserve Flea and MFL actual results; replace only the derived Sleeper slice.
  DELETE FROM public.ff_master_draft_picks WHERE lower(source_platform)='sleeper';
  INSERT INTO public.ff_master_draft_picks (
    draft_year,round,pick_number,selected_by_franchise_id,selected_player_id,
    original_franchise_id,current_franchise_id,source_platform
  )
  SELECT sdr.season_year,sdr.round,sdr.pick_number,sfm.franchise_id,spm.player_id,
    NULL::uuid,NULL::uuid,'sleeper'::text
  FROM public.slp_mirror_draft_results sdr
  JOIN public.ff_source_franchise_map sfm
    ON lower(sfm.platform)='sleeper'
   AND sfm.source_league_id=sdr.source_league_id
   AND sfm.source_roster_id=sdr.roster_id
  JOIN public.ff_source_player_map spm
    ON lower(spm.platform)='sleeper' AND spm.source_player_id=sdr.source_player_id
  WHERE sdr.pick_number IS NOT NULL;
END;
$$;

REVOKE ALL ON FUNCTION public.ff_rebuild_master_draft_picks_actual_results()
  FROM PUBLIC, anon, authenticated;
GRANT EXECUTE ON FUNCTION public.ff_rebuild_master_draft_picks_actual_results()
  TO service_role;
