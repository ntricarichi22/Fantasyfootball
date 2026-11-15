# Production recovery, hosted load, and alert-delivery plan

Status: PR #167 is merged and deployed; real alert delivery and subsequent healthy monitoring are verified. The isolated backup restore and hosted load are still in progress.

## Scope and fixed boundaries

- Source: reviewed main `bc1b30e8ef07b95c7f479ca21e2544949b99789e`.
- Drill implementation: reviewed head `690cb13e68a74167a20210fc44d13f7fd811ba47`, merged as `3e1ebd658d96876b208a8546fe606af20ba12105` in PR #167. All release CI checks passed, including PostgreSQL 15/17 migrations and the disposable rehearsal; 198 unit/security tests passed locally.
- Production deployment: `dpl_2RFv7cc3UWZVcDLWSXHXu95V6odv`, exact merged commit, region `iad1`, READY and assigned to `fantasyfootball-six.vercel.app`. Post-release probes returned login 200, protected league 401, and database health 200.
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
- The existing load workload must be adapted before hosted use because its local setup runs a database-wide cutover.
- No application email-alert provider credentials are currently configured in Vercel. GitHub Actions failed-workflow email notifications are enabled for the owner's verified Outlook destination; actual delivery awaits the canary. This account setting applies across qualifying workflows, not only this repository.
- The user approved up to USD 2 for temporary Supabase databases, with deletion within four hours. The restore clone was quoted at USD 10.18/month if retained (approximately USD 0.06 for four hours), before usage and taxes.
- The Supabase connector's project-creation confirmation expired twice; its documented cost-confirmation parameter was then rejected by the connector schema. Provisioning uses the supported Management API through the existing protected GitHub environment instead.

## Verified alert delivery — 2026-11-15

- Reviewed source: merged main `3e1ebd658d96876b208a8546fe606af20ba12105` (PR 167).
- Dispatched exactly one labeled canary: [Operations monitoring run 43763418094](https://github.com/ntricarichi22/Fantasyfootball/actions/runs/43763418094), created at 21:23:25 UTC. The real checks returned login `200`, anonymous protected-league access `401`, and database health `200`; only `intentional_alert_delivery_canary` caused the expected failure at 21:23:53 UTC. Production was not taken down.
- The owner's configured Outlook mailbox received the native GitHub failure email at **21:24:20 UTC**. Its subject identified Operations monitoring on main `3e1ebd6`; its body contained the explicit `ALERT CANARY (expected failure)` label and the exact run link above. This is mailbox receipt evidence, not just provider acceptance. Private proof is retained outside the repository.
- Recovery: the ordinary [scheduled monitor run 43763455080](https://github.com/ntricarichi22/Fantasyfootball/actions/runs/43763455080), on the same commit, checked all three endpoints successfully at **21:24:07 UTC** and completed successfully at **21:24:10 UTC**. Its real checks occurred after the canary failure; no additional canary or duplicate recovery dispatch was needed.
- GitHub Actions email remains **failed workflows only**, alongside the existing GitHub notifications. This is an account-wide preference for qualifying workflows; scheduled-run ownership must remain monitored. A green run is the recovery evidence, because this setting does not send success emails. Native deduplication, retries, delivery guarantees, and paging escalation were not established by this single drill.
- Application Resend/email-alert credentials remain unconfigured. This result verifies the GitHub operational failure-notification route and makes no claim that application-generated email alerts are active.
- First hosted provisioning run [43763396857](https://github.com/ntricarichi22/Fantasyfootball/actions/runs/43763396857) created temporary target `hoayhxnnjoldzxtpxbsn`, failed a setup check, and confirmed deletion. It did not run hosted load. Follow-up inspection found an overly strict assumption about documented nullable initial Auth configuration. The repair keeps explicit quarantine and verified read-back requirements, and adds safe phase diagnostics because the first run did not preserve its precise failure cause.
- Temporary protected Vercel project: `prj_yWAHg7u22D7yiuMtEQb1ZmWaT64e`; no production credentials are attached. It will be removed after the drill.
