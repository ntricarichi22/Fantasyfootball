# Archive-first database cleanup runbook

No cleanup SQL is authorized for production in this PR. Security owns migration
numbers 012–017; the first future cleanup migration is 018.

1. Run `scripts/database/cleanup-inventory.sql` through a read-only production
   connection. Save its metadata-only output as review evidence.
2. Separately inventory `cron.job` only when the first result confirms `pg_cron`.
   Confirm external Historian jobs with the owner; SQL cannot discover them.
3. Take and verify a scoped `pg_dump` for every candidate. Record checksums,
   restore it into a disposable database, and run row-count comparisons.
4. Prepare migration 018 as a reversible soft rename only for candidates with
   zero view/function/FK/trigger/job/application dependencies. Wait two weeks.
5. Prepare deletion in a later, separate destructive PR. Never bundle it with
   app rollout. Rerun the inventory and restore drill immediately beforehand.

`scripts/database/archive-cleanup-candidates.sh` creates the custom-format
archive, manifest and SHA-256 files. `proposed-cleanup-soft-rename.sql` and
`proposed-cleanup-deletion.sql` are fail-closed review artifacts: neither
contains an executable candidate mutation. Exact production row counts,
dependency OIDs, `pg_cron` jobs, external Historian build ownership, and a safe
isolated restore target remain required. The existing `cfc_owner_meeting`
project is active production infrastructure and is not a restore target.

Blocked evidence: this hosted session has no Supabase/read-only Postgres
configuration, so no live dependency result, row count, archive, rename, drop,
migration, or restore has been performed.

## Confirmed production catalog evidence

The sanitized 2026-09-12 result is recorded in
`2026-09-production-catalog-evidence.md`. Absent relations are excluded from
any action list, and `slp_raw_smoke` is retained because its direct and
transitive view dependencies are live. Catalog row figures are estimates, not
emptiness proof.
