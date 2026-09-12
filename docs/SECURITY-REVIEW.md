# Security review: authentication and Supabase boundaries

## Scope and architecture observed

The application is Next.js 16 on Vercel. Browser authentication uses Supabase
Auth email/password through the anon client. Most application API routes use a
server-only Supabase service-role client and therefore bypass RLS. The existing
tenant identity was an unsigned `cfc_roster_id` cookie, while requests commonly
accepted `teamId`/`leagueId` from the browser. `team_email_map` is the current
email-to-roster allowlist; there was no durable user-to-league membership table.

Repository migrations and the checked-in schema-column export were reviewed.
No Supabase URL/key, database URL, Supabase MCP resource, or other authorized
live connection was available. **No live database policies, grants, functions,
Auth settings, or Storage policies were verified or changed.** The new migration
is review-only and was not applied.

## Prioritized findings and disposition

### Critical — unsigned team identity enabled account/team impersonation (fixed)

The server trusted a browser-supplied roster cookie, and API routes were excluded
from middleware. Changing the cookie or a request `teamId` could cause the
service-role client to read or mutate another team. A signed, HttpOnly,
eight-hour application session now binds the verified Supabase user to league,
roster, and role. Middleware requires it for application pages/APIs and rejects
cross-team/cross-league actor parameters for ordinary members. Commissioner and
admin sessions may cross team boundaries only within their league.

### Critical — first signup did not prove mailbox ownership (fixed)

The signup route used `auth.admin.createUser` with `email_confirm: true` after
only checking that an email appeared in `team_email_map`. Anyone who knew an
allowlisted address could set its first password. Signup now uses the anon Auth
email-confirmation flow. It fails closed and deletes the just-created account if
Supabase returns a session, which indicates email confirmation is disabled.

### High — service-role APIs lacked a central authentication boundary (fixed)

Nearly every normal API route can access Supabase with the service role. The
middleware now defaults normal routes to authenticated, checks same-origin for
state-changing requests, and validates common actor and league fields in query
strings and JSON bodies. Machine endpoints remain outside user sessions because
their handlers enforce `ADMIN_SECRET` or `CRON_SECRET`.

### High — onboarding completion accepted an arbitrary email (fixed)

The completion route updated `team_email_map` using an email supplied in JSON.
It now resolves only the roster in the signed session. Team rename and logo
operations likewise resolve the signed session rather than readable cookies.

### High — database tenant enforcement was incomplete (migration prepared)

`team_email_map` enabled RLS but repository SQL did not show explicit grants or
policies; `cfc_team_player_attachment` did not enable RLS. Migration `012`
creates `league_memberships`, makes the invitation map server-only, and applies
membership-scoped RLS/grants to the confirmed attachment table. It starts with
schema inspection and ends with policy/grant validation queries.

### Medium — email/account enumeration and auth abuse controls remain

`/api/auth/prepare` distinguishes allowlisted/non-allowlisted and existing/new
accounts. Supabase Auth rate limits do not necessarily protect this custom
allowlist lookup. Before public launch, replace this two-step discovery flow
with a non-enumerating invite or unified login flow and add durable per-IP and
per-email throttling at the edge. Configure Supabase Auth password strength,
CAPTCHA, email rate limits, leaked-password protection, and MFA for privileged
roles after verifying plan availability and current settings.

### Medium — remaining direct-data and table-by-table RLS audit required

The browser anon client subscribes to Realtime and accesses big-board tables.
Repository evidence cannot establish their live grants/RLS/policies. Before a
second league, inventory every exposed-schema table/view/function and Storage
bucket, add `league_id` where missing, and enforce membership policies. Until
that audit is complete, the server middleware is the primary boundary for API
routes, not proof that direct PostgREST/Realtime access is tenant-safe.

### Medium — admin secrets in query strings

Several admin ingestion routes accept secrets in URLs, which can leak through
logs and browser/history tooling. Move them to `Authorization: Bearer` headers
in a follow-up coordinated with existing schedulers. Do not remove query support
until callers are migrated.

## Rollout and first sync

1. In a staging Supabase SQL editor, run the complete `012` migration as one
   block. Review the preflight and validation result sets; do not proceed if the
   confirmed column shapes differ.
2. Set a random, dedicated `AUTH_SESSION_SECRET` only in server environments.
   Keep `SUPABASE_SERVICE_ROLE_KEY` server-only. Confirm Supabase **Confirm email**
   is enabled and the production `/login` redirect URL is allowlisted.
3. Insert or update the owner's `league_memberships.role` to `commissioner` for
   the current league. Ordinary users are backfilled as `member` at their next
   successful login. This one role assignment is an explicit deployment step.
4. Deploy migration first, then application code. Existing unsigned cookies are
   intentionally rejected, so all users must sign in once after deployment.
5. Verify anonymous API requests return 401, member requests for another roster
   or league return 403, normal self access succeeds, and commissioner cross-team
   actions work only in the commissioner's league.

For re-sync or a future league, create membership rows keyed by `(user_id,
league_id)` and make every tenant-owned row include `league_id` plus its roster
owner. Resolve both values from the signed session; never trust a browser tenant
selector as authorization. Add the league to UI selection only after all tables,
views, functions, Realtime publications, and Storage paths used by that feature
have matching membership checks.

## Minimal access needed to finish live verification

Provide either a Supabase MCP connection capable of read-only catalog queries or
a read-only Postgres connection that can inspect `information_schema`,
`pg_catalog`, `pg_policies`, `information_schema.role_table_grants`, function
definitions, publications, and Storage policy metadata. Separately provide
read-only visibility of Supabase Auth security/rate-limit settings. No access to
select `auth.users`, member emails, or private application rows is needed.
