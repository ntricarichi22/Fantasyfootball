# Production hardening implementation plan

Approved scope: deploy the verified audit fixes, then implement league isolation and atomic draft/trade operations. New-league creation UI, billing/league wallets, and unrelated historical warehouse rebuilds remain separate work.

## Release 1: audit fixes

- Baseline: PR #154, reviewed head `27804d27c055e585db3a363ddec04d42d3251d53`; merged as `e680e59e943b5037994c2e2dd98fb2d67a9318b8`.
- Passed: quality/security CI, CodeQL, migration upgrade/clean reset, 50 pgTAP database tests, AI concurrency tests, and authenticated HTTP/revocation smoke tests.
- Already live: historian least privilege, worker v3, and migration 021 (hosted version `20261114181422`).
- Deployed: Vercel production dpl_6RGjDtmURVUKTFVjS4KpSqXFFaFN serves the reviewed merge. All post-merge CI and the read-only hosted migration gate pass. Production login and six unauthorized/forged-cookie checks pass; private responses are no-store. Signing key rotated; users must sign in again. Preview uses independent secrets. Real authenticated state transitions were verified in disposable CI, not against customer accounts.
- Preserve the older dirty original checkout. Final work targets current GitHub main through isolated branches.

## Release 2: explicit league context

1. Derive the active context from the verified application session at every protected boundary. Requests may assert an expected league but cannot authorize one.
2. Require explicit, nonoptional league IDs on shared data loaders, identity/history/valuation services, and invalidators. Cache/in-flight keys include league and season where appropriate.
3. Pass verified user/league/roster/role context through the client provider. Isolate browser persistence, delayed responses, Realtime subscriptions, and image URLs/caching.
4. Add tenant keys and composite constraints to confirmed roster-only application tables. Preserve existing CFC records through an explicit verified backfill. Do not guess or delete ambiguous/orphan records.
5. Keep CFC-specific warehouse, history, valuation, branded-art, and draft assumptions behind explicit capability checks. Unsupported leagues receive unavailable/unpriced states rather than another league's data.
6. Background work uses explicit authorized/registered league IDs and actual roster IDs. Global NFL player metadata may remain shared.

## Release 3: transactional runtime

New, narrowly scoped runtime objects are implemented for league revision/configuration, canonical asset ownership, draft-slot mapping, and idempotent command results. These do not replace `ff_master_*` history tables.

- Every draft/trade mutation and source refresh takes the same league transaction lock, followed by consistent row-lock ordering.
- RPCs recheck active provider session, actor membership, league, roster, and role. Guarded definer functions use fixed search paths and service-only execution; direct domain-table writes are retired at cutover.
- Trade create/counter/resolve updates offers, threads, ownership, compatibility/audit records, revision, and command result in one transaction.
- Draft submission, skip/tick, clock transitions, and undo update ownership, selected picks, clock, and command result together.
- A stable idempotency key returns the original committed result on retry. Reusing it with different command content fails with a conflict.
- Fetch external source data outside transactions. Validate complete source snapshots, then compare-and-swap against the revision observed before fetching.
- Provider refresh never overwrites pending internal ownership with stale or intermediate upstream state. A consumed pick needs actual selection evidence.
- Remove in-memory overlay replay as an alternative ownership authority after the database cutover.

## Verification gates

- Two leagues deliberately share roster numbers, player IDs, pick indexes, names, and email identities. Prove isolation in API, direct database access, warm caches, browser state, Realtime, images, and jobs.
- Real concurrent database connections race two trades sharing assets, trade acceptance against drafting a pick, draft selection against ticking, and source refresh against local mutation.
- Verify one valid outcome, no double transfer/selection, and no changes from rejected commands.
- Inject a late database failure and verify complete rollback across every affected record, including idempotency and audit state.
- Verify repeated commands, different payload/same key, revoked sessions/memberships, and foreign-league identifiers.
- Run typecheck, lint, regression tests, production build/router checks, staged migration replay, clean database tests, and remote CI on the exact release head.

## Deployment order

Prepare and review code/SQL first. Record the correspondence between numbered application migrations and already-applied hosted timestamp operations; never blindly reset or rewrite migration history.

Stage the reviewed application, apply the verified schema/runtime bootstrap under a controlled mutation cutover, retire old direct writers, promote the tested application, and run production checks. A brief explicit mutation pause is preferable to allowing old writes to bypass the new transaction boundary. Preserve restrictive authorization during rollback; do not restore broad privileges just to make obsolete callers work.

Do not admit a second league until tenant keys, authorization, context propagation, legacy deployment access, and runtime bootstrap have all passed verification.

## Implementation ownership

| Owner | Scope |
| --- | --- |
| Application security | API routes, auth/session selection, shared API handlers, atomic RPC integration |
| Architecture | Shared loaders/caches, client context, frontend/domain hooks, required engine parameter threading |
| Database | Catalog-confirmed migrations, constraints/RLS, transactional runtime/RPCs, database concurrency tests |
| Parent | Cross-layer review, CI/configuration, release coordination, integration verification, final report |
