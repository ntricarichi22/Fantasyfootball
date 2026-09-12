# Security monitoring and audit runbook

## Scope and verified state

Source review found Next.js server routes, Supabase Auth, service-role server access, Vercel cron configuration, and direct Anthropic API calls. No repository environment contains Supabase credentials, so the live schema and live RLS state were **not inspected** and migration `012` was **not applied**. Its first query is the required live `information_schema.columns` preflight.

## First activation (not performed)

1. Review and run `supabase/migrations/012_security_monitoring_audit.sql` in a transaction against a staging project, then run its validation queries.
2. Set a unique 32+ byte `AUDIT_HASH_KEY` in hosting secrets. Never reuse a Supabase or provider credential.
3. Deploy, deliberately fail a staging login, and confirm one pseudonymous `authentication_failure` row. Confirm `anon` and `authenticated` cannot select/insert/update/delete either table and that update/delete of an audit row fails. The endpoint has a best-effort per-instance 20-event/five-minute limiter; use hosting/WAF rate limiting as the durable multi-instance control.
4. Configure hosting/log-platform alerts on structured logs where `kind=security_event`: authentication failures at 10 occurrences/15 minutes per fingerprint (and 30 globally), application errors at 5/10 minutes per source, and any `ai_quota_blocked`/`critical` event. Send only to an owner-approved destination. **No alert destination is configured by this change.**

## Integration contracts

- Server authorization guards should call `recordSecurityEvent` with `authorization_failure`; top-level route error handlers should record `application_error`. Do not include request bodies or exception stacks in summaries.
- The parallel AI-budget branch should call `recordSecurityEvent` after its authoritative accounting write with `ai_usage`, `ai_quota_warning`, or `ai_quota_blocked`. Include only numeric `input_tokens`, `output_tokens`, `estimated_cost_microusd`, and quota percentage plus authenticated actor/league IDs—never prompt text. That branch remains authoritative for the $5/user and $60 aggregate limits.
- Any server mutation of membership, team ownership, or commissioner/admin permission must obtain the actor from verified Supabase Auth (not a cookie/body), complete the mutation, then call `recordAuditChange` with actor, league, target, outcome, and field names/role transitions only. The current rename/profile routes are not ownership/permission mutations and were not broadened here. Integration with the authentication/authorization branch is required before adding hooks to its mutation routes.

## Retention and review

Retain aggregated `security_events` for 30 days and immutable `security_audit_log` entries for 24 months, unless legal/league policy requires longer. No automatic deletion job is included because audit deletion is intentionally blocked and no operator destination/schedule was authorized. A privileged database owner may perform a reviewed archival migration; application/service-role paths must not delete audit entries. Review warning/critical events weekly during the pilot and tune thresholds based on observed baseline.

## Re-sync / rollback

There is no sync job. Event writes are best-effort and fail closed only for telemetry—not user actions. To disable capture, remove the application calls; preserve audit rows. Do not drop tables as an operational rollback.
