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
| C-06 | Complete | Caller-free scouting modules/report scripts and approved routes were removed. The unreachable profile/value/TGIF cluster was removed after preserving its used types; reachable advisor context was retained. |

### Consolidation bullet-by-bullet audit

Each row maps one bullet, in order, from `2026-09-decision-sheet.json`.
“Source” means a reviewed caller/data-flow check rather than a runtime claim.

| Bullet | Status | Implementation and evidence |
|---|---|---|
| C-01.1 | Complete | Removed `useMyRoster` and caller-free `src/scouting/intel/*`; production build proves no unresolved importer. |
| C-01.2 | Complete | Targets, trade-chart/strategy rebuild, draft hook, onboarding, log/order/clock use `shared/league-data`; client consumers use `/api/league/snapshot`. Build + handler review. |
| C-01.3 | Complete | `shared/league-data/sleeper.ts` owns Sleeper transport and dictionary filtering; missing roster dictionary entries follow the one documented exclusion rule. Source + build. |
| C-01.4 | Complete | `LeagueSettings.rosterPositions` comes from Sleeper with `DEFAULT_ROSTER_POSITIONS` as the sole fallback. Source + build. |
| C-01.5 | Complete | Cached and operator-fresh dictionary reads share the Sleeper module; draft-room age delegates to `playerAge`. Source + typecheck. |
| C-02.1 | Complete | `shared/league-data/picks.ts` is the parser; engine re-exports/delegates and Set Availability imports it directly. `test:league`. |
| C-02.2 | Complete | Shared label/big-text/ordinal functions replaced the removed display parser; remaining department presentation adds context but does not parse identity. `test:league` + build. |
| C-02.3 | Complete | Shared March-based `getCFCYear`; `draft_log.cfc_year` generated contract remains in migration 005. February/March fixture. |
| C-02.4 | Complete | Trade-chart anchors and valuation both use version-pinned `getPickValues`; comments/types distinguish zero-based `pick_index` from one-based overall/slot. Ladder fixture and migration 019. |
| C-02.5 | Complete | Runtime status, ownership, draft ingest and UI use Sleeper draft/league counts; offline lobby uses zero rather than inventing 12. D-37's provider request intentionally remains fixed at 12. Non-12 fixture + build. |
| C-02.6 | Complete | Draft calendar consumes shared CFC year/status. Source + build. |
| C-02.7 | Complete | Draft clock state exports `INITIAL_PICK_SECONDS`; wall-clock half-hour announcement is a boundary calculation, not a second duration setting. Source + build. |
| C-02.8 | Complete | Both advisor prompts render actual pre-draft/round-one/complete state via `draftTradeContext`. Three-state fixture; no provider call. |
| C-03.1 | Complete | Live insider/NFL/pick-values/targets consumers use shared values; dead intel reader removed. Source + parity tests. |
| C-03.2 | Complete | Trade creation snapshots `valueAsset` results; snapshots stay immutable history. Source + parity test. |
| C-03.3 | Complete | Stud maps and callers key by Sleeper player ID. Source + roster fixture. |
| C-03.4 | Complete | Writers use canonical `draft_picks`/`elite_producers`/`young_upside`/`roster_depth`; reads translate legacy short tokens. Typecheck + source. |
| C-03.5 | Complete | Refresh metadata position comes from the shared Sleeper dictionary. Source review. |
| C-03.6 | Complete | Live league dictionary is used for current roster/player rendering with stored offer labels retained only as historical fallback; values remain the stored snapshot. Source review. |
| C-03.7 | Complete | Inbox, insider and memo timestamps delegate to `shared/time/relative.ts`; Historian retains the same browser-only conversation timestamp contract outside this takeover. Build. |
| C-04.1 | Complete with corrected caller audit | Removed the runtime-unreachable profile/value/TGIF cluster after moving its imported types to `profileTypes.ts`. Reachable advisor context remains because `prompt.ts` imports it. Studio persona delegates to locked bands. Caller search + build. |
| C-04.2 | Complete | Studio persists reciprocal feedback from both seats rather than inverting one ratio. Source + trade parity fixture. |
| C-04.3 | Complete | Current persona bands and paths regenerated in `CFC-APP-STATUS`, `CFC-PREFERENCES`, and `CLAUDE.md`. Documentation diff checked against code. |
| C-05.1 | Complete | Shared stored-team reader/key is used by draft/onboarding/mobile; duplicate constant removed. Build. |
| C-05.2 | Complete / rollout configuration required | Personality tables are keyed by base slug; server identity prefers private roster-id→base-slug configuration, then remembered/source identity. Rename/source-outage fixture passes. Deployment must supply the verified private map; no personal identity is embedded. |
| C-05.3 | Complete | Home loading state is neutral “Your Franchise.” Source + build. |
| C-05.4 | Complete | Draft-log writes authorize stable IDs and overwrite client labels with canonical names; reads resolve current team/player names by ID and retain stored snapshots only as outage compatibility fallback. Misleading-label/rename/dictionary fixture. |
| C-05.5 | Complete | All privileged ingestion, including Fleaflicker roster detail, uses the infrastructure admin factory; login/signup use a fresh stateless Auth factory. Security tests + constructor search. |
| C-05.6 | Complete | Career history traverses stable franchise map across seasons. Source review. |
| C-05.7 | Complete / DB-CI pending | Migration 020 checks collisions, normalizes, rejects blanks and enforces normalized uniqueness on both `team_email_map` (auth join) and `league_invitations`; 40 pgTAP cases execute in combined CI. |
| C-05.8 | Complete | Big Board and logo mutations require signed current membership/owned roster. Handler/HTTP fixtures. |
| C-06.1 | Complete | Listed caller-free league/debug/intel/memo/draft-sim/health routes removed; build route manifest verifies absence. |
| C-06.2 | Complete | Listed zero-import modules/scripts removed, including duplicate pick display and stale studio reports. Caller search + build. |
| C-06.3 | Complete | Required admin ingestion remains and is secret/admin gated. Security integration test. |
| C-06.4 | Complete with corrected audit finding | Every DEAD-01 candidate was caller-checked; genuinely dead items were removed, while reachable advisor context was retained; the mutually isolated profile/value/TGIF cluster was removed after imported types moved. |

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
