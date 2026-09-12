# Combined security-foundations integration report

Date: 2026-09-12 UTC. Branch baseline: verified `origin/main` commit
`88f92184b1939592cb884652c49b37a456885551`.

## Draft provenance

The hosted checkout fetched and verified these exact remote tips before integration:

- core / PR 145: `4d74311dbc6048b213755631edb15b84be80d5b4`
- recovery / PR 146: `611c8e6e40e78b1564b495eee347dcdf334fd376`
- AI controls / PR 147: `e67dc6aa02ca6659307e9400dc08e18e166386d8`
- audit / PR 148: `49083ef4b5bccc25a75db406e3ac5254275184e4`
- migration workflow / PR 149: `d5f8613d60c106577349595f5930e450559ab2f6`

This report replaces the earlier fetch-blocker report. No production write, deploy,
workflow run, account change, secret rotation, restore, or notification occurred.

## Verified live observations (catalog/dashboard, supplied by coordinator)

These observations were collected read-only from project `owkxkpkdffhcordlxqte` on
2026-09-12. No private application/Auth rows were selected.

**Critical:** the Data API is enabled with `public` and `graphql_public` exposed,
automatic exposure of new tables enabled, 118/118 relations and 11/11 dashboard
functions exposed. Catalog inventory separately counted 89 tables, 29 views and 12
function signatures. `anon` and `authenticated` have `public` USAGE and every
inventoried relation granted SELECT/INSERT/UPDATE/DELETE/TRUNCATE/REFERENCES/TRIGGER.
Only 15 tables have RLS enabled, none forced; 74 tables have no RLS. This is confirmed
configuration and privilege evidence, not proof that private rows were retrieved.

**Critical:** private strategy/negotiation relations without RLS include big-board
rankings/stars/tiers, director memos, team strategy/manual/player overrides, trade
passes, threads, offers, and watchlist. `trade_messages`, `draft_log`, `draft_state`
and `rookie_prospects` have `PUBLIC` policies with true USING/CHECK expressions.
`team_email_map` and `cfc_team_player_attachment` have RLS but zero policies.
Migration `015` revokes direct Data API privileges by default, restores only the
confirmed authenticated draft-room access, replaces open draft policies with
membership scope, restricts rookie reference data to authenticated reads, removes
open trade-message policies, denies the 29 definer-view surfaces pending dependency
review, and makes public functions service-role-only.

**High:** all 29 public views are postgres-owned without `security_invoker`; all 12
public function signatures are invoker functions with unset `search_path` and API
role EXECUTE. Migration `015` treats them as closed pending definition review rather
than assuming safety.

The live migration history is exactly `001` through `011`; no `012` is deployed.
Live `trade_offers.thread_id` is NOT NULL with its FK, confirming production is
post-`001`. These facts are used only for rollout ordering, not as proof that checked-in
migrations reproduce a clean database.

Not inspected: Auth security/redirect/rate-limit settings, Storage buckets/files,
view definitions/dependencies, Realtime publications, backup retention/coverage, and
a restore target/drill. Endpoint exploit tests were not run against production.

## Source fixes and boundaries

- Signed HttpOnly sessions bind verified Supabase user, league, roster and role.
  Handler-level checks now protect thread reads/messages, offer state transitions,
  trade/counter creation and team attachment mutations; object rows are looked up in
  the configured league and participants are checked at the resource boundary.
- Every admin handler now independently requires a constant-time checked Bearer
  `ADMIN_SECRET`/`CRON_SECRET` or a signed global-admin session. URL secret and
  token parameters were removed. Middleware adds the same global-admin boundary but is not
  relied upon alone. Draft tick fails closed when `CRON_SECRET` is absent.
- AI identity now comes only from the signed application session. All Anthropic calls
  remain behind atomic pre-dispatch reservation. Defaults are fixed $5/person and
  $60/application per UTC month; prices must be configured, input/output are bounded,
  no provider retry exists, and background prose requires an explicitly charged user.
  AI usage/quota blocks feed sanitized security events without duplicating accounting.
- Membership creation from a verified invitation now appends an actor/target/league
  audit record. Audit tables deny API roles and reject update/delete; summaries are
  bounded and secret/private-prompt keys are removed.

## Migration order and rollout

For an existing production database whose reviewed history is exactly `001`-`011`:
apply, after staging review, `012_security_multitenancy_foundation.sql`, then
`013_ai_usage_limits.sql`, `014_security_monitoring_audit.sql`, and finally
`015_live_api_least_privilege.sql`. Never repair or baseline production history
automatically. Deploy database changes before application code. Configure
`AUTH_SESSION_SECRET`, `AUDIT_HASH_KEY`, verified per-model AI prices, and assign the
owner's membership `commissioner` role before rollout. Confirm email and redirect
settings first. Existing users must sign in again.

## Clean-database blocker (not hidden or bypassed)

Credential-free CI still cannot truthfully run `001`-`015` on an empty database.
`001` alters `trade_offers` and `trade_messages`, while `002` requires the value-upload
schema; later migrations require draft and strategy tables. Full Git history contains
no reviewed creation DDL for those prerequisites. The checked-in CSV is a partial,
post-migration column export and cannot establish constraints, indexes, policies,
functions, views or pre-`001` nullability. Creating placeholders or copying the live
post-migration shape would conceal migration defects.

Minimal additional read-only input: a schema-only `pg_dump` (no data, no owners,
no privileges) of `public`, or catalog query results sufficient to reproduce every
pre-`001` prerequisite with columns/defaults/identity, constraints, indexes, RLS,
policies, triggers, functions and dependent views. For post-`001` objects, the baseline
review must logically remove changes introduced by `001`-`011` before committing a
`000` clean baseline. Then run `supabase start`, `supabase db reset --local`, DB lint,
RLS role tests, and concurrent AI reservation tests. CI intentionally remains red
until that reviewed baseline exists; no skip or automatic history repair was added.

## Remaining operational gates

1. Obtain/review the schema-only baseline above and complete disposable DB tests.
2. Inspect view definitions/dependencies and Realtime publications before selectively
   reopening any direct client access affected by migration `015`.
3. Inspect Auth confirmation, redirect, password, CAPTCHA, rate-limit, leaked-password
   and privileged-MFA settings. The custom prepare flow still leaks allowlist/account
   state and needs durable edge throttling before a public multi-league launch.
4. Inventory Storage buckets/objects/policies separately; test logo ownership paths.
5. Verify backup database coverage/retention and Storage backup separately. Run the
   recovery drill only in an already available isolated nonproduction project.
6. Monitoring currently persists events and emits platform logs. No alert destination
   is configured, so failed-login/app-error/spend notification delivery is **not active**.
   Choose the approved operations destination and connect it without sending test
   notifications to league members.
7. Run unauthenticated, forged-cookie, cross-user/team/league and commissioner tests
   against a deployed nonproduction instance. Source/unit checks are not endpoint
   exploitation evidence and production was not probed.
