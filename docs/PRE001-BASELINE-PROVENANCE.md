# Clean-database baseline provenance

`supabase/baseline/pre001_clean_database.sql` is used only by disposable CI.
It is copied temporarily to migration version `000`, removed after the test, and
is not part of linked production migration history. Never apply it to an existing
database.

## Evidence classification

The trade, canonical-value, and fantasy-master definitions were transcribed on
2026-09-12 from three saved SQL editor artifacts in the authorized production
project. The UI did not expose when they were created or whether/when the full
scripts ran. They are therefore **saved source definitions**, not a dated schema
snapshot. Destructive reset/drop, seed, and invocation sections were intentionally
excluded.

The minimal pre-005 draft tables and pre-011 strategy table are reconstructed from
the verified live catalog by removing only columns/indexes introduced by checked-in
migrations 005-008 and 011. `picks_sell_move` is retained because it exists in the
verified live table but is not introduced by 011; this is an explicit conservative
assumption, not a claim about its creation date.

## Reconciliations

- Migration 001's `trade_messages.offer_id` is backed by the saved trade source.
- Migrations 002/003 are normalized to the saved canonical value schema: they no
  longer invent calculation columns or insert into `cfc_trade_values_current`, which
  the saved source and live catalog both identify as a view.
- Migration 004 uses saved source-map columns `platform` and `source_roster_id`.
  Actual draft-result rebuild rows leave original/current ownership null; only the
  selecting franchise is populated.
- The generated version `000` is explicitly rejected by repository validation if
  committed. Production remains at recorded history 001-011 and receives only
  reviewed pending migrations 012 onward.

## Test boundary

The baseline is reviewable but has not been executed in this container because it
has neither Docker nor the Supabase CLI. GitHub CI must prove start/reset, migration
application, database lint, pgTAP authorization, alert-claim denial/deduplication,
and concurrent AI budget behavior before rollout approval.

## Director memo compatibility boundary

The verified current `cfc_director_memos` table has `team_id` but no `league_id`.
Handlers now require a current signed membership, require the configured league to
match the session, and filter every memo UUID/list/update by the caller's own roster.
This safely enforces the existing single-league deployment but is not a durable
multi-league schema: roster identifiers must not be assumed globally unique.

Before enabling a second league, add `league_id`, abort unless every existing memo
can be assigned unambiguously from reviewed league/team metadata, change indexes to
include `(league_id, team_id)`, and make every memo query/write filter both fields.
That later migration must be ordered after security migration 015 and coordinated
with the app; it is intentionally not guessed or backfilled here.
