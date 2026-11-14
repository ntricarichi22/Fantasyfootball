# League runtime rollout

Prepared for review; **022/023 and this cutover have not been applied to production**.
Live schema was inspected on 2026-11-14. Historical `ff_master_*` objects are untouched.
CLI 3.1.0 generated the files before adaptation to the repository's 022/023 convention.

Read-only CFC bootstrap compatibility check on 2026-11-14: 12 provider results and
12 application results; 0 missing/extra rows, 0 player mismatches, 0 selecting-roster
mismatches, 0 skipped/unannounced rows, and 0 missing player metadata records.
Existing state is completed at index 12 with zero remaining seconds. The verified
source snapshot contains 415 assets (271 players, 144 picks), 12 slots and 12 actual
results. Repeat the aggregate comparison under the rollout mutation pause.

1. Run clean and staged CI, pgTAP, and `scripts/test-league-runtime-concurrency.mjs` against a disposable database. The CI matrix covers PostgreSQL 15 and 17; production is 17. Both matrix jobs must pass before rollout. A local PGlite PostgreSQL execution check is supplemental, not a concurrency/production substitute.
2. Reconcile the already documented live timestamp/numbered migration history first. Never replay historical warehouse migrations or reset production. Apply **only** reviewed 022 and 023 as expansion. They retain legacy conflict keys/defaults and leave all runtime writes disabled.
3. Deploy the matching application with mutation maintenance enabled and stop the old draft/reconcile jobs. Drain in-flight old mutations. Keep the pause until the last step: bootstrapping while an old writer is still active is unsafe.
4. For each existing league, fetch an uncached verified complete Sleeper roster/pick/actual-result snapshot after reading the runtime revision. Bootstrap using the session-validated user refresh RPC. The machine refresh RPC requires an already registered runtime. Do not synthesize an actor session for cron. CFC configuration stays **2026, 12 teams, 1 round, 1800 seconds**. Unknown leagues without an authoritative draft order remain uninitialized. Resolve `legacy_trades_require_reconciliation` explicitly; bootstrap never guesses which historical trade chain has reached Sleeper.
5. Compare effective roster counts, immutable slot identities, current selection links, pending assets, and announced-pick visibility. All existing draft/trade leagues must be initialized. Verify service-role credentials are server-only and external providers cannot call these machine endpoints.
6. In a reviewed database session run `SET cfc.runtime_cutover='approved';`, then the complete rerunnable `league_runtime_cutover.sql`. It removes old conflict targets/defaults, revokes direct offer/status/overlay/draft writes, preserves inventoried chat/read metadata column grants, and enables initialized runtimes in one transaction. If any precondition fails, the transaction rolls back. This operation is intentionally outside automatic migrations.
7. Smoke-test two leagues, a member/commissioner, submit/reveal, trade acceptance, refresh, logout revocation, and a duplicate command. Resume only the new application/jobs. A rollback after cutover means pausing writes and deploying a compatible RPC client; **never restore the old direct-write app/grants while the canonical ledger is active**.

All mutators serialize on the same per-league transaction lock, validate provider session/current membership for user commands, compare the expected revision, and atomically save the result under actor + request ID. Retries check the persisted result before revision validation. Revision is a concurrency token and is deliberately excluded from the payload hash. Trade-create hashes sorted asset identities/parties/parent, excluding computed prices and display text. Reusing a request ID with different intent returns `PT409`.

Ownership keeps both the last observed provider state and the desired effective state. Pending local changes survive refresh until the provider exactly matches the latest effective owner/consumed state. An intermediate A→B observation never reverses an accepted A→B→C chain. Source refresh uses CAS and refuses stale timestamps. Consumed picks come from actual results; a completed provider draft alone is insufficient. The optional `actual_picks` snapshot array contains `{pick_index,player_id,roster_id,submitted_at?}` from actual provider selections. It records selected-by roster separately from current ownership; traded or dropped players stay with their current provider owner or remain free agents. Current-season consumed slots without actual/application result rows fail closed. An unowned player omitted from a complete roster snapshot is safe to clear only when no local mutation is pending.

`cfc_get_league_runtime_public(league)` is a service-only, single-statement snapshot for shared caches; it excludes every unpublished drafted player. The session-validated viewer reader may include the viewer's own pending pick and must never feed a shared cache. Only the private DB implementation can write runtime tables. Machine tick can only perform due transitions; it cannot force, impersonate, or create leagues. Use a fresh request ID per no-op attempt, or include the observed revision in a deterministic ID.

Errors use PostgREST `PT400` invalid input, `PT401` inactive provider session, `PT403` membership/role/roster denial, `PT404` missing resource, `PT409` stale revision/ownership/transition/idempotency conflict, and `PT503` uninitialized/paused runtime. Refresh while paused is permitted. Direct mutation remains closed until cutover.

## Provider onboarding constraints

Non-CFC bootstrap requires exactly one authoritative current-season Sleeper draft with explicit valid rounds and a published order. Only that season's picks are imported. Multi-round drafts must explicitly report `type: "linear"` with no reversal; snake, auction, reversal, and missing/unknown type metadata fail closed until their slot ordering is supported. Sleeper documents draft `type` in its [API reference](https://docs.sleeper.com/#get-all-drafts-for-a-league); the current CFC provider record was checked read-only and reports `linear`, three rounds, and `reversal_round: 0`. CFC retains its explicit three-round, multi-year asset horizon and one managed round.

The separate league-onboarding work must explicitly configure future rookie rules and pick inventory before enabling future picks for other leagues. Startup draft rounds never implicitly define future rookie rounds. Unsupported or ambiguous provider configurations remain uninitialized; do not bypass these checks or synthesize slots.
