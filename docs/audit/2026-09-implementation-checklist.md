# Approved 55-item implementation and verification checklist

Status is against this branch, not the unavailable Claude commit. **Complete**
means code and a local check exist; **partial** names remaining work; **blocked**
requires live metadata or a destructive rollout approval.

Current review status: all **55 decisions have review-branch implementations or
explicit safe preparations**. DB-01/02/03/05/07 remain operationally blocked;
prepared scripts are not executed cleanup. Database-CI-dependent rows are not
represented as executed until the combined published SHA passes its disposable
workflow through migration 020.

## Consolidation blocks

| ID | Status | Evidence / remaining work |
|---|---|---|
| C-01 | Complete | Targets, Set Availability rebuilds, onboarding, draft room, draft order and clock consume the shared server feed. The dead scouting loader was removed; the value rebuild's required fresh dictionary read now uses the shared Sleeper transport. |
| C-02 | Complete | Shared slot-free key parser/formatter/year helpers added; engine and Set Availability display delegate to it, and draft-status arithmetic uses the live roster count. |
| C-03 | Complete | Targets, offer snapshots, insider, pick-values and NFL context use shared viewer-aware valuation. Strategy writes use the canonical vocabulary while reads translate four legacy tokens. |
| C-04 | Complete | Studio, trade-up and trade-back use the canonical engine adapters; draft-room profiles use the shared feed. |
| C-05 | Complete / DB-CI pending | Private route fixtures cover trade tabs, offer/thread participation, targets privacy and insider scope. Auth uses a stateless anon factory, ingestion uses the server-only admin factory, rename-stable personality mapping uses Sleeper-origin identity, and migration 020 enforces normalized invitation identity. |
| C-06 | Complete | Caller-free scouting modules/report scripts and approved routes were removed. `trade-engine/value.ts` and advisor context were retained after current callers disproved the old zero-import finding. |

### Consolidation bullet audit

- **C-01:** one cached Sleeper module owns player/league transport and age logic;
  operator value rebuild explicitly requests its fresh variant. Roster position
  fallback and missing-player filtering remain canonical. Dead intel loaders are gone.
- **C-02:** durable parsing, labels, March CFC year, season/round discovery and
  spent-season behavior are shared. Runtime draft status uses fetched roster count;
  the source-provider format remains intentionally fixed at 12 teams under D-37.
- **C-03:** canonical valuation and immutable offer snapshots remain intact;
  onboarding now writes `draft_picks`/`elite_producers`/`young_upside`/`roster_depth`,
  while existing short-form stored values are translated on read.
- **C-04:** Builder/Studio/drawers/memos and scouting adapters retain canonical
  grade/value parity. Stale persona/path documentation was corrected. Modules
  found to have current runtime callers were retained rather than deleted.
- **C-05:** display selection is never authorization; private routes use signed
  current membership. Server admin/Auth clients have distinct centralized
  factories. Neutral loading identity and Sleeper-origin personality identity
  survive an in-app rename. Migration 020 aborts on existing normalized email
  collisions, normalizes future writes and rejects blanks/duplicates.
- **C-06:** caller-free intel modules and report scripts are removed in addition
  to the previously removed route/module set; guarded ingestion remains.

## Divergences

| ID | Status | Evidence / remaining work |
|---|---|---|
| D-01 | Complete | Targets and Set Availability roster rebuilds use `getLeagueData().teams`. |
| D-02 | Complete | Canonical league data retains every rostered player; missing team values fall back to league base, then a tagged zero shared by Builder, Studio and Door. |
| D-03 | Complete | Migration 018 adds accepted overlays; the shared feed applies them and a secret-gated cron reconciles only after Sleeper matches. |
| D-04 | Complete | Draft room now adapts the authenticated league snapshot and makes no direct Sleeper requests. |
| D-05 | Complete | Live hook clears data and reports Sleeper unavailable; demo fallback was removed. |
| D-06 | Complete | Draft, accepted trade, strategy, attachment, rename and value rebuild writes invalidate shared bundle/value caches. |
| D-07 | Complete | Onboarding loads every roster player from the snapshot; the 25-player truncation was removed. |
| D-08 | Complete | Converted display consumers call shared valuation with the authenticated viewer perspective. |
| D-09 | Complete | App rows are current-season scoped; shared status unions app/Sleeper rows and a completed Sleeper draft spends every configured round/slot. |
| D-10 | Complete | Calendar uses shared status, mock URL redirects, and the read-only results board is implemented on this review branch (not deployed). |
| D-11 | Complete | Draft room derives its pick adapter exclusively from snapshot `pickOwnership`. |
| D-12 | Complete | Migration 018 archives collisions and migrates attachment/class/value/offer keys; runtime reads old keys during rollout. |
| D-13 | Complete | Current unslotted picks use projected finish, never roster index. |
| D-14 | Complete | Player and pick display values use the same viewer perspective in converted consumers. |
| D-15 | Complete | CFC year rolls in March; Sleeper draft seasons/rounds and traded capital extend the default horizon, including 2029 and round 4 fixtures. |
| D-16 | Complete / DB-CI pending | Version `2026-09-12.v1` freezes all 36 approved anchors in runtime and migration 019; conflicts fail closed and unapproved rounds remain explicitly unpriced. |
| D-17 | Complete | Request-time roster backfill and its sole module were removed. |
| D-18 | Complete | Player/pick modifiers are +20/+10/0/-10 in both shared and rebuild paths. |
| D-19 | Complete | Onboarding saves attachments, patch-merges strategy, rebuilds values, then invalidates caches. |
| D-20 | Complete | NFL situation context now emits league-value percentiles before letter grading. |
| D-21 | Complete | Relevant strategy, tag, override, draft, rename and overlay paths invalidate bundle and valuation caches. |
| D-22 | Complete | Create, advisor, Studio, memo and drawer paths share canonical pricing/persona grading; deterministic grade and roster-value fixtures protect their common contracts. |
| D-23 | Complete | Counter drawer uses canonical viewer prices and persona-aware grading; sent offers are regraded server-side. |
| D-24 | Complete | Studio route now builds an `EngineContext` and runs `runStudio`; its response mapper preserves the UI contract. |
| D-25 | Complete | Both trade-up and trade-back simulations adapt `runScouting` and retain the existing board response contract. |
| D-26 | Complete | Memo offer cards fetch a participant-authorized live persona grade at render time. |
| D-27 | Complete | Vercel schedules the secret-gated sweep; calls use explicit background metering attribution and remain fail-closed. |
| D-28 | Complete | Service-client routes now reject invalid tabs before queries, scope single/list resources by participant, and suppress counterpart strategy/attachment inputs. |
| D-29 | Complete | Authority is a verified user+league membership role; explicit audited operator assignment replaces inference, survives rename/email changes, denies self-promotion, and is removed by revocation. |
| D-30 | Complete | Draft components use the shared stored-team reader/writer while server authorization remains current membership. |
| D-31 | Complete | Identity exposes full name, location and shared exception-aware nickname; rename override and roster-keyed art/personality survive. |
| D-32 | Complete | Snapshot ships the canonical fantasy-player pool; draft room/onboarding consume it and rookie filtering uses Sleeper experience. |
| D-33 | Complete | Draft pool derives rookies from Sleeper years of experience; curated rows only enrich missing bios/draft fields. |
| D-34 | Complete | Snapshot serializes shared team profiles and the draft-room adapter derives its legacy display shape from those facts. |
| D-35 | Complete | The single strategy save function merges submitted fields over the stored profile before normalization/upsert. |
| D-36 | Complete | Studio configuration delegates validation/normalization to the roster-keyed canonical persona source. |
| D-37 | Complete | The selected custom setting is fixed explicitly at 0.5 PPR, two-QB/superflex and 12 teams. |
| D-38 | Complete | All eight call sites resolve one configurable model; unsupported pricing fails before provider dispatch. |
| D-39 | Complete | Draft/home badge now uses the inbox attention-count route; the duplicate home count route was removed. |
| D-40 | Complete | Clock-bar trade-up writes the existing builder seed contract and navigates to the real builder route. |
| D-41 | Complete | Unimplemented Team HQ tile and mobile nav entry removed. |
| D-42 | Complete | Chats remain browser-only; no persistence added. |

## Database decisions

| ID | Status | Evidence / remaining work |
|---|---|---|
| DB-01 | Prepared / live-blocked | Sanitized live catalog evidence excludes absent relations; archive/checksum and fail-closed proposals exist. Exact counts, restore proof and destructive approval remain. |
| DB-02 | Prepared / retain/live-blocked | Sleeper raw smoke is retained for 16 dependent views; Flea/MFL FK dependencies are recorded. External jobs and verified restore remain required before any other raw action. |
| DB-03 | Prepared / live-blocked | No public ordinary function or database scheduler match was found; external/dynamic Historian job ownership still requires evidence. |
| DB-04 | Complete (retain) | Flea/MFL mirrors were not changed. |
| DB-05 | Prepared / live-blocked | Staging is confirmed absent; watchlist estimated zero is not emptiness proof. Exact count, external dependency and archive evidence remain required. |
| DB-06 | Complete | Migration 017 preserves Flea/MFL and replaces only Sleeper selected-by actual results; automated sync calls the hardened rebuild. |
| DB-07 | Prepared / live-blocked | Combined two-phase CI includes constrained 018 fixtures, ladder 019 and normalized-invitation migration 020; combined CI, approved isolated restore and rollout remain required. |

## Provenance

The branch starts at verified security head
`005f2fec3821ebb37b71aa43b392d1deee57aa61`, integrates security head
`e54df407b94a0197052745992c59a85016cede9d`, and cherry-picks the four
published audit files at `d1d62caf9c1c817aa8961516a8a7dfd4ee15cb16`.
Object `ff91766` is not present after an authorized fetch, so none of its
reported 39-file patch is represented as copied or independently verified.

## Per-decision verification scenarios

These are review-branch checks, not production rollout claims.

| ID | Verification scenario |
|---|---|
| C-01 | Build plus authenticated snapshot/onboarding/draft-room caller review. |
| C-02 | `test:league`: durable and retired-key parsing. |
| C-03 | `test:roster-values` plus shared valuation consumer review. |
| C-04 | `test:trade-parity`; Studio and both scouting adapters compile in the production build. |
| C-05 | Disposable HTTP/Auth fixture, migration-020 pgTAP cases and `2026-09-private-route-audit.md`; combined CI pending. |
| C-06 | Production-build route manifest and caller-removal review. |
| D-01 | Authenticated snapshot caller/build scenario. |
| D-02 | `test:roster-values`: team → league → tagged-zero fallback. |
| D-03 | `test:league`: immutable player/pick overlay; migration/HTTP CI pending. |
| D-04 | Production build of snapshot-only draft-room hook. |
| D-05 | Hook error-path review: state clears without demo substitution. |
| D-06 | Write-handler invalidation review and integration-security suite. |
| D-07 | Snapshot fixture retains full roster; production build verifies contract. |
| D-08 | `test:trade-parity` and viewer-valued route review. |
| D-09 | `test:league`: complete 48-slot draft and incomplete/current-season isolation. |
| D-10 | Production build includes `/scouting/draft-room/results`; not deployed. |
| D-11 | Snapshot pick adapter contract in production build. |
| D-12 | `test:league` retired-key compatibility; real 018 execution pending combined CI. |
| D-13 | Shared valuation scenario uses projected owner slot when actual slot is absent. |
| D-14 | `test:trade-parity` plus viewer-aware value route review. |
| D-15 | `test:league`: February/March rollover, 2029 traded pick and round 4. |
| D-16 | `test:league` checks version, 36 anchors, endpoints and unpriced round 4; constrained migration fixture awaits combined CI. |
| D-17 | Production-build route/import graph after backfill removal. |
| D-18 | Modifier unit/source review and type/build checks. |
| D-19 | Onboarding save/rebuild/invalidate handler sequence review. |
| D-20 | NFL-context percentile calculation type/build scenario. |
| D-21 | Mutation-handler invalidation audit. |
| D-22 | `test:trade-parity` and `test:roster-values`. |
| D-23 | `test:trade-parity`; drawer compiles against canonical grade contract. |
| D-24 | Studio `EngineContext`/`runStudio` production-build scenario. |
| D-25 | Trade-up and trade-back `runScouting` adapters plus foreign-roster HTTP cases. |
| D-26 | Participant-authorized memo list live-grade handler review. |
| D-27 | AI tests cover metering/retry/identity; cron/admin boundary integration test. |
| D-28 | Disposable HTTP foreign/cross-league/resource tests and route audit. |
| D-29 | Authorization tests plus renamed-team/no-name-authority source review. |
| D-30 | Signed server authorization tests; shared display-team storage build scenario. |
| D-31 | Snapshot identity build scenario retaining override/full/location/nickname fields. |
| D-32 | Snapshot player-pool and rookie-filter production build. |
| D-33 | Rookie years-of-experience enrichment path production build. |
| D-34 | Shared profile serialization/adapter production build. |
| D-35 | Strategy patch-merge handler review and type/build checks. |
| D-36 | `test:trade-parity` and canonical persona normalization review. |
| D-37 | FantasyCalc request configuration: `ppr=0.5`, `numQbs=2`, `numTeams=12`. |
| D-38 | `test:ai`: verified model coverage, bounded accounting, no retries. |
| D-39 | Production-build route manifest confirms one inbox count route. |
| D-40 | Clock builder-seed contract production build. |
| D-41 | Production-build navigation manifest after tile removal. |
| D-42 | Storage/schema review confirms no chat persistence was introduced. |
| DB-01 | Read-only catalog evidence plus fail-closed proposal/archive syntax checks. |
| DB-02 | Catalog dependency scenario retains 16-view Sleeper chain; restore still blocked. |
| DB-03 | Catalog function/scheduler result recorded; external jobs still blocked. |
| DB-04 | Migration 017 review retains Flea/MFL inputs. |
| DB-05 | Catalog confirms staging absent; watchlist exact emptiness remains blocked. |
| DB-06 | Migration validator plus Sleeper draft-sync route/rebuild review; real CI pending. |
| DB-07 | Two-phase harness covers 000–020 with FK/collision/identity/normalized-email fixtures; real combined execution and restore remain blocked. |
