-- Draft pipeline diagnostic (read-only)
-- Purpose: quantify mapping gaps, isolate 2019 startup rows, and test draft-pick -> lineup joins.

-- 0) Live schema inspection (required first step)
SELECT table_schema, table_name, column_name, data_type
FROM information_schema.columns
WHERE (table_schema, table_name) IN (
  ('public', 'ff_master_draft_picks'),
  ('public', 'slp_mirror_draft_results'),
  ('public', 'ff_source_player_map'),
  ('public', 'ff_source_franchise_map'),
  ('llm', 'draft_picks'),
  ('llm', 'lineup_entries'),
  ('llm', 'players')
)
ORDER BY table_schema, table_name, ordinal_position;

-- 1) Data completeness: ff_master_draft_picks by season+round
-- Uses to_jsonb to avoid hard-failing if selected_player_name is absent in this table.
SELECT
  dp.draft_year AS season_year,
  dp.round,
  COUNT(*) AS total_rows,
  COUNT(*) FILTER (
    WHERE NULLIF(BTRIM(COALESCE(to_jsonb(dp) ->> 'selected_player_id', '')), '') IS NULL
  ) AS missing_selected_player_id,
  COUNT(*) FILTER (
    WHERE NULLIF(BTRIM(COALESCE(to_jsonb(dp) ->> 'selected_player_name', '')), '') IS NULL
  ) AS missing_selected_player_name,
  COUNT(*) FILTER (
    WHERE dp.draft_year = 2019
  ) AS startup_2019_rows
FROM public.ff_master_draft_picks dp
GROUP BY dp.draft_year, dp.round
ORDER BY dp.draft_year, dp.round;

-- 2) Data completeness: llm.draft_picks by season+round
SELECT
  dp.season_year,
  dp.round,
  COUNT(*) AS total_rows,
  COUNT(*) FILTER (
    WHERE NULLIF(BTRIM(COALESCE(to_jsonb(dp) ->> 'selected_player_id', '')), '') IS NULL
  ) AS missing_selected_player_id,
  COUNT(*) FILTER (
    WHERE NULLIF(BTRIM(COALESCE(to_jsonb(dp) ->> 'selected_player_name', '')), '') IS NULL
  ) AS missing_selected_player_name,
  COUNT(*) FILTER (
    WHERE dp.season_year = 2019
  ) AS startup_2019_rows
FROM llm.draft_picks dp
GROUP BY dp.season_year, dp.round
ORDER BY dp.season_year, dp.round;

-- 3) 2019 isolation and platform shape in canonical table
SELECT
  draft_year,
  COALESCE(source_platform, 'unknown') AS source_platform,
  COUNT(*) AS row_count,
  COUNT(*) FILTER (WHERE selected_player_id IS NULL) AS missing_selected_player_id
FROM public.ff_master_draft_picks
WHERE draft_year = 2019
GROUP BY draft_year, COALESCE(source_platform, 'unknown')
ORDER BY source_platform;

-- 4) Sleeper mapping integrity from mirror -> canonical maps
WITH sleeper_src AS (
  SELECT DISTINCT
    sdr.season_year,
    sdr.source_league_id,
    sdr.draft_id,
    sdr.pick_number,
    sdr.round,
    sdr.roster_id,
    sdr.source_player_id,
    COALESCE(
      NULLIF(BTRIM(sdr.metadata_json ->> 'full_name'), ''),
      NULLIF(BTRIM(CONCAT_WS(' ', sdr.metadata_json ->> 'first_name', sdr.metadata_json ->> 'last_name')), ''),
      NULLIF(BTRIM(sdr.metadata_json ->> 'player_name'), '')
    ) AS drafted_player_name
  FROM public.slp_mirror_draft_results sdr
  WHERE sdr.pick_number IS NOT NULL
),
joined AS (
  SELECT
    s.*,
    sfm.franchise_id,
    spm.player_id
  FROM sleeper_src s
  LEFT JOIN public.ff_source_franchise_map sfm
    ON LOWER(sfm.source_platform) = 'sleeper'
   AND sfm.source_league_id = s.source_league_id
   AND sfm.source_franchise_id = s.roster_id
  LEFT JOIN public.ff_source_player_map spm
    ON LOWER(spm.source_platform) = 'sleeper'
   AND spm.source_player_id = s.source_player_id
)
SELECT
  season_year,
  COUNT(*) AS sleeper_pick_rows,
  COUNT(*) FILTER (WHERE source_player_id IS NULL) AS missing_source_player_id,
  COUNT(*) FILTER (WHERE franchise_id IS NULL) AS missing_franchise_mapping,
  COUNT(*) FILTER (WHERE player_id IS NULL) AS missing_player_mapping,
  COUNT(*) FILTER (WHERE player_id IS NULL AND drafted_player_name IS NOT NULL) AS unmapped_with_name_hint
FROM joined
GROUP BY season_year
ORDER BY season_year;

-- 5) Join integrity: llm.draft_picks -> llm.lineup_entries on selected_player_id
WITH pick_lineup AS (
  SELECT
    dp.draft_pick_id,
    dp.season_year,
    dp.round,
    dp.pick_number,
    dp.selected_player_id,
    dp.selected_player_name,
    COUNT(le.*) AS lineup_rows,
    COUNT(*) FILTER (WHERE le.is_starter) AS starter_rows,
    COALESCE(SUM(CASE WHEN le.is_starter THEN le.points ELSE 0 END), 0) AS started_points,
    COALESCE(SUM(CASE WHEN le.is_starter AND le.is_playoffs THEN le.points ELSE 0 END), 0) AS playoff_started_points
  FROM llm.draft_picks dp
  LEFT JOIN llm.lineup_entries le
    ON le.player_id = dp.selected_player_id
  GROUP BY
    dp.draft_pick_id,
    dp.season_year,
    dp.round,
    dp.pick_number,
    dp.selected_player_id,
    dp.selected_player_name
)
SELECT
  season_year,
  COUNT(*) AS draft_picks,
  COUNT(*) FILTER (WHERE selected_player_id IS NULL) AS picks_missing_player_id,
  COUNT(*) FILTER (WHERE selected_player_id IS NOT NULL AND lineup_rows = 0) AS mapped_with_no_lineup_rows,
  COUNT(*) FILTER (WHERE selected_player_id IS NOT NULL AND lineup_rows > 0 AND starter_rows = 0) AS mapped_with_no_starter_rows,
  COUNT(*) FILTER (WHERE selected_player_id IS NOT NULL AND starter_rows > 0 AND started_points = 0) AS mapped_with_starters_but_zero_started_points
FROM pick_lineup
GROUP BY season_year
ORDER BY season_year;

-- 6) Suspicious mapped cases for triage (top 100)
WITH pick_lineup AS (
  SELECT
    dp.draft_pick_id,
    dp.season_year,
    dp.round,
    dp.pick_number,
    dp.selected_player_id,
    dp.selected_player_name,
    COUNT(le.*) AS lineup_rows,
    COUNT(*) FILTER (WHERE le.is_starter) AS starter_rows,
    COALESCE(SUM(CASE WHEN le.is_starter THEN le.points ELSE 0 END), 0) AS started_points
  FROM llm.draft_picks dp
  LEFT JOIN llm.lineup_entries le
    ON le.player_id = dp.selected_player_id
  GROUP BY
    dp.draft_pick_id,
    dp.season_year,
    dp.round,
    dp.pick_number,
    dp.selected_player_id,
    dp.selected_player_name
)
SELECT
  season_year,
  round,
  pick_number,
  selected_player_id,
  selected_player_name,
  lineup_rows,
  starter_rows,
  started_points,
  CASE
    WHEN selected_player_id IS NULL THEN 'missing_selected_player_id'
    WHEN lineup_rows = 0 THEN 'mapped_no_lineup_rows'
    WHEN starter_rows = 0 THEN 'mapped_no_starter_rows'
    WHEN started_points = 0 THEN 'mapped_starters_zero_started_points'
    ELSE 'ok'
  END AS suspicion_reason
FROM pick_lineup
WHERE
  selected_player_id IS NULL
  OR lineup_rows = 0
  OR starter_rows = 0
  OR started_points = 0
ORDER BY season_year, round, pick_number
LIMIT 100;

-- 7) Amon-Ra style focused check (name-based probe)
WITH target_players AS (
  SELECT p.player_id, p.player_name
  FROM llm.players p
  WHERE LOWER(p.player_name) LIKE '%amon-ra%'
),
draft_rows AS (
  SELECT dp.*
  FROM llm.draft_picks dp
  JOIN target_players tp ON tp.player_id = dp.selected_player_id
),
lineup_rollup AS (
  SELECT
    le.player_id,
    COUNT(*) AS lineup_rows,
    COUNT(*) FILTER (WHERE le.is_starter) AS starter_rows,
    COALESCE(SUM(CASE WHEN le.is_starter THEN le.points ELSE 0 END), 0) AS started_points
  FROM llm.lineup_entries le
  JOIN target_players tp ON tp.player_id = le.player_id
  GROUP BY le.player_id
)
SELECT
  tp.player_id,
  tp.player_name,
  dr.season_year AS drafted_season,
  dr.round AS drafted_round,
  dr.pick_number AS drafted_pick,
  COALESCE(lr.lineup_rows, 0) AS lineup_rows,
  COALESCE(lr.starter_rows, 0) AS starter_rows,
  COALESCE(lr.started_points, 0) AS started_points
FROM target_players tp
LEFT JOIN draft_rows dr ON dr.selected_player_id = tp.player_id
LEFT JOIN lineup_rollup lr ON lr.player_id = tp.player_id
ORDER BY drafted_season NULLS LAST;
