-- Draft pipeline validation script (post-repair)
-- Proves mappings improved, 2019 classification exists, and draft->lineup joins are sane.

-- 0) Live schema inspection
SELECT table_schema, table_name, column_name, data_type
FROM information_schema.columns
WHERE (table_schema, table_name) IN (
  ('public', 'ff_master_draft_picks'),
  ('public', 'ff_draft_season_flags'),
  ('public', 'ff_source_player_map'),
  ('public', 'ff_draft_player_mapping_backfill_log'),
  ('llm', 'draft_picks'),
  ('llm', 'draft_picks_rookie_only'),
  ('llm', 'lineup_entries')
)
ORDER BY table_schema, table_name, ordinal_position;

-- 1) 2019 classification is present and rookie-only surface excludes it
SELECT *
FROM public.ff_draft_season_flags
WHERE draft_year = 2019;

SELECT
  COUNT(*) FILTER (WHERE season_year = 2019) AS llm_draft_picks_2019_rows
FROM llm.draft_picks;

SELECT
  COUNT(*) FILTER (WHERE season_year = 2019) AS rookie_only_2019_rows
FROM llm.draft_picks_rookie_only;

-- 2) Completeness checks by season
SELECT
  season_year,
  COUNT(*) AS total_rows,
  COUNT(*) FILTER (WHERE selected_player_id IS NULL) AS missing_selected_player_id,
  COUNT(*) FILTER (WHERE NULLIF(BTRIM(COALESCE(selected_player_name, '')), '') IS NULL) AS missing_selected_player_name
FROM llm.draft_picks
GROUP BY season_year
ORDER BY season_year;

-- 3) Sleeper source mapping coverage
WITH sleeper_ids AS (
  SELECT DISTINCT source_player_id
  FROM public.slp_mirror_draft_results
  WHERE source_player_id IS NOT NULL
)
SELECT
  COUNT(*) AS sleeper_distinct_source_player_ids,
  COUNT(*) FILTER (
    WHERE EXISTS (
      SELECT 1
      FROM public.ff_source_player_map spm
      WHERE LOWER(spm.source_platform) = 'sleeper'
        AND spm.source_player_id = s.source_player_id
    )
  ) AS mapped_source_player_ids,
  COUNT(*) FILTER (
    WHERE NOT EXISTS (
      SELECT 1
      FROM public.ff_source_player_map spm
      WHERE LOWER(spm.source_platform) = 'sleeper'
        AND spm.source_player_id = s.source_player_id
    )
  ) AS unmapped_source_player_ids
FROM sleeper_ids s;

-- 4) Draft-pick -> lineup-entry join quality
WITH pick_lineup AS (
  SELECT
    dp.draft_pick_id,
    dp.season_year,
    dp.selected_player_id,
    COUNT(le.*) AS lineup_rows,
    COUNT(*) FILTER (WHERE le.is_starter) AS starter_rows,
    COALESCE(SUM(CASE WHEN le.is_starter THEN le.points ELSE 0 END), 0) AS started_points
  FROM llm.draft_picks dp
  LEFT JOIN llm.lineup_entries le
    ON le.player_id = dp.selected_player_id
  GROUP BY dp.draft_pick_id, dp.season_year, dp.selected_player_id
)
SELECT
  season_year,
  COUNT(*) AS draft_picks,
  COUNT(*) FILTER (WHERE selected_player_id IS NULL) AS picks_missing_player_id,
  COUNT(*) FILTER (WHERE selected_player_id IS NOT NULL AND lineup_rows = 0) AS mapped_with_no_lineup_rows,
  COUNT(*) FILTER (WHERE selected_player_id IS NOT NULL AND starter_rows = 0) AS mapped_with_no_starter_rows,
  COUNT(*) FILTER (WHERE selected_player_id IS NOT NULL AND starter_rows > 0 AND started_points = 0) AS mapped_with_starters_but_zero_points
FROM pick_lineup
GROUP BY season_year
ORDER BY season_year;

-- 5) Backfill log summary
SELECT
  decision,
  confidence,
  COUNT(*) AS rows_logged,
  MIN(decided_at) AS first_seen,
  MAX(decided_at) AS last_seen
FROM public.ff_draft_player_mapping_backfill_log
GROUP BY decision, confidence
ORDER BY confidence DESC, decision;

-- 6) Spot-check suspicious mapped cases that still need manual review
WITH pick_lineup AS (
  SELECT
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
  WHERE dp.selected_player_id IS NOT NULL
  GROUP BY dp.season_year, dp.round, dp.pick_number, dp.selected_player_id, dp.selected_player_name
)
SELECT *
FROM pick_lineup
WHERE lineup_rows = 0 OR starter_rows = 0 OR started_points = 0
ORDER BY season_year, round, pick_number
LIMIT 100;

-- 7) Amon-Ra focused validation (if present in llm.players)
WITH target AS (
  SELECT player_id, player_name
  FROM llm.players
  WHERE LOWER(player_name) LIKE '%amon-ra%'
),
lineup_rollup AS (
  SELECT
    le.player_id,
    COUNT(*) AS lineup_rows,
    COUNT(*) FILTER (WHERE le.is_starter) AS starter_rows,
    COALESCE(SUM(CASE WHEN le.is_starter THEN le.points ELSE 0 END), 0) AS started_points
  FROM llm.lineup_entries le
  JOIN target t ON t.player_id = le.player_id
  GROUP BY le.player_id
)
SELECT
  t.player_id,
  t.player_name,
  dp.season_year AS drafted_season,
  dp.round,
  dp.pick_number,
  COALESCE(lr.lineup_rows, 0) AS lineup_rows,
  COALESCE(lr.starter_rows, 0) AS starter_rows,
  COALESCE(lr.started_points, 0) AS started_points
FROM target t
LEFT JOIN llm.draft_picks dp
  ON dp.selected_player_id = t.player_id
LEFT JOIN lineup_rollup lr
  ON lr.player_id = t.player_id
ORDER BY drafted_season NULLS LAST;
