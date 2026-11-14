# Security audit operations — 2026-11-14

These operational repairs target the inspected production project `owkxkpkdffhcordlxqte`. They depend on the live historical warehouse and are intentionally outside the clean-database migration chain. Do not add these files to automatic migration discovery.

## Verified production changes

- **`20261114153729_audit_historian_least_privilege`** was applied successfully. Its complete rerunnable SQL is [20261114153729_audit_historian_least_privilege.sql](20261114153729_audit_historian_least_privilege.sql). Before applying, its DDL and assertions passed a transaction-rollback dry run. After applying, catalog queries confirmed that `llm_reader` can select exactly nine `public.llm_*` history tables, cannot write public relations, and cannot execute any public functions. Twelve mutable-function-search-path advisor warnings were eliminated. No table data was changed. Role defaults set read-only transactions, a five-second statement timeout, one-second lock timeout, ten-second idle-transaction timeout, and `pg_catalog, public` search path. Restart application pools so new connection defaults take effect.
- **Edge Function `quick-worker`, version 3**, was deployed successfully with gateway JWT verification retained. Source is [index.ts](../functions/quick-worker/index.ts) and [handler.mjs](../functions/quick-worker/handler.mjs). The importer additionally requires the server service-role bearer credential before any request or write; it bounds body size, upstream response size, pagination, and execution time, rejects invalid pagination, and hides upstream/database errors. Its three regression tests passed. A live unauthenticated POST returned HTTP 401 without writing data. No scheduled caller of this importer was found; the Wednesday Sleeper cron calls a different function, `sleeper-weekly-sync`.

## Migration 021 rollout

[021_session_revocation_and_draft_visibility.sql](../migrations/021_session_revocation_and_draft_visibility.sql) is the canonical application migration. It adds the service-only `is_auth_session_active(p_session_id uuid, p_user_id uuid)` RPC, checks provider session expiry, account bans, and account deletion, and narrows the existing `draft_log_league_member` policy to announced picks, the member's own picks, or league commissioners/admins.

**Status: not verified applied; Supabase confirmation required.** The migration tool's confirmation expired without a success response. A catalog check still showed the old broad draft policy and no session RPC, and migration history did not contain this operation. A new confirmation was requested; do not interpret dispatch as success. Record the actual hosted migration version here after a successful apply. The repository version is `021`; a hosted MCP apply may assign a timestamp instead. Reconcile that mapping before a later CLI migration push so the same change is not unexpectedly replayed.

Apply 021 before deploying code that requires the session RPC. The function and policy are rerunnable, and the script includes catalog inspection and ACL assertions. After applying, verify:

1. `service_role` has EXECUTE; `anon`, `authenticated`, and `PUBLIC` do not.
2. Null, unknown, revoked, expired, banned, and deleted-account sessions return false; an active matching provider session returns true.
3. `draft_log` has only the intended permissive SELECT policy; another permissive policy would bypass its restriction through PostgreSQL OR semantics. At the last live inspection its only SELECT policy was named `draft_log_league_member`.
4. League members can read announced and their own hidden picks, cannot read another team's hidden picks or another league's picks, and commissioners retain same-league visibility.
5. Run the staged 012–021 rollout, clean-database pgTAP suite, and HTTP authentication/logout/reset smoke tests. The staged migration fixture now expects ten migrations.

## Remaining infrastructure findings

- Security advisor after the verified historian repair: **21 informational RLS-enabled/no-policy notices**, **4 authenticated GraphQL table-discovery warnings**, and **1 compromised-password-protection warning**. The deny-all tables have no browser grants; the four readable tables use intentional SELECT policies. Discovery is not proof of row leakage. Enable Supabase leaked-password protection before public launch.
- Performance advisor: **13 unindexed foreign keys**, **5 tables without primary keys**, **48 unused-index observations**, **1 duplicate-index warning**, and an Auth connection allocation fixed at 10 connections. The duplicate indexes are `cfc_asset_calculations_asset_key_key` and `cfc_asset_calculations_pkey`. Review workload/constraints before removal; unused observations alone do not justify deleting indexes.
- Health advisor returned no findings. This is not a backup/restore, disaster-recovery, penetration-test, or load-test certification.
- `pg_net` schema privileges inherited through `PUBLIC` are managed by `supabase_admin`; a rollback-only revoke test did not remove that inherited access. **No broad PUBLIC revocation was persisted.** Keep the application's SQL AST allowlist and explicit read-only transaction boundary. Catalog privacy is not an authorization boundary.
- `llm_reader`'s approved history tables are CFC-wide, not tenant-partitioned. The historian must remain restricted to verified CFC membership until genuine tenant-scoped history exists. The confirmed current CFC membership/sync league ID is `1328902558617473024`.
- AI reservation functions currently enforce per-user and global pilot quotas, not a per-league purchased-credit ledger. Payments require a separate audited ledger, idempotent provider webhooks, reconciliation, and tenant billing authorization.
- Public storage buckets `Players` and `team-logos` exist. `Players` has no size/MIME restriction; `team-logos` has a 2 MiB limit and no MIME restriction. Browser write policies were not present in the inspected policy list; configure restrictions before enabling uploads.
- Live PostgreSQL is **17.6.1.063**, while the repository's local/CI configuration targets PostgreSQL 15. Align and test versions deliberately before claiming production parity.
- Current-main contains migrations 001–020; the originally opened local checkout was stale and only had 001–007. Its local 007 history script must not be confused with canonical 007. Production additionally has timestamped history/sync operations, including this historian repair, outside the numbered chain. Preserve their provenance and reconcile history before automatic pushes. No wholesale schema reset or historical data rewrite was performed for this audit.

## Re-sync / repair verification

The existing Sleeper weekly sync remains on its own one-time-token claim flow and Wednesday schedule. This audit did not trigger a data sync. For `quick-worker`, invoke only from a trusted server with its service-role bearer credential, POST a positive `league_id`, `sport: "NFL"`, and `request_filter: "TRADES_COMPLETED"`. Never place the service credential in a browser, URL, repository, or log. Upserts use the existing `(league_id,sport,request_filter,result_offset)` key, so retrying a bounded failed import is idempotent at page level. Review partial imports before treating a run as complete.
