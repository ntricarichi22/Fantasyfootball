# Security and operations monitoring

## Current evidence

The existing migration `014` events/audit tables, deduplicated alert hook, database
limiter and runtime ledger are present in production. Read-only aggregate inspection
on 2026-11-15 found one initialized league with writes enabled; zero error/critical
occurrences in the preceding hour; zero failed alert deliveries and database cron runs
in the preceding 24 hours; and zero transactions older than five minutes. These are
one-time observations, not availability or alert-delivery guarantees.

The public probe passed at 2026-11-15 01:23:47 UTC: `/login` returned 200 and anonymous
`/api/league/snapshot` returned 401. It fetches no league data, signs in no production
account, invokes no job and spends no AI credits.

## Scheduled public checks

`operations-monitoring.yml` checks every 15 minutes at minutes 7/22/37/52 on trusted
`main` and supports manual dispatch. Each request has a 15-second timeout and no
redirects. It needs no secrets. Repository variable `MONITOR_APPLICATION_ORIGIN` can
override the confirmed default origin; it must be a bare HTTPS origin.

It also requires `/api/health` to return 200; that minimal endpoint performs the
bounded server-side database probe and exposes only `ok`, not identifiers or errors.
This detects an unreachable/paused app, unexpected anonymous access or database probe
failure. It does not certify authenticated journeys, database correctness, latency targets or capacity.
Temporary CI rehearsals cover synthetic authenticated journeys. GitHub schedules are
best effort and can be delayed; failed-run notifications are not a paging SLA.

## Protected manual database and backup checks

Dispatch `Operations monitoring` on `main` with `cloud_metadata=true`. Its metadata job
keeps the existing `supabase-production` environment approval and uses that environment's
`SUPABASE_ACCESS_TOKEN`. No PR or non-main job receives it. The shared Management API
client limits origin, routes, size and time; queries explicitly set `read_only:true`
and have a ten-second SQL statement timeout.

The checks reuse existing events, alert deliveries, runtime freshness and pg_cron.
They output counts/timestamps only, never users, emails, SQL/cron commands, prompts,
exception text or credentials. Failure conditions are:

- No initialized runtime, paused writes, or missing/source data older than 30 hours.
- At least ten error/critical occurrences last observed in the past hour.
- Any failed alert delivery or database cron run in the past 24 hours.
- A database transaction open for more than five minutes.
- Backup availability/freshness cannot be established under the recovery policy.

These are initial pilot thresholds, not automatic repair instructions. Check planned
maintenance before acting on a write pause. Review deploys/provider status for errors.
Never replay ingestion, advance drafts, accept trades or issue refunds as health probes.
The database cron check does not certify Vercel cron HTTP success; runtime freshness
is one outcome signal for scheduled reconciliation. Individual ingestion jobs and
external effects still need their own success evidence.

Automatic credentialed checks remain unconfigured without a separate read-only token.
A future dedicated monitoring environment must restrict deployments to trusted `main`
and hold project-scoped read access. Do not remove release reviewers or expose secrets
to PR workflows to automate monitoring. Public scheduled checks work without that token.

## Existing application alerts

`audit.ts` records bounded events and pseudonymous fingerprints. `alerts.ts` reuses
`claim_security_alert` for deduplication/hourly limits; it remains the only application
alert transport. Significant server errors, authoritative AI accounting signals and
server-observed password rejection can enter it. Browser telemetry cannot trigger owner
email. Monitoring scripts add no second transport and send no alerts.

Email activation requires private `SECURITY_EMAIL_ALERTS_ENABLED=true`, provider `resend`,
`SECURITY_ALERT_EMAIL_TO`, `SECURITY_ALERT_EMAIL_FROM`, `RESEND_API_KEY`, an approved
recipient and verified sender. Configuration presence or zero failed deliveries does
not prove delivery. No new email, webhook or external message was sent. Test delivery
only in a separately approved context. Native GitHub recipients, actual notification
delivery and human acknowledgement remain unverified.

## Retention and response

Keep the existing policy proposal: aggregated events 30 days and immutable audit
records 24 months, subject to owner/legal decisions. No deletion job is added. Service
and application paths cannot delete audit entries. Archive through a reviewed operator
procedure with recovery evidence.

Use [the recovery runbook](BACKUP-AND-RECOVERY.md) for backup evidence and limitations.
When a check fails, record run URL, affected check, timing and corrective action without
copying sensitive logs into issues. Escalation ownership and recipient acknowledgement
must be agreed before calling this continuous incident response.
