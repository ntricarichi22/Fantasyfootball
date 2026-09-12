# Security monitoring and audit runbook

## Scope and verified state

Source review found Next.js server routes, Supabase Auth, service-role server access, Vercel cron configuration, and metered Anthropic calls. Authorized catalog-only metadata supplied on 2026-09-12 confirmed broad live grants and incomplete/open RLS; see `SECURITY-INTEGRATION-REPORT.md`. Migration `014` was not applied.

## First activation (not performed)

1. Review and run `supabase/migrations/014_security_monitoring_audit.sql` through the protected workflow against a staging project, then run its validation queries.
2. Set a unique 32+ byte `AUDIT_HASH_KEY` in hosting secrets. Never reuse a Supabase or provider credential.
3. Deploy, deliberately fail a staging login, and confirm one pseudonymous `authentication_failure` row. Confirm `anon` and `authenticated` cannot select/insert/update/delete either table and that update/delete of an audit row fails. The endpoint has a best-effort per-instance 20-event/five-minute limiter; use hosting/WAF rate limiting as the durable multi-instance control.
4. For email delivery, set `SECURITY_EMAIL_ALERTS_ENABLED=true`, provider `resend`,
   `SECURITY_ALERT_EMAIL_TO`, `SECURITY_ALERT_EMAIL_FROM`, and `RESEND_API_KEY` as
   private server settings. Never use a `NEXT_PUBLIC_` value. The recipient is not
   committed. Claims in `security_alert_deliveries` deduplicate across instances and
   cap attempts per hour. Payloads contain bounded event metadata only—not email
   addresses, prompts, bodies, exception messages, or stacks.
5. Verify in staging that significant server request errors and authoritative AI
   quota/accounting signals deliver once per window. Failed-login email is **not an
   active trusted signal yet**: client telemetry must never trigger owner email, and
   the server-side verified-auth-failure integration remains a review gate.

No provider credential or verified sender is configured by this change, and no email
was sent. Until those private settings and the trusted-auth hook are staged, email
alerts remain inactive.

## Integration contracts

- Server authorization guards should call `recordSecurityEvent` with `authorization_failure`; top-level route error handlers should record `application_error`. Do not include request bodies or exception stacks in summaries.
- AI metering calls `recordSecurityEvent` and the deduplicated alert hook after
  authoritative accounting and on quota blocks. Accounting remains authoritative for
  the $5/user and fixed $60 aggregate limits; events never contain prompts.
- Next instrumentation emits a bounded `application_error` event without exception
  text or stack. Delivery failure never exposes the recipient or changes the request.
- Membership creation records the verified actor, league, target, and bounded role/roster metadata. Future ownership/permission mutation routes must follow the same contract.

## Retention and review

Retain aggregated `security_events` for 30 days and immutable `security_audit_log` entries for 24 months, unless legal/league policy requires longer. No automatic deletion job is included because audit deletion is intentionally blocked and no operator destination/schedule was authorized. A privileged database owner may perform a reviewed archival migration; application/service-role paths must not delete audit entries. Review warning/critical events weekly during the pilot and tune thresholds based on observed baseline.

## Re-sync / rollback

There is no sync job. Event writes are best-effort and fail closed only for telemetry—not user actions. To disable capture, remove the application calls; preserve audit rows. Do not drop tables as an operational rollback.
