# Security environment and coordinated rollout preflight

No step here has changed production. The verified production migration maximum is `011`; reviewed pending migrations are `012`–`017`. Vercel deploys `main` automatically while the production database workflow waits for environment approval, so both sides of the interval are mandatory compatibility targets.

## Private settings

Use `scripts/config/security-rollout.env.example` only as a names-and-shape template. Store real values in the approved server secret manager. Never place the private alert recipient, service-role key, provider key, signing key, audit key, or generated output in Git or CI logs.

Required before app rollout:

- Current league ID `1328902558617473024`, Supabase URL/anon key, and server-only service-role key.
- Independently generated `AUTH_SESSION_SECRET` and `AUDIT_HASH_KEY`, each at least 32 random bytes and distinct from each other and the service-role key.
- Server-only Anthropic credential. All covered calls use `claude-sonnet-5`; standard USD-micros/MTok values are input `2000000`, output `10000000`, five-minute cache write `2500000`, one-hour cache write `4000000`, and cache read `200000`.
- Immutable rollout ceilings: `AI_MONTHLY_USER_BUDGET_MICROS=5000000` per authenticated user per UTC calendar month and `AI_MONTHLY_PILOT_BUDGET_MICROS=60000000` aggregate. Browser actions bill the signed-in user. `AI_BACKGROUND_USER_ID` is optional and only for explicitly scheduled server work.
- `SECURITY_EMAIL_ALERTS_ENABLED=false`. Activation is a later gate requiring a verified Resend sender, API key, private recipient, and a nonproduction delivery test.

Load approved private settings without shell-history exposure and run `./scripts/preflight-security-rollout.bash`. It validates shape and approved constants without printing values; it deliberately refuses an email-enabled rollout.

## Verified metadata-only production preflight

Read-only aggregate capture at 2026-09-12 14:55:42 UTC established:

- `team_email_map`: 12 rows, 12 normalized distinct emails, and 12 distinct roster IDs, exactly `1`–`12`; zero blanks, trim changes, duplicate email groups, or duplicate roster groups.
- Auth: all 12 mappings match exactly one confirmed account; zero unmatched or ambiguous accounts/rosters. No private user rows were captured.
- `draft_state`: exactly one nonblank league, the selected 2026 league `1328902558617473024`; the legacy 2025 league and other/null values have count zero.
- `draft_log`: 12 rows across eight mapped rosters; zero null/duplicate `pick_index`, duplicate nonnull `player_id`, blank roster, or unmapped roster rows.
- `league_memberships` and `league_invitations` remain absent; `draft_log.league_id` remains absent. Production migration history remains `001`–`011`.

This supports the reviewed single-league backfill cardinality. It does not prove environment values, deploy migrations, validate every Auth/Storage/view/Realtime surface, or authorize a write.

## Coordinated sequence

1. Publish and require the exact combined head to pass app suites plus disposable reset, lint, pgTAP, concurrency, and HTTP/Auth smoke. PR153 must be reconciled and retested as a new exact head.
2. Privately configure and run the environment-shape preflight with email disabled. Confirm the intended owner membership will be changed to `commissioner` only after membership creation.
3. Review production workflow dry-run: remote history must be exactly `001`–`011`; pending must be exactly `012`–`017`; generated baseline `000` must be absent. Do not repair history.
4. Merge approval and database-environment approval remain separate operator decisions. If Vercel deploys first, schema-011 compatibility accepts only the exact missing membership/limiter/audit objects, downgrades mutable role claims, and keeps AI fail-closed. It must not treat arbitrary database errors as compatibility.
5. Approve the serialized migration workflow only for the tested SHA. After `015`, never roll back to an app that needs anonymous/direct writes. Prefer a forward corrective migration or current compatible build.
6. Smoke login, confirmation/reset, invitation acceptance, current membership, revocation, own/foreign team, restricted commissioner behavior, Realtime draft reads/server writes, AI quota, and admin denial. Keep email and paid AI dispatch disabled during rollout verification.

## PR153 integration boundary

The independently verified PR153 head was `3202014590a34f8d30b1e85e7ec0b72ad2fac196`; it was not edited or merged here. Files changed by both efforts include `package.json`, `docs/sleeper-draft-results-runbook.md`, `src/app/api/admin/ingest/sleeper-draft-results/route.ts`, `src/app/api/research-strategy/attachment/route.ts`, `src/app/api/scouting/draft-calendar/route.ts`, `src/infrastructure/identity/{rosterBackfill,useMyRoster}.ts`, and `src/shared/league-data/accessors.ts`. Reconcile those files without losing signed identity, resource scoping, metered dispatch, or the reviewed Sleeper rebuild. PR153 also adds database cleanup planning; its first migration must start at `018`, and no destructive cleanup is authorized by this PR. Any combined head must retrigger both security CI and PR153 functional tests.
