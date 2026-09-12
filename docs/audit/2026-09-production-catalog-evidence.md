# Production catalog evidence — 2026-09-12

This is a sanitized record of catalog-only `SELECT` results supplied by the
coordinator. The transaction was read-only; it did not inspect private rows or
change production.

## Exact relation findings

The fifteen legacy `league_*` history candidates and
`cfc_value_upload_staging` are absent. Cleanup scripts must not recreate,
rename, or drop them.

The existing candidates are `flea_raw_global`, `flea_raw_smoke`,
`mfl_raw_global`, `mfl_raw_smoke`, `slp_raw_global`, `slp_raw_smoke`, and
`watchlist`. Their captured `pg_total_relation_size` values were respectively
66,347,008; 65,536; 499,712; 32,768; 3,194,880; 868,352; and 40,960 bytes.
Catalog `n_live_tup` values (estimates, **not exact counts**) were 2,287; 13;
26; 4; 1; 144; and 0. An estimated zero does not establish emptiness.

Flea/MFL global tables each have a `smoke_id` foreign key to their matching
smoke table with `ON DELETE SET NULL`. None of the seven candidates has a user
trigger. No matching public ordinary function or installed `pg_cron`/`pgagent`
was found. External or dynamic Historian jobs remain unverified.

## Dependencies that prohibit deletion

`slp_raw_smoke` directly feeds `slp_playoff_true_games` and
`slp_roster_team_names`. Its transitive view dependency set contains sixteen
views, including championship, starter-game-log, team-history, profile,
transaction, and weekly-high-score products. It is therefore retained.

## Confirmed persisted key columns

The catalog confirmed text keys in `cfc_asset_calculations.asset_key`,
`cfc_asset_source_values.asset_key`, `cfc_assets.asset_key`,
`cfc_team_draft_class_strength.pick_key`,
`cfc_team_manual_value_overrides.asset_key`, and `watchlist.asset_key`.
`cfc_trade_values_current` is a view exposing nullable `asset_id` and
`asset_key`; migration 018 updates its confirmed base relations rather than
attempting to mutate the view. JSON key discovery is separately represented by
the confirmed `trade_offers.assets_from/assets_to` migration.

## Remaining proof gates

Exact row counts/checksums, external job ownership, a successful isolated
restore, storage-object recovery, and destructive approval remain outstanding.
Both existing Supabase projects are production applications and are prohibited
as restore targets. The proposed temporary physical-backup clone remains
unapproved and was not created.
