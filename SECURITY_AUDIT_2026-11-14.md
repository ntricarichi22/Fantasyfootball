# Fantasyfootball code and security audit — 2026-11-14

The audit fixes are deployed. League isolation and atomic draft/trade transactions pass the full database/browser release gates. Expansion migrations are live; the controlled runtime cutover and matching application promotion remain pending at this report revision. This improves the foundation substantially, but does not make the application a complete commercial fantasy platform.

## Release evidence

- Audit release: [PR 154](https://github.com/ntricarichi22/Fantasyfootball/pull/154), reviewed head `27804d27c055e585db3a363ddec04d42d3251d53`, merged as `e680e59e943b5037994c2e2dd98fb2d67a9318b8`.
- Vercel production deployment `dpl_6RGjDtmURVUKTFVjS4KpSqXFFaFN` is READY and serves that merge at [the production site](https://fantasyfootball-six.vercel.app). Production login returned 200; six unauthorized/forged-cookie probes returned 401 with private/no-store headers.
- Audit CI passed on the reviewed head and merge: quality/security, CodeQL, clean/staged Supabase migrations, 50 pgTAP assertions, AI database concurrency, and real authenticated HTTP/revocation tests. The read-only hosted migration gate also passed.
- Live Supabase project: `owkxkpkdffhcordlxqte`, PostgreSQL 17.6.1.063. Historian least privilege, Edge worker v3, and session/draft-visibility migration 021 are confirmed live. Its hosted alias is `20261114181422_audit_session_revocation_and_draft_visibility`.
- Production signing key rotated. Preview uses independent signing/audit secrets. Historian league scope and verified TLS configuration were checked without exposing credentials.
- League-hardening release: [PR 165](https://github.com/ntricarichi22/Fantasyfootball/pull/165), verified application head `2061f63966d39bf93115fbbd0828822e4094c270`. PostgreSQL 15/17 [CI run 43638912114](https://github.com/ntricarichi22/Fantasyfootball/actions/runs/43638912114), quality/security and CodeQL all pass. Expansion 022/023 are live as `20261114205045_league_runtime_expansion` and `20261114233534_league_atomic_commands`, with exact normalized SQL hashes checked. Runtime remains uninitialized with writes disabled; the old application remains compatible until cutover. See `PRODUCTION_HARDENING_PLAN.md` and `supabase/operations/LEAGUE_RUNTIME_ROLLOUT.md`.
- Existing obsolete Vercel deployment hosts and version IDs have finite retirement rules. Both authenticated old-host probes returned 403; ordinary production requests remained available. Vercel's supported Skew Protection threshold was set through its deployment UI after the connector returned an unexplained 404. Old query/header pins now resolve to the current audited build; old cookie pins are denied. Advance the threshold to the league release during cutover. Future previews remain usable and still require an isolated database/credentials.

## Scope and source of truth

The audit targeted current GitHub main, initially `4048effb64daf8c83ce3ab4b439cdfa3b7ef8a87`. The original local checkout was based on `a5752f4` and contained uncommitted work. Repairs were made in isolated worktrees; the original work was preserved. Do not deploy that stale checkout or treat its preliminary edits as the reviewed release.

Three specialist agents reviewed application security, shared/frontend architecture, and database/infrastructure. Findings were checked against source and live catalog evidence before repair. The review covered authentication, authorization, caches/browser state, draft/trade ownership, AI dispatch/accounting and generated SQL, ingestion, dependencies, Git history, CI/recovery scripts, Supabase schema/grants/RLS/functions, and Vercel deployment configuration. Historical `ff_master_*` definitions and actual-versus-traded-pick semantics were preserved.

## Confirmed repairs

| Area | Result |
| --- | --- |
| Session security | Signed cookies bind to a verified, revocable Supabase session. Protected operations recheck live account/session/membership. Logout and recovery invalidate old sessions. Public account preparation/enumeration endpoint removed. |
| Historian | Live database reader reduced from approximately 102 tables to nine approved history tables, with no public writes or function execution. AST allowlisting, verified TLS, read-only transactions, timeouts, and bounded results constrain generated SQL. CFC history is unavailable to unrelated leagues. |
| Ingestion | `quick-worker` v3 requires the service credential and bounds request size, pagination, upstream responses, and duration. Live unauthenticated requests return 401. |
| Dependencies and defaults | Next.js/ESLint upgraded to 16.4.6. Reviewed dependency audit fell from 14 findings to zero. Private API responses are no-store; server identification disabled; baseline CSP added. Twelve mutable database function search paths corrected. |
| Shared code | Initial audit removed 14 unreachable modules/2,103 lines. Clock, storage scope, ingestion parsing, and authorization helpers consolidated. The league release additionally removes overlay replay, obsolete mutation helpers, and the old AI fetch wrapper. |
| League boundaries | Required league IDs flow through shared loaders, revision-aware caches, API requests, images, Realtime filters, and background jobs. Browser commands assert verified user/league/roster identity; stale account or league tabs cannot silently act through changed cookies. Tenant uniqueness and foreign keys scope formerly roster-only application records. |
| Atomic draft/trade runtime | Service-only database commands recheck live sessions/membership, take one league transaction lock, compare revisions, and commit ownership, offers/threads, draft/clock state, audit state, and retry results together. Repeated intent returns its committed result; changed intent under the same key is rejected. |
| Source reconciliation | Complete source snapshots use revision checks. Pending local ownership survives stale/intermediate provider observations. Actual selections preserve selected-by history independently of current player ownership. Unannounced selections stay out of shared caches; viewer-specific reads remain private. |
| Safe rollout | Expansion retains old conflict targets/defaults and disables runtime writes. Reviewed cutover bootstraps confirmed source data, then removes legacy direct mutation grants and global conflict keys. Hosted migration history is verified without reset or blind replay. |

The CSP remains partial; script-execution/XSS policy still needs a dedicated compatibility-tested rollout. Scanner results are evidence, not certification.

## Validation and limits

The league release passes 121 Node tests, TypeScript, production build, 16 production-router boundary checks, migration ordering, and staged secret scanning. ESLint has zero errors and 39 existing advisories: images, full-page navigation, and the root-layout font. Quality/security CI and CodeQL pass on the reviewed application head.

PostgreSQL 15 and 17 each pass the real schema-011 upgrade and clean reset, strict SQL lint, all 75 pgTAP assertions, AI database concurrency, and all 12 runtime race/rollback checks using independent connections. Both upgraded and clean authenticated HTTP/browser journeys pass, including stale league tabs and another account switching into the same league. The tests exposed and repaired hydration timing, a missing confirmed catalog fixture, and leftover database-only Auth fixtures. Local PostgreSQL-WASM checks are supplemental because Docker is unavailable here.

Initial audit scanners: Semgrep 1.185.0 checked 355 files with zero findings/parse errors; Gitleaks 8.30.1 covered 1,007 baseline commits and the staged diff. One browser-storage constant was exactly allowlisted; no actual credential finding remained. Generated ignored Next build keys were not treated as tracked credentials.

Production checks do not include signing in as a real customer, making a customer trade/draft selection, purchasing AI credits, or a restore/load drill. Disposable test accounts cover authenticated behavior without modifying real accounts. Production WAF retains platform protection plus finite obsolete-deployment retirement rules; backups/SMTP/restore effectiveness are not certified by this review.

## Existing-league compatibility

Read-only comparison found all 12 CFC application draft results match Sleeper, with no missing/extra selections, player/selected-by mismatches, hidden/skipped results, or missing player metadata. The completed 2026 first round remains 12 teams, one managed round, 1,800-second pick clocks. The verified bootstrap source contains 415 assets, 12 slots, and 12 actual selections; repeat it immediately before cutover.

Two existing pending offers contain four older raw player keys that can be normalized without changing their terms. One offer already contains two assets no longer owned by its stated seller; it must remain intact and fail acceptance with an ownership conflict rather than transfer someone else's players.

Other leagues do not borrow CFC valuation/history/AI assumptions. Their source bootstrap requires one authoritative current-season draft. Unconfigured future rookie inventory is omitted. Multi-round drafts must explicitly be linear without reversal; snake/third-round-reversal and richer season rules remain separate onboarding work.

## What still makes this a production fantasy platform

Your GitHub + Supabase + Vercel stack is a sufficient foundation. GitHub manages source and delivery; Supabase supplies PostgreSQL/Auth/Realtime; Vercel hosts the application/API. Changing providers is not the immediate bottleneck. Capacity, account plans, recovery guarantees, and operating costs must be measured against the intended workload.

| Priority | Remaining work | Completion evidence |
| --- | --- | --- |
| 1 | Complete controlled runtime rollout and multi-league provisioning contract; assign the intended commissioner through the audited workflow. No arbitrary user promotion. | Final PG15/17 and browser gates pass; exact production SHA/runtime verified; explicit league configuration and role lifecycle tests. |
| 2 | League-owned AI entitlements and append-only credit ledger; atomic reserve/reconcile; hosted payment collection; signed/deduplicated payment webhooks; refunds/disputes and reconciliation. Current user/global pilot budgets are not league wallets. | Parallel calls cannot overspend; webhook retries cannot double-credit; every charge and usage event belongs to the correct league/member. |
| 3 | Reliable scoring/player feeds, corrections, lineup locks, waiver/FAAB/free-agency rules, trade rules, commissioner reversals, playoffs, season rollover, import/export, and supported draft formats. | Deterministic season simulations and end-to-end member/commissioner tests. |
| 4 | Durable scheduled work for drafts and feeds, retries/dead-letter recovery, alerting and dashboards, incident ownership, rate limits, and load/cost testing. Browser tick assistance is not a durable scheduler. | Concurrent drafts and AI traffic meet measured latency/error budgets; unattended jobs recover after outages. |
| 5 | Backup coverage and restore drills; staging separation; SMTP/deliverability; compromised-password protection, MFA/admin recovery; stricter CSP; retention/export/deletion and privacy/payment terms. | A demonstrated restore, tested alert delivery, documented recovery/offboarding, and a reviewed commercial launch checklist. |
| 6 | Mobile/accessibility polish, notifications, support tools, feed/dispute workflows, and completion of explicit unavailable/501 features. | Real user journeys and accessibility checks pass across supported devices. |

Sleeper's API is read-only and cannot submit your app's trades or selections back to Sleeper. Its current documentation limits free use to non-commercial purposes and directs commercial users to discuss licensing. Resolve the commercial data arrangement before charging for a product that depends on it. [Sleeper API documentation](https://docs.sleeper.com/)

## Research and repeatable method

Use [OWASP ASVS](https://asvs.owasp.org/) for verification coverage and the [secure code review guide](https://cheatsheetseries.owasp.org/cheatsheets/Secure_Code_Review_Cheat_Sheet.html) / [WSTG](https://owasp.org/www-project-web-security-testing-guide/) for adversarial review. Separate guest, member, commissioner, worker, AI output, and dependency trust boundaries. Require source/catalog evidence and a reproducible negative case before calling a defect confirmed.

Tool selection used primary documentation for [Semgrep](https://semgrep.dev/docs/getting-started/quickstart), [Gitleaks](https://github.com/gitleaks/gitleaks), [Knip](https://knip.dev/overview/getting-started), [npm audit](https://docs.npmjs.com/cli/v11/commands/npm-audit/), [Next advisories](https://github.com/vercel/next.js/security/advisories), and [GitHub Actions hardening](https://docs.github.com/en/actions/security-for-github-actions/security-guides/security-hardening-for-github-actions). Dead-code candidates were checked against actual routes/imports; operational scripts were not deleted merely because application imports do not reach them.

Database/accounting guidance: [Supabase RLS](https://supabase.com/docs/guides/database/postgres/row-level-security), [sign-out semantics](https://supabase.com/docs/reference/javascript/auth-signout), [Management API read-only query support](https://supabase.com/docs/reference/api/v1-run-a-query), [node-postgres TLS](https://node-postgres.com/features/ssl), [Anthropic pricing](https://platform.claude.com/docs/en/about-claude/pricing), [Stripe security](https://docs.stripe.com/security/guide), and [webhooks](https://docs.stripe.com/webhooks).

Reusable review prompt:

> Audit the exact commit and deployment while preserving unrelated work. Trace actor-controlled input through authentication, authorization, validation, and privileged sinks. Require evidence, exploit preconditions, impact, and a reproducible negative test. Check tenant scope, direct database access, revocation, races/idempotency, secrets, AI costs, and browser state. Inspect information_schema before SQL. Repair the smallest coherent unit using shared code. Verify allowed and denied behavior. Separate confirmed defects, untested assumptions, deployed changes, and remaining product work; a green scanner is not enterprise readiness.
