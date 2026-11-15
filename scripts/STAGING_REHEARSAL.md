# Disposable staging rehearsal

This project uses temporary CI databases only. No standing staging database, production data copy, or hosted load target is provisioned. `.github/workflows/staging-rehearsal.yml` runs the complete rehearsal on pull requests affecting its listed paths, manually, and monthly. It uses PostgreSQL 17 with pinned Supabase CLI 2.45.5, real local Auth/PostgREST, and a production-mode Next server. Existing migration CI separately covers PostgreSQL 15 and 17.

## Execution and safety

The workflow installs locked dependencies and loads `supabase/baseline/pre001_clean_database.sql` plus numbered migrations 001–023 into a fresh disposable stack. The baseline contains schema definitions, not production warehouse rows or private history. `scripts/lib/disposable-baseline.bash` shares the existing migration-test bootstrap. The rehearsal seeds two synthetic leagues, applies the reviewed `supabase/operations/league_runtime_cutover.sql` to that disposable database, and deletes the fixtures after testing. The recovery step then creates its own fixture and performs a logical dump/restore into a second disposable database. `supabase stop --no-backup` always destroys the stack and its volumes.

All application, Auth and database URLs must be explicit loopback origins. The Node target guard also supports a future explicit staging registry, but `config/deployment-targets.json` currently has no hosted entries and the load runner explicitly rejects hosted execution. Production project references, production application aliases, unknown origins, credentials in HTTP URLs, and URL query overrides are denied. Before application mutation commands, real Auth users finalize signed application sessions and `/api/health/readiness` must attest `environment=local`, `supabaseProjectRef=local`, and the exact checked-out commit. The fixture helper checks actual database columns before inserts and verifies synthetic account identities before cleanup.

The workflow needs no production, Vercel, Supabase management, email, payment or AI credentials. Local API keys come only from `supabase status`. Neither the workload nor its fixtures request Sleeper data or paid AI services. Fixture leagues use unpriced pick assets and synthetic rookie prospect IDs, and all read endpoints access the local runtime directly.

## Workload and assertions

Default workload: a maximum of 10 simultaneous HTTP requests, 120 seconds of paced authenticated reads, and four sequential mutation cycles. Each cycle races two different draft selections for one slot, replays the winning request concurrently, verifies exactly one persisted pick, checks that another roster cannot see the pending selection, then undoes the pick. In the second league, it concurrently repeats offer creation, races acceptance of two offers sharing an asset, replays the winner, and checks both offer status and authoritative ownership in PostgreSQL.

Reads cover runtime, draft state, and each user's inbox across both leagues while mutations run. Assertions reject cross-league state and stale league headers. Two request slots are reserved for mutation races; other workers issue paced reads. The script fails on an unexpected response or failed invariant, then attempts fixture cleanup.

Hard bounds: concurrency 3–25, read duration 10–180 seconds, at most 6,000 HTTP requests, 1–10 mutation cycles, 15-second request timeouts, 2 MiB response bodies, and a duration-plus-120-second overall HTTP deadline. The CI job itself is capped at 30 minutes including container setup, build and recovery. Expected conflict responses (409) are successful race outcomes, not application errors. Default read/command p95 threshold is 2,500 ms with at most 1% unexpected errors; fail-fast behavior is stricter than that error threshold. Output contains aggregate timings/counts and commit identity, never cookies, tokens or fixture data.

Manual dispatch accepts concurrency and duration; script validation remains authoritative. Relevant optional environment variables are `LOAD_CONCURRENCY`, `LOAD_DURATION_SECONDS`, `LOAD_MUTATION_CYCLES`, `LOAD_MAX_REQUESTS`, and `LOAD_P95_MS`. Run the safety regressions without Docker using `node --test tests/staging-load.test.mjs`. Full integration requires Docker in the disposable CI job; it has not been substituted with mocked SQL or authentication.

## Interpretation and remaining work

These results measure a bounded synthetic application/transaction baseline on a shared CI runner. They do not establish Vercel/Supabase production capacity, a maximum supported league count, actual production RPO/RTO, restored Storage object bytes, payment readiness, or paid AI throughput. Hosted performance testing would need a separately authorized isolated environment and representative privacy-safe data volumes. The restore report states its own limitations explicitly.

The lean Node runner uses existing `pg` and Supabase dependencies with native fetch cancellation and timing. Its constant-concurrency, paced workload and threshold checks follow the concepts in [k6 constant VUs](https://grafana.com/docs/k6/latest/using-k6/scenarios/executors/constant-vus/) and [k6 thresholds](https://grafana.com/docs/k6/latest/using-k6/thresholds/), while reusing the application's Auth and database fixtures instead of adding another test runtime.
