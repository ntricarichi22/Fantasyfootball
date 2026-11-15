# Production recovery, hosted load, and alert-delivery plan

Status: the drill infrastructure is merged and deployed; real alert delivery and subsequent healthy monitoring are verified. The real backup restore and hosted traffic test remain uncompleted pending owner account handoffs. No temporary Supabase database remains.

## Scope and fixed boundaries

- Source: reviewed main `bc1b30e8ef07b95c7f479ca21e2544949b99789e`.
- Drill implementation: reviewed head `690cb13e68a74167a20210fc44d13f7fd811ba47`, merged as `3e1ebd658d96876b208a8546fe606af20ba12105` in PR #167. All release CI checks passed, including PostgreSQL 15/17 migrations and the disposable rehearsal; 198 unit/security tests passed locally.
- Current production deployment: `dpl_ras4saLFZhRsp1TJMQWypSF9D5fs`, exact main `821e086e2ca67ba0883be86d3ca58bc09d610492` (PR #169), region `iad1`, READY and assigned to `fantasyfootball-six.vercel.app` and `fantasyfootball-nick-ts-projects-37a944d6.vercel.app`. At **2026-11-15 23:15:48 UTC**, the existing bounded public monitor returned login `200`, anonymous protected-league access `401`, and database health `200`, with no failures. Vercel's deployment record reported no alias error. The earlier PR #167 release was `dpl_2RFv7cc3UWZVcDLWSXHXu95V6odv`.
- Protected Supabase projects: production `owkxkpkdffhcordlxqte` and unrelated `tnixfvxqqwposoevpogo`.
- Production Vercel project: `prj_EmMB2k7bAMZHDcFpkum2JwbdeBAm`.
- Preserve the original local checkout and real league data. Never restore over production for a drill.
- Use temporary resources with recorded identities and cleanup deadlines; no standing staging database.
- Never publish credentials, customer rows, Auth records, backup contents, signed URLs, or Storage object names in source, CI logs, or artifacts.

## Sequence and acceptance criteria

1. Inspect the current backup type, supported isolated-restore procedure, compute/storage costs, and copied-job side effects. Select an existing production backup and record its timestamp. Any copied cron, network jobs, integrations, Auth exposure, and credentials must have a concrete isolation plan before provisioning.
2. Restore that backup into a temporary isolated project. Validate actual schema, security grants/policies, migration history, relationships, and recovered application data using aggregate or private evidence appropriate to the backup timestamp. Check Storage separately: database backups contain metadata, not object bytes. Measure backup age and recovery elapsed time without presenting them as guaranteed RPO/RTO.
3. Provision a separate synthetic-only hosted load target using the reviewed schema and a protected Vercel deployment. Attest the exact application commit, deployment, and database identity. Reuse the existing authenticated load/race workload with gradual concurrency, hard time/request limits, failure stop conditions, and a kill switch. Keep paid AI, email, and external feeds disabled. Never execute global cutover or DDL from the hosted workload.
4. Verify the real operational notification route with a clearly labeled canary. Exercise the actual failure path without taking down production, verify receipt through provider/mailbox evidence, and record recovery. A provider acceptance response alone does not prove mailbox delivery.
5. Review and test the changes, publish the reviewed release, verify production health, and remove the temporary targets and secrets. Record exact results, limits, cleanup, and any remaining blockers in this document and the audit report.

## Evidence to record

| Area | Required evidence |
| --- | --- |
| Real backup restore | Source backup identity/time, target identity, isolation checks, restore result, security/data validation, elapsed time, cleanup |
| Storage | Independent copy provenance, object/byte totals and integrity checks, restored reads, cleanup; explicitly label a fresh copy versus a historical backup |
| Hosted load | Reviewed commit/deployment, target size/region, workload and concurrency, counts, latency percentiles, expected conflicts versus errors, invariant checks, cleanup |
| Alerts | Canary identifier, triggering monitor/run, delivery route and recipient, provider/mailbox receipt time, recovery result, suppression/retry behavior |
| Cost and lifetime | Quoted temporary rates, approved cap where required, creation/deletion times, any usage charges not yet billed |

## Current findings

- Supabase's existing physical daily backups can be restored to a separate project without enabling PITR. Copied scheduled/network jobs require special review because they can start with the clone.
- The current preview has no production database credentials. A dedicated temporary load deployment is necessary for authenticated hosted writes.
- The hosted workload now uses a separate fresh-schema setup step; its database-wide bootstrap cutover is forbidden against production and is never run by the hosted traffic workload.
- No application email-alert provider credentials are currently configured in Vercel. GitHub Actions failed-workflow email delivery to the owner's configured Outlook mailbox was verified by canary run `43763418094` at **2026-11-15 21:24:20 UTC**, with successful subsequent real checks in run `43763455080`; exact evidence appears below. This account setting applies across qualifying workflows, not only this repository.
- The user approved up to USD 2 for temporary Supabase databases, with deletion within four hours. The restore clone was quoted at USD 10.18/month if retained (approximately USD 0.06 for four hours), before usage and taxes.
- The Supabase connector's project-creation confirmation expired twice; its documented cost-confirmation parameter was then rejected by the connector schema. Provisioning uses the supported Management API through the existing protected GitHub environment instead.

## Verified alert delivery — 2026-11-15

- Reviewed source: merged main `3e1ebd658d96876b208a8546fe606af20ba12105` (PR 167).
- Dispatched exactly one labeled canary: [Operations monitoring run 43763418094](https://github.com/ntricarichi22/Fantasyfootball/actions/runs/43763418094), created at 21:23:25 UTC. The real checks returned login `200`, anonymous protected-league access `401`, and database health `200`; only `intentional_alert_delivery_canary` caused the expected failure at 21:23:53 UTC. Production was not taken down.
- The owner's configured Outlook mailbox received the native GitHub failure email at **21:24:20 UTC**. Its subject identified Operations monitoring on main `3e1ebd6`; its body contained the explicit `ALERT CANARY (expected failure)` label and the exact run link above. This is mailbox receipt evidence, not just provider acceptance. Private proof is retained outside the repository.
- Recovery: the ordinary [scheduled monitor run 43763455080](https://github.com/ntricarichi22/Fantasyfootball/actions/runs/43763455080), on the same commit, checked all three endpoints successfully at **21:24:07 UTC** and completed successfully at **21:24:10 UTC**. Its real checks occurred after the canary failure; no additional canary or duplicate recovery dispatch was needed.
- GitHub Actions email remains **failed workflows only**, alongside the existing GitHub notifications. This is an account-wide preference for qualifying workflows; scheduled-run ownership must remain monitored. A green run is the recovery evidence, because this setting does not send success emails. Native deduplication, retries, delivery guarantees, and paging escalation were not established by this single drill.
- Application Resend/email-alert credentials remain unconfigured. This result verifies the GitHub operational failure-notification route and makes no claim that application-generated email alerts are active.

## Hosted provisioning and pending live checks

- [Provisioning run 43772916740](https://github.com/ntricarichi22/Fantasyfootball/actions/runs/43772916740), on reviewed main `821e086e2ca67ba0883be86d3ca58bc09d610492`, successfully created the separate synthetic database and verified its restricted Auth settings. Public signup is disabled; only administrator-created synthetic users can participate in the test.
- Temporary target `ogshbkdglfjvegmlgqka`, named `cfc-load-drill-20261115`, had provider creation time **2026-11-15 22:56:32 UTC** and was confirmed deleted at **23:28:24 UTC** by [cleanup run 43774931748](https://github.com/ntricarichi22/Fantasyfootball/actions/runs/43774931748), well before its four-hour deadline. A separate provider inventory confirmed only the two original projects remain. Region: `us-east-1`; Micro compute; PostgreSQL 17.11. This is provisioning/cleanup evidence, not a completed load test.
- Two earlier provisioning attempts failed and confirmed deletion of their exact temporary targets: `hoayhxnnjoldzxtpxbsn` in run `43763396857`, and `hpaliwlpgciuszjonhbl` in run `43771503078`. The second failure was localized to the Auth configuration PATCH. The precise original HTTP cause was not retained. The reviewed repair sends only changed settings and still verifies the entire required configuration; the third provision passed. Do not attribute the original failure to a particular undocumented status code.
- The empty temporary Vercel project `prj_yWAHg7u22D7yiuMtEQb1ZmWaT64e` has no working deployment or runtime credentials. Preview builds are disabled and its ignored-build command is `exit 0`. Vercel's connector returned `requires_user_action` for project deletion; owner dashboard confirmation remains pending. All deployments require authentication, and the hosted workflow's narrowly scoped GitHub OIDC rule targets only Preview deployments.
- The real backup restore has not registered in Supabase. The prepared Dashboard form still requires the owner to enter a temporary database password and submit. An earlier user report of submission was checked against provider project/history records and was not treated as a successful restore.
- The official Vercel CLI device sign-in expired without completion, so no test runtime credentials were attached and hosted traffic never started. The private local credential bridge was deleted after database cleanup. A future attempt must provision a fresh target and use fresh exact identities/timestamps; do not reuse the disposed manifest or keys.
- Workload failure reporting now uses fixed phase/category labels and bounded counters. Raw child/provider diagnostics remain suppressed. Concurrent cancellation preserves the initiating failure, including rate-limiter aborts, so a hosted failure can be investigated after automatic target deletion.
