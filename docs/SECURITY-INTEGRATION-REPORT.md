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

## Clean-database blocker (not hidden or bypassed)

Credential-free CI still cannot truthfully run `001`-`015` on an empty database.
`001` alters `trade_offers` and `trade_messages`, while `002` requires the value-upload
schema; later migrations require draft and strategy tables. Full Git history contains
no reviewed creation DDL for those prerequisites. The checked-in CSV is a partial,
post-migration column export and cannot establish constraints, indexes, policies,
functions, views or pre-`001` nullability. Creating placeholders or copying the live
post-migration shape would conceal migration defects.

The new six-table metadata closes draft-state/log, current strategy, MFL draft mirror, and current trade thread/message definitions, but not every pre-`001` prerequisite. Run the single read-only `scripts/catalog/pre001-baseline-catalog.sql`. Still indispensable are historical pre-`001` definitions for `trade_offers` and `trade_messages` (including the `offer_id` used by `001`), the now-absent `cfc_value_upload_staging`, `cfc_assets`, `cfc_asset_calculations`, the pre-`003` table form of `cfc_trade_values_current`, and complete `ff_master_draft_picks`/franchise/player-map DDL. Current catalog output plus repository history must be reviewed to reconstruct—not guess—those states. For post-`001` objects, the baseline
review must logically remove changes introduced by `001`-`011` before committing a
`000` clean baseline. Then run `supabase start`, `supabase db reset --local`, DB lint,
RLS role tests, and concurrent AI reservation tests. CI intentionally remains red
until that reviewed baseline exists; no skip or automatic history repair was added.

## Remaining operational gates

1. Obtain/review the remaining pre-001 definitions above and complete disposable DB tests. SQL RLS tests and a real parallel PostgreSQL AI reservation test are now wired into CI but have not executed successfully while baseline migration application fails.
2. Inspect view definitions/dependencies and Realtime publications before selectively
   reopening any direct client access affected by migration `015`.
3. Enable secure password change/current-password verification and leaked-password protection after plan/UX review; verify minimum length, email-send limits, CAPTCHA and privileged MFA. The custom prepare flow still leaks allowlist/account state and needs durable edge throttling before a public multi-league launch.
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

## PR150 source-of-truth dependency note

PR150 was read at verified SHA `d1d62caf9c1c817aa8961516a8a7dfd4ee15cb16`; it was not modified or merged. Its DB-07 baseline work depends on this clean-bootstrap effort. Its proposed `012`/`013` cleanup versions must be renumbered after security `015` (start at `016`) if later approved. No archive/drop is authorized. View dependencies show raw/mirror relations remain upstream, so lack of TypeScript imports is not deletion evidence. Any future feed/client refactor must preserve signed handler identity, object/league checks, metered provider dispatch, audit hooks, recovery tooling, and the guarded production workflow.
