# CFC Historian Draft Pipeline Audit (2026-03-18)

## 1) Root-cause memo

### What is broken
1. **Draft mapping completeness is inconsistent**: draft rows with missing `selected_player_id` cannot join to lineup history, so started-points rollups collapse to zero.
2. **`selected_player_name` is not guaranteed in canonical path**: current rebuild function in `supabase/migrations/004_sleeper_draft_results_sync.sql` inserts `selected_player_id` but does not populate `selected_player_name` in `ff_master_draft_picks`.
3. **Startup draft year (2019) is not explicitly classified** for historian rookie-draft analysis, so it can leak into rookie-oriented draft answers.
4. **Historian rollup depends entirely on player-id join quality** (`llm.draft_picks.selected_player_id = llm.lineup_entries.player_id`). If IDs are missing/inconsistent, career scores are wrong even if a player name is recognizable.

### Where it is broken
- **Draft ingest (Sleeper)**: `src/app/api/admin/ingest/sleeper-draft-results/route.ts`
- **Canonical rebuild**: `supabase/migrations/004_sleeper_draft_results_sync.sql` (`ff_rebuild_master_draft_picks_actual_results`)
- **Historian draft rollup**: `src/lib/llm/handlers/draftHistory.ts`
- **Historian player rollup**: `src/lib/llm/handlers/playerCareer.ts`

### Data-quality vs code-quality
- **Data-quality issues**
  - Missing/failed player mappings (source player IDs not mapped to canonical player IDs)
  - Unclassified startup year (2019) in rookie-draft analysis surface
  - Possible lineup-entry data gaps for mapped players
- **Code-quality issues**
  - Historian rollup logic currently trusts the join key completely and has no diagnostics/warnings when mapped players produce zero starter points.
  - No explicit rookie-draft view/filter currently used by historian draft queries.

## 2) File/function map

- `src/app/api/admin/ingest/sleeper-draft-results/route.ts`
  - `POST` handler: fetches Sleeper drafts/picks and upserts `slp_mirror_draft_results`
  - `source_player_id` assignment occurs during pick mapping
- `supabase/migrations/004_sleeper_draft_results_sync.sql`
  - creates `slp_mirror_draft_results`
  - defines `public.ff_rebuild_master_draft_picks_actual_results()`
  - maps Sleeper source IDs via `ff_source_franchise_map` and `ff_source_player_map`
- `src/lib/llm/handlers/draftHistory.ts`
  - `getDraftHistoryData`
  - left-joins `llm.draft_picks` to `llm.lineup_entries` on `selected_player_id`
  - aggregates `started_points` only when `is_starter = true`
- `src/lib/llm/handlers/playerCareer.ts`
  - `getPlayerCareerData`
  - draft origin from `llm.draft_picks`; scoring from `llm.lineup_entries`

## 3) Scope decision for 2019

Recommended canonical approach:
- **Keep 2019 in canonical storage** (historical integrity)
- **Classify 2019 as startup/non-rookie** in a dedicated season-flag table
- **Expose a rookie-only historian query surface** (`llm.draft_picks_rookie_only`) that excludes flagged startup years

This avoids deleting canonical history while giving deterministic rookie-draft behavior.

## 4) SQL deliverables in this PR

- Diagnostic script: `/home/runner/work/Fantasyfootball/Fantasyfootball/supabase/scripts/2026-03-18_draft_pipeline_diagnostic.sql`
- Repair script: `/home/runner/work/Fantasyfootball/Fantasyfootball/supabase/scripts/2026-03-18_draft_pipeline_repair.sql`
- Validation script: `/home/runner/work/Fantasyfootball/Fantasyfootball/supabase/scripts/2026-03-18_draft_pipeline_validation.sql`

## 5) Re-test checklist after repair

1. Run diagnostic script and capture baseline counts.
2. Run repair script in a reviewed SQL session (do not skip transaction output review).
3. Run validation script and confirm:
   - 2019 appears in canonical data but `llm.draft_picks_rookie_only` has zero 2019 rows.
   - missing `selected_player_id` counts decrease or are fully explained.
   - mapped picks with `lineup_rows = 0` are reduced and triaged.
4. Ask historian spot checks:
   - “Best/worst round X pick all time”
   - “Who drafted <known mapped player>?”
   - “Best draft class in <rookie year, non-2019>”
5. Amon-Ra sanity check:
   - verify player exists in `llm.players`
   - verify `llm.draft_picks.selected_player_id` is set
   - verify `llm.lineup_entries` starter rows + started points are non-zero when expected

## 6) Code changes

No application code was modified in this audit PR.
Only documentation + SQL scripts were added so the repair path can be reviewed before any production execution.

## 7) Short runbook (first sync + re-sync)

### First sync / first repair run
1. Run diagnostic script:
   - `supabase/scripts/2026-03-18_draft_pipeline_diagnostic.sql`
2. Review baseline output (missing IDs, 2019 row counts, join gaps).
3. Run repair script:
   - `supabase/scripts/2026-03-18_draft_pipeline_repair.sql`
4. Run validation script:
   - `supabase/scripts/2026-03-18_draft_pipeline_validation.sql`
5. Re-run key historian questions and compare against pre-repair answers.

### Re-sync (new Sleeper data landed)
1. Trigger Sleeper draft ingest route:
   - `POST /api/admin/ingest/sleeper-draft-results?secret=<ADMIN_SECRET>`
2. Re-run repair script (safe/rerunnable):
   - `supabase/scripts/2026-03-18_draft_pipeline_repair.sql`
3. Re-run validation script:
   - `supabase/scripts/2026-03-18_draft_pipeline_validation.sql`
4. Re-run draft-history spot checks and confirm no regressions.
