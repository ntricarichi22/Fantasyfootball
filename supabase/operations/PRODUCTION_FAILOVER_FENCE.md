# Controlled production write fence

These operations prepare a reversible, operator-controlled failover drill for
`owkxkpkdffhcordlxqte`. They are not migrations, an automatic disaster-recovery
system, or evidence that a full production failover has already succeeded.
Never apply them to a restored clone or the unrelated `tnixfvxqqwposoevpogo` project.

## Installation and activation are separate

Reviewed installers, in order:

1. `production_failover_fence.sql` creates private functions and an immutable epoch manifest.
2. `production_failover_journal.sql` creates the private controller/watchdog journal.

Both are rerunnable and use bounded transactions. They do not install a table
write guard, modify application/Auth/Storage rows, or disable jobs. Only `postgres`
can operate these helpers; no public, anon, authenticated or service-role execution
is granted. The existing `storage_backup_reader.sql` is a separate SELECT-only
identity policy and is not part of fence installation.

Activation is a separate reviewed controller action. It requires closed and
remotely verified admission across every deployment/hostname/path, frozen
administrative migrations, an armed independent watcher, verified source identity,
reviewed Auth/Storage feature configuration, and a source-return deployment.
SQL attestation strings are assertions by that trusted controller, not independent
proof that Vercel or GitHub was checked. A copied backup identity must not gain any
league membership or invitation. Acquire any necessary source Auth sessions before
fencing: login, refresh, logout, rate-limit and Auth audit writes are blocked too.

## Confirmed source scope

Live information_schema and privilege inspection found143 base/partition relations:
public103, Auth27, Storage10, league_sync2 and net.http_request_queue1. The139
fenced relations all permit TRIGGER and exclusive-lock privileges for the operator.
The manifest stores exact relation OIDs, definitions, columns/defaults/constraints,
policies/ACLs and existing triggers. Any added/dropped/replaced relation or relevant
definition drift refuses verification/release. All current Auth writer tables,
including unused SCIM, OAuth and WebAuthn tables, are included.

Four explicit exclusions are still fingerprinted and monitored:

| Relation | Reason / required precondition |
|---|---|
| auth.schema_migrations | Provider administrative ledger; migrations frozen during drill |
| storage.migrations | Provider administrative ledger; migrations frozen during drill |
| storage.buckets_vectors | No trigger privilege; confirmed empty, unused vector feature must remain unavailable |
| storage.vector_indexes | No trigger privilege; confirmed empty, unused vector feature must remain unavailable |

Confirmed settings columns are cron.job(jobid,schedule,command,username,active),
league_sync.config(league_id,season_year,h2h_weeks,enabled,updated_at),
league_sync.runs(status), and cfc_league_runtime(league_id,writes_enabled).
The only active job observed was postgres-owned `select league_sync.enqueue(true);`
at `0,15,30 13,14 * * 3` UTC. Activation refuses any different active job, queued
network request, queued/running sync, or another active client transaction.
Concurrent operator heartbeat activity can cause a safe refusal; retry only after
the preceding operation is settled. No generic operator transaction is exempted.

Activation takes deterministic exclusive relation locks, rechecks inventory/drain,
records exact prior flags, disables reviewed jobs/sync/runtime writes and installs
unconditional BEFORE INSERT/UPDATE/DELETE/TRUNCATE statement triggers atomically.
The triggers do not consult a snapshot-visible enable flag and do not expire.
Private journal writes remain possible; that schema is intentionally outside
customer-data fingerprints. Full source reads use streaming row fingerprints
(count plus four SHA256 component sums), not large concatenated buffers. Their
values and encrypted WAF baseline remain private and must never enter logs/artifacts.

## Controller and watcher contracts

Every operation binds the same UUID epoch, exact controller commit SHA and source.
The private journal saves the immutable complete plan, encrypted AES-GCM WAF
baseline, baseline digest and controller GitHub run ID. The separate
`production-failover-watchdog.yml` run uses job `watch-and-return`; its first verified
heartbeat binds exactly one different watcher run ID. The trusted JS caller must
verify GitHub repository/main/SHA/workflow/job before recording it. Heartbeats use
database time and must be fresh within30 seconds; their timestamps can be logged,
but the private journal response cannot be logged wholesale.

| SQL helper | Purpose |
|---|---|
| arm(plan,envelope,baseline_sha256,controller_run_id) | Persist/read back immutable plan before admission changes |
| journal(epoch,sha) | Private plan, encrypted baseline, stage, heartbeat and completion proof |
| heartbeat(epoch,sha,watcher_run_id,'watch-and-return') | Register/refresh the exact independent watcher |
| activate(epoch,sha,source_ref,'verified') | Atomic guarded source freeze after actual external admission checks |
| verify(epoch,sha) / verify_source_unchanged(epoch,sha) | Exact guard/inventory/settings proof and private data comparison |
| inspect(epoch,sha) | Serialized active/released/never-committed proof; no plain MVCC absence inference |
| request_promotion(epoch,sha) | Record DB-clock intent before the recovery promotion HTTP request |
| settle_promotion(epoch,sha,'provider-job-settled') | Record matching terminal provider-job proof after actual external verification |
| begin_failback(epoch,sha) | Durable latch rejecting any delayed/queued activation, then serialized inspection |
| release(epoch,sha,'source-return-verified') | Verify unchanged source and exact dependencies, remove own guards, restore flags atomically |
| record_phase(epoch,sha,phase) / complete(epoch,sha,'source-return-and-admission-verified') | Bounded progress / immutable terminal proof |
| resource_state(epoch,sha) / retire_resource(epoch,sha) | Serialized cleanup proof and durable pre-journal retirement latch |

The source adapter accepts only the fixed source and these fixed commands; no
arbitrary SQL or target registration is exposed. Database phases allow120 seconds,
lock waits5 seconds, while hosting phases remain separately bounded. An HTTP timeout
is uncertainty, never successful rollback. Before any source/WAF return, persist
`begin_failback`; an API-queued activation then cannot begin after an absence check.
A recovery promotion intent without verified settlement prevents fence release and
journal completion. Unknown provider-job state keeps admission closed for operator
recovery. Promotion intent is at-most-once: a repeated request is rejected, and an
uncertain intent response never authorizes an HTTP retry. Expiry itself never
releases guards or opens traffic.

After verifying source-return deployment configuration, canonical aliases, source
identity and unchanged data, release locks the same relations and proves the guard
function has only the recorded trigger OIDs as dependents. It drops only that exact
owned function with CASCADE, restores prior flags and records release in one
transaction. Managed table ownership prevents some direct DROP TRIGGER operations;
the strictly checked owned-function dependency method was proven in a rollback-only
live probe. Keep WAF closed until committed release is confirmed. Released epoch
proof remains available for crash recovery; completed journals reject late watcher
updates. A newer active epoch or untracked guard prevents old-epoch success claims.
Before deleting a temporary resource, its separate watcher must obtain
`retired:true` and `activeFence:false`. Retirement refuses any unfinished journal
or active fence, binds the controller SHA, and prevents even a queued late arm.
An absent journal or HTTP error alone never authorizes deletion. These tiny
private retirement records contain no customer data and never expire automatically;
a10,000-record threshold stops new armed plans for explicit retention review;
retirement/cleanup remains available even at that threshold.
Completed encrypted journals may be archived and pruned only through separately
reviewed operator maintenance after all related runs are terminal; tombstones must
remain until late/replayed work is provably impossible. No retention job can reopen
traffic or release a fence.

## Limits and required verification

Ordinary triggers are used because managed owners refused ENABLE ALWAYS. Six runtime
roles were confirmed non-superuser/non-replication, with no session_replication_role
SET privilege or replica configuration. Actual service-role no-op DML was blocked
in rollback-only probes; role switching to managed Auth/Storage owners is unavailable.
Provider owners can administratively disable triggers, as can trusted operators.
The controlled drill therefore requires frozen provider/administrator DDL. It does
not claim protection against a malicious database owner or a regional outage.

The database fence alone does not prove that Storage never modifies object bytes
before a failed metadata write. Close application/service-key/worker upload paths,
verify ordinary client write denial and the exact source object manifest before and
after the window. Current source had2 public STANDARD buckets,6 objects, versioning
disabled, no multipart uploads or vector rows. Historical bytes are protected by
the independent encrypted archive; a database backup contains metadata only.
If the restore includes an active source fence, use separately reviewed target-only
quarantine/removal logic; calling source release on the clone could restart jobs.

`scripts/test-production-failover-fence.mjs` requires an empty, separate loopback
database and explicit `FENCE_TEST_CONFIRM=DISPOSABLE-EMPTY-DATABASE`. The PG15/17
migration workflow runs it in `cfc_failover_ci`, then destroys that database.
Coverage includes zero-row writes, all DML classes, ACL denial, failure rollback,
exact settings restoration, journal/fence retries, drift and dependent-object
refusal, delayed activation/late watcher rejection, promotion settlement and real
two-connection uncertain-activation locking. Supplemental local PGlite tests do not
replace that real PostgreSQL CI gate or prove managed production activation.
