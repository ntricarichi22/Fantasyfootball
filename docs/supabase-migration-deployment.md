# Supabase migration CI and production deployment

## Targets and trust boundary

- CI uses Docker and the local Supabase stack. It has no cloud credentials and is not a persistent staging project.
- Production is the `cfcdraftapp` project with reference `owkxkpkdffhcordlxqte`.
- Pull-request code never receives production credentials. A production run is created only after **Supabase Migration CI** succeeds for a push to `main`, and it checks out that tested commit SHA.
- No workflow resets production, repairs migration history, or uses `--include-all`. A history mismatch stops the dry run and must be investigated manually.

## One-time GitHub setup

Create the GitHub environment `supabase-production` and configure only:

| Kind | Name | Value/scope |
| --- | --- | --- |
| Environment variable | `SUPABASE_PROJECT_REF` | `owkxkpkdffhcordlxqte` |
| Repository secret inherited by the environment job | `SUPABASE_ACCESS_TOKEN` | Existing; validity was not exposed or tested |
| Repository secret inherited by the environment job | `SUPABASE_DB_PASSWORD` | Existing; validity was not exposed or tested |

The project reference is deliberately a nonsecret environment variable. The two credentials currently exist as encrypted repository secrets and environment jobs can inherit them; this is **not** environment-only isolation. Do not expose or test values merely to prepare the workflow. The CLI does not require a separate database URL.

Verified dashboard setup: `supabase-production` requires owner `ntricarichi22`, admin bypass is disabled, and deployments are restricted to `main`.

Protect `main` separately: require pull requests, require **Validate migrations in disposable database**, require branches to be current before merging, block force pushes/deletion, and limit bypass. Branch-protection state still requires separate verification.

## Normal operation

1. Add a new, uniquely numbered SQL file under `supabase/migrations/`; never edit an already deployed migration.
2. Open a pull request. CI validates names/order, rebuilds an isolated PostgreSQL database, lints it, and runs SQL tests from `supabase/tests/database/` when present.
3. Review and merge only after required checks pass. The successful post-merge CI run creates one serialized production deployment.
4. An environment reviewer compares the commit and preflight output, then approves. The job links the exact project, lists local/remote history, performs `db push --dry-run`, and only then runs `db push`.

The current migration directory contains incremental migrations rather than a verified full baseline. If the disposable reset reports missing pre-existing objects, add the reviewed baseline/schema prerequisite supplied by the schema-owning integration work; do not weaken CI, invent schema, or mark history as applied. Likewise, resolve duplicate version numbers from parallel agents before merge.

## Recovery and rollback

Supabase migrations are forward-only in this workflow. Before a risky production migration, confirm the separate backup/recovery work is operational and take the applicable backup. Prefer an additive corrective migration for rollback. For destructive or data-changing SQL, prepare and review an explicit restore/compensating plan before approval. Never run `supabase db reset`, `migration repair`, or an automatic baseline operation against production. A database restore is an operator action outside this workflow and should be followed by reconciliation of repository and live migration history before another deployment.

## Local checks

Run `./scripts/validate-supabase-migrations.bash`. With Docker and the pinned Supabase CLI available, also run `supabase start`, `supabase db reset --local`, `supabase db lint --local --level error`, optional `supabase test db`, then `supabase stop --no-backup`.
