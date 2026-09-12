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
`015_live_api_least_privilege.sql`, `016_durable_league_invitations.sql`,
`017_lintable_actual_draft_rebuild.sql`, and finally coordinated application
migration `018_pending_trade_overlays_and_pick_keys.sql`. Never repair or baseline production history
automatically. Follow the compatibility sequence in `SECURITY-ROLLOUT.md`; do not
approve database revocation before the exact compatible app SHA is ready. Configure
`AUTH_SESSION_SECRET`, `AUDIT_HASH_KEY`, verified per-model AI prices, and assign the
owner's membership `commissioner` role before rollout. Confirm email and redirect
settings first. Existing users must sign in again.

## Clean-database baseline and verified CI proof

GitHub run `34704727222`, job `103582609569`, at published security head
`e54df407` completed successfully. On one disposable database it proved the
schema-011 compatibility phase, incrementally applied 012–017 while preserving
Auth/application fixtures and cookies, verified membership/invitation
backfills, then passed clean SQL lint, all 27 pgTAP assertions, actual database
AI concurrency/bypass tests, and the full Mailpit confirmation-token HTTP/Auth
suite. This supersedes the failed `b90603a` harness result. It does not validate
PR153 migration 018 or the combined application tree.

GitHub run `34701863673` at published head `b49e0f8` completed successfully. It
staged the reviewed CI-only baseline as generated version `000`, reset through
migrations `001`–`017`, reported no SQL lint errors, passed all 27 pgTAP assertions,
passed the actual parallel PostgreSQL AI reservation/bypass checks, and reported
`Disposable HTTP/Auth smoke checks passed.` The HTTP cases covered confirmation-required
signup gating, login, own quota, cross-roster thread denial, creator-spoof denial,
legitimate thread creation, restricted commissioner behavior, recovery and old-password
rejection, durable revocation/refinalize denial, and logout.

The earlier GitHub run `34699583360`, job `103568851942`, at published head `005f2fec`
completed successfully. It staged the reviewed CI-only baseline as generated version
`000`, reset through migrations `001`–`017`, reported no SQL lint errors, passed all
27 pgTAP assertions, and passed the actual parallel PostgreSQL AI reservation and
bypass checks. This is real disposable-database evidence, not a claim about deployed
production RLS, live Auth behavior, or a backup restore.

The baseline provenance remains bounded: saved SQL supplied original trade/value/master
definitions but exposed no execution timestamp; current live catalog shapes were
reversed only through checked-in migrations where documented. Baseline `000` exists
only during disposable CI and must never enter linked production history. Production
remains at `001`–`011`.

Security head `e54df407` supplies that proven harness. On this stacked branch it
first isolates migrations `012`–`018`, starts baseline `000` plus deployed history
`001`–`011`, and exercises a
mapped confirmed user's real login/finalization, signed compatibility cookie, own and
foreign reads, tampered/forged cookie denial, and AI failure before accounting exists.
It then restores all seven pending migration files with explicit presence checks,
resets through `018`, and runs the normal database and HTTP suites. The normal phase now
follows the real synthetic confirmation link captured from local Mailpit back through
the fixture application, and adds unauthenticated, forged, tampered, and validly signed
cross-league denial. The combined PR153 head requires its own new CI run; neither
prior security run validates migration 018 or these application refactors.

All fixture credentials, mail, accounts, and rows are generated inside the disposable
stack. This is neither a production probe nor a production-backup restore drill.

## Verified production preflight evidence

A read-only aggregate capture at `2026-09-12T14:55:42Z` found 12 clean and distinct
`team_email_map` email/roster mappings (rosters 1–12), each matched exactly once to a
confirmed Auth account, with no unmatched or ambiguous accounts. `draft_state` has one
nonblank row for league `1328902558617473024`; the legacy 2025 league and other/null
counts were zero. `draft_log` has 12 rows across eight mapped rosters with no null or
duplicate pick index, duplicate nonnull player, blank roster, or unmapped roster.
`league_memberships`, `league_invitations`, and `draft_log.league_id` remain absent.
This validates reviewed backfill cardinality, not a migration or environment setting.

## Remaining operational gates

1. Publish the staged schema-011/normal-phase extension and require credential-free CI
   on the exact reviewed head. Re-run after reconciling stacked PR153.
2. Run the private environment-shape preflight in `SECURITY-ENVIRONMENT-AND-PREFLIGHT.md`;
   configure independent signing/audit secrets, exact Sonnet 5 prices, the fixed $5
   user/$60 pilot ceilings, and keep email disabled.
3. Review the production dry-run showing remote `001`–`011` and only reviewed
   `012`–`017` pending. Do not repair or baseline live history.
4. Inspect view definitions/dependencies and Realtime publications before selectively
   reopening direct client access affected by `015`; inventory Storage write policies
   and object backup coverage separately.
5. Review Auth secure-password-change, current-password verification, leaked-password
   protection, effective minimum length/email limits, CAPTCHA, privileged MFA, and
   edge controls. No live setting was changed.
6. Designate and approve a truly disposable restore target, quoted temporary cost,
   side-effect isolation, Storage-object recovery source, and seven-day cleanup. Both
   currently observed projects are production-class and forbidden as targets.
7. Email alerts remain disabled pending a verified Resend sender, provider credential,
   private recipient, and nonproduction delivery test.
8. Director memos remain single-league because the confirmed table has no `league_id`.
   Add and unambiguously backfill it before enabling a second league.
9. Apply the owner commissioner role only through a reviewed trusted operation after
   membership creation, then require users to sign in again.

## PR150 source-of-truth dependency note

PR150 was read at verified SHA `d1d62caf9c1c817aa8961516a8a7dfd4ee15cb16`; it was not modified or merged. Its DB-07 baseline work depends on this clean-bootstrap effort. Its proposed `012`/`013` cleanup versions must be renumbered after security `017` (start at `018`) if later approved. No archive/drop is authorized. View dependencies show raw/mirror relations remain upstream, so lack of TypeScript imports is not deletion evidence. Any future feed/client refactor must preserve signed handler identity, object/league checks, metered provider dispatch, audit hooks, recovery tooling, and the guarded production workflow.
