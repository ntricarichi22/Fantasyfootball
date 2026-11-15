# Backup and recovery runbook

## Verified state: 2026-11-15 UTC

Read-only inspection of production Supabase (`owkxkpkdffhcordlxqte`) showed seven
scheduled **physical** backups, November 8–14. The newest displayed backup was
**2026-11-14 11:25:58 UTC**; the oldest was **2026-11-08 11:21:04 UTC**. These dates
are observed evidence, not a retention guarantee or proof of restoration. The PITR
page offered an add-on: **PITR is not enabled**. No backup was downloaded, restored
or changed. Production reports PostgreSQL `17.6.1.063`.

The dashboard and [Supabase documentation](https://supabase.com/docs/guides/platform/backups)
explicitly exclude **Storage object bytes**. Database backups include their metadata,
not deleted logo/player-image files. Independent object-copy coverage remains unverified.
Daily backup availability does not establish a one-hour live-draft recovery point or
measured recovery time. No paid PITR, new project or standing staging database is part
of this work. The owner selected temporary CI databases only.

## Metadata checks

Dispatch `Operations monitoring` from `main` with `cloud_metadata=true`, then follow
the existing `supabase-production` environment approval. Its management credential is
used only for the fixed production project, GET backup metadata and POST database
queries with `read_only:true`. Release reviewers remain required. Automatic cloud
metadata checks need a future dedicated read-only credential; they are not active.

The standalone command is:

```bash
PROJECT_REF=owkxkpkdffhcordlxqte BACKUP_MAX_AGE_HOURS=30 \
  node scripts/recovery/verify-backup-metadata.mjs
```

Supply `SUPABASE_ACCESS_TOKEN` through a private environment/secret manager, never
a command-line argument. The checker bounds time and response size and prints only
allowlisted dates, counts, enablement flags and failure codes. It accepts completed
backups or the documented physical recovery window. Pending/failed entries alone
cannot pass; missing, stale, malformed and future-dated evidence fails.
Thirty hours allows daily scheduling delay: it is an alert threshold, **not** an RPO.
If PITR is enabled later, an old recovery point requires review because an idle database
can legitimately produce no new WAL. See the [Management API](https://supabase.com/docs/reference/api/v1-list-all-backups).

GitHub failures provide an operator-visible signal. Native notification delivery,
recipients and acknowledgement remain unverified. These scripts send no emails,
webhooks, issue comments or third-party messages.

## Recovery inventory

| Component | Recovery source | Verification and remaining gap |
| --- | --- | --- |
| Application data, Auth, ownership/commands, audit logs | Hosted physical database backup | Availability observed; real production restore not exercised |
| RLS, grants, functions, constraints and migration history | Same backup plus reviewed source/hosted alias map | Manifest checks definitions and privileges; never rewrite history blindly |
| Storage metadata | Database backup | Metadata does not recover object bytes |
| `Players` and `team-logos` bytes | Independent object backup/versioning | Mechanism, retention and recovery remain unverified |
| Custom role credentials | Private secret manager/reviewed rotation | Daily backups omit custom-role passwords; never put them in drill records |
| Vercel environment, release, host retirement and cron | Private hosting configuration plus source/runbooks | Reconcile scope and deploy an RPC-compatible release before resuming writes |
| Supabase functions and scheduled jobs | Versioned sources and approved configuration | Disable outbound jobs in a real isolated restore; verify authentication before resuming |
| Provider billing and side effects | Provider records/idempotent reconciliation | Do not replay emails, charges or AI requests after rollback |

## Temporary CI restore exercise

The shared staging rehearsal creates the reviewed baseline and migrations in a
disposable local Supabase stack. `scripts/recovery/exercise-synthetic-restore.mjs`
reuses the load-test fixture helper: real local GoTrue sessions, a three-team league,
canonical ownership and an accepted synthetic trade. It makes a logical `pg_dump`,
restores into a separate database in the **same disposable Docker cluster**, and checks:

- The existing read-only metadata manifest, extended with function/owner/ACL, RLS,
  policy signatures and the private runtime schema.
- Exact synthetic ownership, slot, command, trade/thread and pending-state hashes.
- Browser command denial, service direct-write denial and restored session validity.
- Removal of the second database, temporary dump and synthetic source accounts.

The driver accepts no source/target database URL: it is fixed to the disposable
loopback stack and requires `RECOVERY_SYNTHETIC_CONFIRM=DISPOSABLE-LOCAL-ONLY` and an
exact reviewed commit. Container PostgreSQL tools match the server. No dump artifact,
tokens or application rows are uploaded. The workflow destroys the stack after failure.

This is a **synthetic logical round trip**, not a production-backup restore, not a
new-cluster/global-role recovery test, and not Storage-byte recovery. Its duration is
not production RTO and provides no measured production RPO. Record the actual hosted
CI run before calling the exercise verified.

## Real incident or separately authorized production-backup drill

1. Preserve evidence; stop writes/outbound jobs when appropriate. Select the last good
   database recovery point and independent Storage recovery point.
2. Record target, operator, cost if any, side-effect isolation and cleanup deadline in
   `docs/templates/RESTORE-DRILL-RECORD.md`. A hosted restore is separate from CI-only
   authorization. Never restore over production to test.
3. Run `scripts/recovery/preflight-drill.sh` with the reviewed protected-project
   denylist and disposable-target declaration. It does not provision or restore.
4. Follow the current supported Supabase restore procedure for the backup type.
   Isolate mail, cron, replication and provider integrations. Review custom-role
   passwords and replication slots before restarting services.
5. Restore independent Storage bytes. Compare aggregate counts and an approved
   synthetic object without printing private names, signed URLs or content.
6. Compare manifests with private read-only credentials:

   ```bash
   SOURCE_DATABASE_URL='postgresql://…?sslmode=require' \
   TARGET_DATABASE_URL='postgresql://…?sslmode=require' \
   RECOVERY_TARGET_CONFIRM=DISPOSABLE-NONPRODUCTION \
     ./scripts/recovery/validate-restore.sh
   ```

   Source and target must be distinct. Exact totals require a quiescent source or a
   baseline at the selected recovery point; live counts cannot validate an older backup.
   Keep restricted evidence outside Git/project folders. A timeout is incomplete evidence.
7. Verify Auth/session revocation, tenant access, restored files and synthetic draft/
   trade commands only in isolation. Reconcile hosted migration aliases. Resume only
   an RPC-compatible app; never restore legacy direct-write grants.
8. Record data-loss interval and full recovery time, then remove/reset the authorized
   target. Database-only success is incomplete without Storage/external reconciliation.
