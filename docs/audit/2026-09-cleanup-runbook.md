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

Blocked evidence: this hosted session has no Supabase/read-only Postgres
configuration, so no live dependency result, row count, archive, rename, drop,
migration, or restore has been performed.
