# Production recovery, hosted load, and alert-delivery plan

Status: implementation and independent safety review complete; preparing release. No production restore, hosted load run, or delivered alert is claimed yet.

## Scope and fixed boundaries

- Source: reviewed main `bc1b30e8ef07b95c7f479ca21e2544949b99789e`.
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
- The user approved up to USD 2 for two temporary Supabase databases, with deletion within four hours. No resource has been created. The restore clone was quoted at USD 10.18/month if retained (approximately USD 0.06 for four hours), before usage and taxes.
- The Supabase connector's project-creation confirmation expired twice; its documented cost-confirmation parameter was then rejected by the connector schema. Provisioning uses the supported Management API through the existing protected GitHub environment instead.
