# Controlled production failover

This procedure exercises the production domains against an isolated physical
Supabase restore, verifies a synthetic login/read/atomic write and retained file
bytes, and returns the domains to the original database. It is a planned
maintenance drill. It does not establish recovery during a regional outage, and
it does not allow customers to write to the recovery copy.

Production: Supabase `owkxkpkdffhcordlxqte`, Vercel
`prj_EmMB2k7bAMZHDcFpkum2JwbdeBAm`, repository
`ntricarichi22/Fantasyfootball`. The unrelated Supabase owner-meeting project
`tnixfvxqqwposoevpogo` is also protected. No step restores over either project.

The two promoted production domains are `fantasyfootball-six.vercel.app` and
`fantasyfootball-nick-ts-projects-37a944d6.vercel.app`. The separate
`fantasyfootball-git-main-nick-ts-projects-37a944d6.vercel.app` branch alias is
auxiliary: Vercel promotion does not move it. Config records each origin once;
shared checks derive the full protected set.

## Prerequisites

- Merge reviewed code only after quality/security, staging and real PostgreSQL
  migration/fence checks pass. Wait for the normal production deployment before
  creating the recovery project. Keep this exact main commit unchanged through
  the drill; avoid concurrent Vercel deployment/firewall administration.
  Before creating the clone, explicitly point the auxiliary branch alias to that
  normal deployment. Registration and candidate builds require all three origins
  to remain on the same initial source deployment.
- The `supabase-production` GitHub environment retains its main-only branch
  rule, owner review and disabled administrator bypass. The source Management
  credential remains protected. A temporary token limited to the production
  Vercel project supplies deployment and firewall access.
- Temporary environment secrets: `FAILOVER_VERCEL_TOKEN`,
  `FAILOVER_ADMISSION_SECRET` (64 hexadecimal characters),
  `OPS_DRILL_ATTESTATION_SECRET` (64 hexadecimal characters),
  `FAILOVER_JOURNAL_KEY` (base64-encoded 32 bytes), and
  `FAILOVER_SYNTHETIC_PASSWORD`. Generate independently; never reuse an app,
  service-role, cron or administrator credential as an attestation secret.
- The separate `storage-backups` environment holds the archive credential and
  retained keyring. Its normal daily job receives no source administrator key.
  A manual restore requires the protected production approval job first and
  shares archive concurrency with capture/pruning.
- Budget and cleanup deadline cover a temporary Micro database for at most four
  hours. No standing staging database is required. Do not start a physical clone
  in the copied Wednesday cron window; quarantine it immediately when healthy.

## Preparation and execution

1. Run `Production failover preflight`. It reads live Auth/Data API settings and
   verifies Management response/timeouts. It prints booleans and identities,
   never Auth secrets or templates.
2. Run `Controlled production failover`, operation `install-helpers`. This
   installs private `cfc_failover` functions and journal. It does **not** activate
   a write fence or change traffic. Existing active or unfinished work prevents
   reinstallation. See the detailed
   [database runbook](../supabase/operations/PRODUCTION_FAILOVER_FENCE.md).
3. In the original Supabase project's **Backups → Restore to a new project**,
   select a completed physical backup. Create `cfc-failover-drill-YYYYMMDD` in
   the same organization/region, using a new password entered by the owner.
   Record the original backup timestamp and completed restore identity. The
   newly created copy's own backup timestamp is not the source timestamp.
4. Allocate one UUID epoch for this resource. Register its exact nonsecret
   manifest: version, purpose `production-failover-drill`, name, projectRef,
   sourceProjectRef, organizationId, region, backupTimestamp, createdAt,
   expiresAt, observedRestoreConfirmedAt, restoreStatus `COMPLETED`, and
   restoreEvidence `DASHBOARD_SOURCE_BACKUP_AND_COMPLETED_TARGET_VERIFIED`.
   Preserve this epoch throughout registration, file restoration and cutover.
5. Run operation `restore-files` with that manifest, epoch and the exact retained
   snapshot ID. The independent resource watcher must be running before file
   work. The approval job starts `production-failover-resource-expiry.yml` and
   verifies its exact main SHA, plan digest, completed validation step and running
   `watch-clone-expiry` job before releasing the archive job. Approve that separate
   protected run promptly. The later drill verifies the same watcher again.
   The clone's copied identities, sessions, cron, outbound queue, custom
   login role, runtime writes and Data API are quarantined. The archive verifies
   every ciphertext and checksum before any file reconciliation. Copied metadata
   must match the archive exactly, and authenticated requests must prove original
   object bytes absent before metadata is removed through the Storage API.
   The job restores original paths and checks all bytes again. No upsert occurs.
6. Run operation `drill` for the same resource/epoch/snapshot. A PostgreSQL email
   hook blocks outbound Auth email, and its actual HTTP failure is checked.
   Copied users stay banned. Only fresh synthetic users/league gain runtime
   access; their password and all API credentials remain in memory.
7. The job builds a recovery deployment with isolated credentials, then a newer
   normal source-return deployment. Both have `autoAssignCustomDomains:false`.
   Persisted production environment values remain unchanged. Verified build and
   runtime database identities must agree before promotion.
8. A separate GitHub workflow must register a fresh heartbeat against the
   encrypted rollback journal before admission closes. Its run, job, repository,
   main SHA and epoch are verified against GitHub itself. Approve that exact
   protected watcher run promptly; without it, no traffic change is permitted.
9. A first-priority Vercel rule denies requests lacking the private drill header
   across all hosts, immutable deployment URLs, pinned routes and environments.
   Existing firewall protections remain. After draining, the database fence
   blocks writes to the reviewed application/Auth/Storage relations.
10. The controller promotes recovery and proves both canonical production domains.
    The auxiliary branch must remain on the initial source deployment, denied by
    the same all-host admission rule and protected by the source database write
    fence. No recovery alias assignment is made. The controller authenticates
    the synthetic user, reads its league, runs/replays an atomic future draft
    schedule command, verifies readback, and checks restored public file hashes.
    It then promotes the newer source-return build, explicitly repairs the auxiliary
    branch to that return build, verifies all three origins, source identity and
    unchanged data, releases only its own fence, and restores the original WAF.
    Source-return authentication means private operator attestation; it is not a
    claim that a real customer's login was exercised while the source was fenced.

## Interruption and cleanup

The failback watcher is a separate workflow run, independent of this computer and
the controller run. It can take over after controller completion/failure or the
deadline. A durable latch prevents delayed activation from re-fencing an already
reopened source. A recorded but unresolved promotion blocks reopening; an HTTP
timeout is never treated as proof that a remote mutation did not happen.

Do not cancel the watcher or delete a recovery database while canonical traffic
or auxiliary traffic may still point to it. Unknown provider outcomes require operator recovery.
Cleanup verifies the exact project identity and authenticated inventory absence;
a 403/404 response alone is insufficient. The resource watcher handles abandoned
preparation, but also refuses deletion when source return cannot be established.
This prioritizes preserving a serving database over blind cost-based deletion.
The expiry job starts cleanup ten minutes before the original four-hour deadline.
An unused clone requires all three unchanged original aliases and a normal deployment older
than the clone; a used clone requires the completed journal plus fresh source
return on all three aliases and firewall proofs. A durable retirement marker prevents delayed arming
after cleanup. Normal controller/watchdog completion also attempts immediate
verified deletion. GitHub hard cancellation or a provider outage can still require
operator cleanup; neither a timeout nor expiry authorizes blind deletion.

After confirmed return and deletion, revoke the temporary Vercel token and remove
the five temporary environment secrets listed above. Keep the permanent file archive/keyring and the
read-only backup identity. Record timestamps, aliases, synthetic checks, restored
file totals, interruption behavior, cleanup proof and observed recovery time.

## Evidence and limits

The first file capture and overwrite/deletion archive proof are recorded in
[Backup and recovery](BACKUP-AND-RECOVERY.md). Production preflight
[44006475658](https://github.com/ntricarichi22/Fantasyfootball/actions/runs/44006475658)
passed on 2026-11-17 at 02:58 UTC: expected project healthy, read-only Management
proof returned, timeouts applied, and no source fence installed yet.

The full traffic-switch drill is **not yet recorded as passed**. Replace this
statement only with verified run evidence. Daily file capture cannot recover an
uncaptured intermediate overwrite. Blob is not an immutable compliance vault.
Portable off-site encryption-key escrow remains an owner recovery-kit task.
The control journal currently depends on the healthy source database, so this
exercise proves a controlled source-preserving drill, not source-region loss.
