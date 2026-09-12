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

PR 152 was fetched from `refs/pull/152/head` at
`a89e44bde031f4817921af5d78214ddd15665e2d`. Contrary to its reported ancestry, the
published commit has parent `88f9218` and therefore does **not** descend from
`e27ffb6`; it is a squash-style snapshot. Its tree delta against verified `e27ffb6`
contains the six scoped authorization/AI/auth-event fixes. Only that incremental
delta was applied here, preserving the later rollout, database-test and alert commits.

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

Additional verified configuration: email/password and new-user signup are enabled; email confirmation and secure email change are on; anonymous sign-in and manual linking are off. Secure password change, current-password-on-update, and leaked-password prevention are off. Minimum password length and email-send limit were blank/unverified. OTP is eight digits with 3600-second expiry; observed IP limits are 30 signups/signins, 30 OTP verifications, and 150 refreshes per five minutes. IP forwarding is off. Site/redirect settings include the production Vercel origin and expected callback/reset routes. No delivery flow was exercised.

Realtime publishes `draft_log` and `draft_state`. Both public policies are replaced by authenticated membership-scoped read policies in `015`; writes use server handlers. Production `draft_log` has no `league_id`, so `015` now adds it, requires exactly one existing `draft_state` league for backfill, then changes uniqueness to `(league_id,pick_index)` and `(league_id,player_id)`.

Both observed Storage buckets (`Players`, `team-logos`) are public and have zero Storage policies. Public asset reads may be intentional; contents and write behavior were not probed. `team-logos` has a 2 MiB limit; `Players` has no observed size limit, and neither restricts MIME types.

View dependency chains were captured and confirm many views transitively reach RLS-enabled tables. Direct view grants remain closed pending definition/semantic review; RLS on a base table alone is not accepted as evidence. Endpoint exploit tests were not run against production.

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

For an existing production database whose reviewed history is exactly `001`-`011` (see `SECURITY-ROLLOUT.md` for the auto-deploy compatibility sequence):
apply, after staging review, `012_security_multitenancy_foundation.sql`, then
`013_ai_usage_limits.sql`, `014_security_monitoring_audit.sql`, and finally
`015_live_api_least_privilege.sql`. Never repair or baseline production history
automatically. Follow the compatibility sequence in `SECURITY-ROLLOUT.md`; do not
approve database revocation before the exact compatible app SHA is ready. Configure
`AUTH_SESSION_SECRET`, `AUDIT_HASH_KEY`, verified per-model AI prices, and assign the
owner's membership `commissioner` role before rollout. Confirm email and redirect
settings first. Existing users must sign in again.

## Clean-database baseline and pending CI proof

Earlier credential-free CI could not truthfully run `001`-`015` on an empty database.
`001` alters `trade_offers` and `trade_messages`, while `002` requires the value-upload
schema; later migrations require draft and strategy tables. Full Git history contains
no reviewed creation DDL for those prerequisites. The checked-in CSV is a partial,
post-migration column export and cannot establish constraints, indexes, policies,
functions, views or pre-`001` nullability. Creating placeholders or copying the live
post-migration shape would conceal migration defects.

The additional current catalog capture closes the *present* definitions for the CFC
asset/value relations, trade relations, source maps, strategy, draft state/log and MFL
draft mirror, but it does not establish their historical pre-`001` shapes. Concrete
conflicts prove that copying it would be wrong: `001` reads
`trade_messages.offer_id`, which is absent today; `002` inserts into the current
`cfc_trade_values_current` view and expects calculation/staging columns absent today;
and `004` expects `source_platform`/`source_franchise_id`, while today's franchise
map exposes `platform`/`source_team_id`. The requested upload staging and master draft
table/functions are absent today as well.

Saved SQL source has now been recovered for the original trade tables (including
`offer_id`), canonical value staging/tables/view/functions, and master draft/player/
franchise/map definitions. Draft and strategy prerequisites are reconstructed by
reversing only changes stated in checked-in migrations 005-008 and 011 from the
verified current catalog; unversioned `picks_sell_move` is conservatively retained.
The sources had no visible execution/creation timestamps, so they are not described
as an executed snapshot. Their selected non-destructive definitions, plus live catalog
shapes reversed only through checked-in migrations, now form the CI-only baseline;
see `PRE001-BASELINE-PROVENANCE.md`. It is temporarily staged as version `000` only in
the disposable runner and can never enter linked production history. CI must still
prove reset, lint, RLS tests and concurrent AI reservations; no prior failed run is a
pass and no migration is skipped.

## Remaining operational gates

1. Publish the baseline commit and require a new disposable CI pass. SQL RLS tests
   and a real parallel PostgreSQL AI reservation test are wired in but are not passes
   until GitHub executes them successfully.
2. Inspect view definitions/dependencies and Realtime publications before selectively
   reopening any direct client access affected by migration `015`.
3. Enable secure password change/current-password verification and leaked-password protection after plan/UX review; verify minimum length, email-send limits, CAPTCHA and privileged MFA. The custom prepare flow still leaks allowlist/account state and needs durable edge throttling before a public multi-league launch.
4. Inventory Storage buckets/objects/policies separately; test logo ownership paths.
5. Verify backup database coverage/retention and Storage backup separately. Run the
   recovery drill only in an already available isolated nonproduction project.
6. Monitoring persists events and emits platform logs. A disabled-by-default Resend
   email hook now covers significant server errors and authoritative AI usage/quota
   signals with database-backed deduplication and a pilot-wide hourly cap. Delivery is
   **not active**: configure a verified sender, provider credential, and the approved
   recipient only in private server settings. Server-observed password rejection is
   trusted; the former browser assertion endpoint is inert and cannot trigger alerts.
7. Run unauthenticated, forged-cookie, cross-user/team/league and commissioner tests
   against a deployed nonproduction instance. Source/unit checks are not endpoint
   exploitation evidence and production was not probed.
8. Director memos remain an enforced single-league compatibility surface because the
   confirmed table has no `league_id`. Every memo body/UUID/status path must require
   current membership, configured-league equality, and own-roster filtering. Add and
   unambiguously backfill a league column before any second league is enabled.
9. Supabase Auth provides the shared password-attempt limits for the new server login
   path. IP forwarding remains off and no independent durable application/WAF limiter
   was verified; review those controls before broader signup exposure.

## PR150 source-of-truth dependency note

PR150 was read at verified SHA `d1d62caf9c1c817aa8961516a8a7dfd4ee15cb16`; it was not modified or merged. Its DB-07 baseline work depends on this clean-bootstrap effort. Its proposed `012`/`013` cleanup versions must be renumbered after security `015` (start at `016`) if later approved. No archive/drop is authorized. View dependencies show raw/mirror relations remain upstream, so lack of TypeScript imports is not deletion evidence. Any future feed/client refactor must preserve signed handler identity, object/league checks, metered provider dispatch, audit hooks, recovery tooling, and the guarded production workflow.
