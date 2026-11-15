# Backup and recovery runbook

## Verified state: 2026-11-15 UTC

Read-only inspection of production Supabase (`owkxkpkdffhcordlxqte`) showed eight
scheduled **physical** backups, November 8–15. The newest displayed backup was
**2026-11-15 11:25:40 UTC**; the oldest was **2026-11-08 11:21:04 UTC**. These dates
are observed evidence, not a retention guarantee or proof of restoration. The PITR
page offered an add-on: **PITR is not enabled**. No backup was downloaded, restored
or changed. Production reports PostgreSQL `17.6.1.063`.

The dashboard and [Supabase documentation](https://supabase.com/docs/guides/platform/backups)
explicitly exclude **Storage object bytes**. Database backups include their metadata,
not deleted logo/player-image files. Independent object-copy coverage remains unverified.
Daily backup availability does not establish a one-hour live-draft recovery point or
measured recovery time. The owner subsequently authorized a temporary hosted recovery
and separate synthetic load drill, with **$2 total cost cap and deletion within four
hours**. No standing staging database or paid PITR is authorized.

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
| Custom role credentials | Private secret manager/reviewed rotation | Physical PGDATA includes role catalogs; do not assume copied credentials are unusable. Disable custom LOGIN roles in the clone; never put passwords in drill records |
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

The local restore uses the verified cluster administrator to preserve managed object
owners. It restores every archive entry exactly once. Supabase's GraphQL wrapper is
an extension member created by a platform hook, so `pg_dump` omits its definition.
The driver captures that exact source definition, owner and extension membership,
restores it between the archive's schema/extension entries and all remaining entries,
then compares its definition, owner, privileges and membership. No platform function
body is maintained separately, and no archive ACLs or objects are skipped. This
exercise therefore verifies the archive **plus this captured platform metadata**.

The driver accepts no source/target database URL: it is fixed to the disposable
loopback stack and requires `RECOVERY_SYNTHETIC_CONFIRM=DISPOSABLE-LOCAL-ONLY` and an
exact reviewed commit. Container PostgreSQL tools match the server. No dump artifact,
tokens or application rows are uploaded. The workflow destroys the stack after failure.

This is a **synthetic logical round trip**, not a production-backup restore, not a
new-cluster/global-role recovery test, and not Storage-byte recovery. Its duration is
not production RTO and provides no measured production RPO. Record the actual hosted
CI run before calling the exercise verified.

## Real incident or separately authorized production-backup drill

### Prepared hosted physical-backup drill

Supabase supports [Restore to a new project](https://supabase.com/docs/guides/platform/clone-project)
for this existing physical backup without enabling PITR. The reviewed Dashboard
dialog creates a separate project in the same organization/region and copies Micro
compute with a 1.5× disk increase (8 GB → 12 GB). It quotes **$9.68/month compute +
$0.50/month disk** if retained. At the published hourly rates, four rounded hours
are approximately **$0.057 before tax/egress**; the actual bill remains provider usage.
Do not disable the organization spend cap. Delete the named temporary project within
four hours; pausing is not the cleanup criterion.

The clone starts database extensions immediately. The source was inspected before
preparing this drill: one active cron (`0,15,30 13,14 * * 3`) calls
`league_sync.enqueue(true)`; its HTTP destination is the production
`sleeper-weekly-sync` function. That endpoint checks a source-side queued one-time
token before doing work, so a clone-generated token cannot authorize source work.
This remains a copied outbound integration to quarantine, not an isolation mechanism.
There are no foreign servers, subscriptions, network-calling triggers, Vault secrets
or queued HTTP requests. The custom LOGIN role is `llm_reader`. Reinspect if these
facts change. Provision only outside Wednesday 12:00–16:00 UTC and ensure the complete
four-hour window does not overlap it; the runner enforces that window.

Before cloning, merge and test the protected manual workflow and confirm an operator
can dispatch it immediately. Select the exact completed backup above in **Restore
to a new project**, never the in-place restore. Record the Dashboard source project,
selected backup, new project creation time and completed-restore evidence. The public
Management API provides no documented clone-source proof; an explicit operator
Dashboard attestation is required, never inferred from the new project's name.

Run `node scripts/recovery/run-hosted-recovery.mjs` from the reviewed `main` workflow
with its protected environment token. Prefer `RECOVERY_OPERATION=drill`: quarantine,
validate, fresh Storage round-trip, then delete the exact target after success **or
failure** and confirm its absence. `quarantine`, `validate`, `storage` are individual
stages; `delete` is idempotent cleanup, permitted even after the deadline or unhealthy
target status while preserving exact identity/denylist checks. The protected workflow
should also run `delete` with `if: always()` to cover an interrupted earlier step.
The other inputs are `RECOVERY_TARGET`, `RECOVERY_PROJECT_REF`,
`RECOVERY_BACKUP_TIMESTAMP`, `RECOVERY_CONFIRM=REGISTERED-PRODUCTION-BACKUP-CLONE`, and
`RECOVERY_TARGET_MANIFEST`, containing only:

```json
{
  "name": "cfc-recovery-drill-20261115",
  "purpose": "production-backup-recovery",
  "projectRef": "<exact new 20-letter ref>",
  "sourceProjectRef": "owkxkpkdffhcordlxqte",
  "organizationId": "peotkumhnipghqkrtjfs",
  "region": "us-east-1",
  "backupTimestamp": "2026-11-15T11:25:40Z",
  "createdAt": "<exact live project timestamp>",
  "expiresAt": "<at most four hours after creation>",
  "restoreCompletedAt": "<observed completed-restore timestamp>",
  "restoreStatus": "COMPLETED",
  "restoreEvidence": "DASHBOARD_SOURCE_BACKUP_AND_COMPLETED_TARGET_VERIFIED"
}
```

The runner denies production, unrelated protected projects and registered synthetic
load targets; requires the dedicated `cfc-recovery-drill-YYYYMMDD` name and exact live
name match; accepts no URLs/SQL in the manifest; verifies live ID, organization,
region, creation timestamp and healthy status; verifies the exact source backup is
still available; inspects restored columns; and reuses the release-history verifier
for all 23 canonical migrations and exact hosted alias SQL. Keys are fetched only
inside the protected runner and held in memory. No customer data, private paths,
hashes, provider bodies, SQL or credentials are logged or uploaded.

`quarantine` captures pre-change aggregates and digests, disables Auth providers,
signup, linking, hooks and notification flags, then executes the complete bounded
target-only `quarantine-hosted.sql` transaction. It disables cron and sync configs,
clears queued HTTP, pauses runtime writes, removes copied refresh tokens/sessions,
bans copied accounts and disables `llm_reader` login. It then exposes only the new
empty `recovery_quarantine` Data API schema. Existing platform/admin roles continue
to operate. Verification requires zero active jobs, usable copied sessions/accounts,
custom logins or runtime writes; existing runtime browser/direct-write denials; zero
invalid foreign keys; and unchanged target domain, schema, policies, function owners/
ACLs/definitions, relation RLS/ACLs, constraints and migration-history digests.
The quarantine's deliberate Auth/job/role/runtime deltas are reported separately.
Current source counts are **not** asserted equal to a historical backup. No customer
login, email or provider action is attempted. A partial failure requires immediate
operator attention and target deletion; it is never a successful drill.

`storage` first requires the target quarantine to pass. It reads the **current** source
object inventory and bytes (six objects at inspection), copies them into a newly
created private target bucket, downloads each restored object and compares SHA-256.
It verifies the source inventory stayed unchanged, then removes its exact temporary
objects and bucket. This proves a **fresh object-copy/restore round trip**, not recovery
of historical bytes from the database backup. Object paths and bytes stay in bounded
process memory (100 objects, 32 MiB/object, 128 MiB total). Source Storage operations
are read-only. There is still no historical object-retention guarantee.

After recording aggregate results, clone/validation elapsed time and backup age,
confirm automatic deletion of the exact clone through Supabase and verify it is absent. Record the actual
creation/deletion timestamps and compute/disk quote. This drill does not establish a
guaranteed production RTO/RPO or validate a production cutback. Its temporary target
must never be connected to the production app or used by the synthetic load runner.

### Incident recovery checklist

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
