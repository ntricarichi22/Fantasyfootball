# Sleeper Draft Results Sync Runbook

## First sync
1. Run migration `supabase/migrations/004_sleeper_draft_results_sync.sql`.
2. Trigger sync route:
   - `POST /api/admin/ingest/sleeper-draft-results?secret=<ADMIN_SECRET>`
   - Empty body will sync 2024 + 2025 known leagues.
3. Rebuild master picks:
   - `SELECT public.ff_rebuild_master_draft_picks_actual_results();`
4. Run validation queries from the migration.

## Re-sync (same seasons)
1. Trigger the same POST route again (idempotent upsert on `draft_id,pick_number`).
2. Re-run:
   - `SELECT public.ff_rebuild_master_draft_picks_actual_results();`
3. Re-run validation queries.

## Sync a new future Sleeper season
POST body example:
```json
{
  "league_ids": [
    { "season_year": 2026, "source_league_id": "<new_league_id>" }
  ]
}
```
Then run rebuild + validation again.
