# Sleeper Draft Results Sync Runbook

## First sync
1. Run migration `supabase/migrations/004_sleeper_draft_results_sync.sql`.
2. Trigger sync route:
   - `POST /api/admin/ingest/sleeper-draft-results` with header
     `Authorization: Bearer <ADMIN_SECRET>`
   - Empty body will sync 2024 + 2025 known leagues.
3. The route rebuilds `ff_master_draft_picks` after every successful mirror sync.
4. Run validation queries from the migration.

## Re-sync (same seasons)
1. Trigger the same POST route again (idempotent upsert on `draft_id,pick_number`).
2. Re-run validation queries. The rebuild is part of the route transaction flow.

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

## Automation

Vercel calls the same route daily at 08:30 UTC with `CRON_SECRET`. In addition
to the two historical league ids, it syncs the configured current league id and
the current CFC season. Keep `NEXT_PUBLIC_SLEEPER_LEAGUE_ID` unchanged until a
coordinated season rollover. The cron endpoint has write side effects and must
never be used as a health check.
