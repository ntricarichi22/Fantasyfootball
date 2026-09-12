# Backup and disaster-recovery runbook

## Status and scope (2026-09-12)

This repository review verifies that the application uses Supabase Postgres and
Supabase Auth. Read-only configuration showed two public Storage buckets: `Players`
(no configured size/MIME limits observed) and `team-logos` (2 MiB size limit, no
configured MIME list observed). Names suggest public player assets and logos, but
object contents and write authorization were not inspected. Metadata and binary
files for both buckets are therefore recovery-review dependencies; public visibility
alone is not evidence that objects contain private data.

The dashboard listed eight daily physical backups from September 5–12, 2026;
the newest was September 12 at 11:15:36 UTC. This is an observed span, not a
contractual retention guarantee. PITR is not enabled (the dashboard offers it as an
add-on). The dashboard explicitly states Storage object bytes are excluded: database
backup covers only object metadata, and restoring an older backup does not recover
deleted objects. Restore validity remains unverified; no restore was performed.
Do not infer coverage from a Supabase plan name: record the dashboard evidence
in the drill record each time this runbook is exercised.

Database backups restore Postgres state, including `public`, `auth`, and Storage
metadata. They must not be treated as a backup of Storage object bytes. Preserve
and restore the `Players` and `team-logos` objects separately, or confirm from current Supabase
documentation/support in writing that the selected recovery mechanism includes
object bytes.

## Owner decisions and targets

For the present twelve-person league, adopt these targets after the first timed
drill confirms they are achievable:

* **RPO proposal:** 24 hours normally; one hour during a live draft.
* **RTO proposal:** four hours normally; one hour during a live draft.
* Retain at least 30 daily recovery points plus an encrypted, access-controlled
  pre-draft logical export. Increase frequency/retention as more leagues join.

These are policy targets, not measured capabilities. Actual RPO is bounded by
the newest usable database recovery point **and** newest independent Storage
copy. Actual RTO remains unknown until a complete timed drill passes.

## Quarterly evidence collection (read-only)

1. In the Supabase dashboard, record project reference, plan, backup type,
   schedule/time zone, retention, PITR status/window, newest and oldest
   restorable times, and last successful backup. Screenshot without secrets.
2. Confirm who can initiate a restore and that two maintainers can access the
   procedure. Never place database passwords or service-role keys in the record.
3. Inventory Storage in the dashboard. Record bucket count, aggregate object
   count/bytes, versioning or independent-copy mechanism, its retention, and
   its last successful run. Do not record object names.
4. With a read-only direct database credential, capture a privacy-safe baseline:

   ```bash
   SOURCE_DATABASE_URL='postgresql://…?sslmode=require' \
     ./scripts/recovery/capture-baseline.sh recovery-baseline.txt
   ```

   Store the output as restricted operational evidence, not in Git. Although it
   contains no rows, its schema inventory is operationally sensitive.

## Safe restore drill

### Preconditions

No safe hosted target currently exists: both observed projects are production-class, and neither has an isolated branch. The minimum remaining operator decision is approval of a disposable destination that is not either existing project, authorization to restore the selected physical backup into it, a named owner, a deletion/reset deadline no later than seven days, and acceptance of any explicitly quoted temporary compute/restore/egress cost. No project should be provisioned or billed from this repository task.

Before handling credentials, complete `docs/templates/RESTORE-DRILL-RECORD.md` and run:

```bash
PRODUCTION_PROJECT_REF=owkxkpkdffhcordlxqte \
RECOVERY_TARGET_PROJECT_REF=approved-disposable-ref \
RECOVERY_PROTECTED_PROJECT_REFS=owkxkpkdffhcordlxqte,other-protected-ref \
RECOVERY_TARGET_APPROVAL=approval-reference \
RECOVERY_TARGET_DELETE_AFTER=2026-09-19T00:00:00Z \
RECOVERY_SIDE_EFFECTS_DISABLED=YES \
RECOVERY_STORAGE_PLAN_CONFIRMED=YES \
  ./scripts/recovery/preflight-drill.sh
```

The command validates declarations only; it does not provision, connect, restore, or incur cost.

Use an existing disposable, isolated, nonproduction Supabase project (or local
Supabase/Postgres environment) with no production integrations, email delivery,
webhooks, schedules, or app deployment pointed at it. Never use production as
the target. Do not create paid infrastructure solely for this drill.

Record start time and chosen recovery point. Verify the target reference differs
from production before restoring. Temporarily disable outbound side effects in
the target. Restore through the dashboard's supported restore workflow, or use
the current official CLI procedure appropriate to the backup artifact. Do not
paste credentials into shell history or logs.

Restore the independent Storage copy into the target bucket after the database
restore. Preserve paths and content types. Compare aggregate bucket/object/byte
counts and sample-download a non-sensitive owner-approved fixture; never expose
private logos or signed URLs in drill evidence.

### Automated validation

Use read-only credentials for both databases. The validator refuses identical
database identities and requires an explicit disposable-target confirmation:

```bash
SOURCE_DATABASE_URL='postgresql://…?sslmode=require' \
TARGET_DATABASE_URL='postgresql://…?sslmode=require' \
RECOVERY_TARGET_CONFIRM=DISPOSABLE-NONPRODUCTION \
  ./scripts/recovery/validate-restore.sh
```

The check compares Postgres version, extensions, relation counts, hashed column
and constraint definitions, exact aggregate row totals, invalid foreign keys, Auth
metadata totals, and Storage metadata totals. It displays no application rows,
user identities, filenames, or credentials. A mismatch is a failed drill until
explained and documented.

Then point a local app instance **only** at the disposable target and validate:

1. A designated test account can sign in and sign out.
2. The test team can load home, roster/value data, inbox, and scouting views.
3. A team logo loads from restored Storage.
4. In target only, create/update/delete a clearly marked synthetic draft or
   message fixture and verify its relationship behavior. Never use a real user.
5. Confirm production remained unchanged, then destroy or reset the disposable
   target according to its owner-approved lifecycle.

## Drill record and incident recovery

Record recovery point, start/end times, database and Storage results, validator
result, app smoke-test result, failures, operator, and target deletion/reset.
Never record secrets or private records. The measured RPO is the gap between the
simulated incident time and the older of the database and Storage recovery
points. The measured RTO ends only after all validation succeeds.

During a real incident: stop writes if safe; preserve evidence; select a recovery
point before the incident; restore to isolation first; run all validation; have
the owner approve cutover; update application secrets through the hosting secret
manager; monitor; and document any lost interval. A database-only success is not
a complete recovery while Storage files remain missing.

## Minimal access still required

* Supabase dashboard read access to Backups/PITR and Storage configuration.
* A read-only production database credential for baseline validation.
* An already-approved disposable target plus permission to restore into it.
* Access to the independent Storage copy mechanism and an owner-approved test
  account/fixture.

No migration is required for this recovery-only change, and nothing here changes
production data, policies, credentials, or infrastructure. A fixture reset in migration CI
is not a production-backup restore and provides no measured production RPO/RTO.
