# Approved 55-item implementation and verification checklist

Status is against this branch, not the unavailable Claude commit. **Complete**
means code and a local check exist; **partial** names remaining work; **blocked**
requires live metadata or a destructive rollout approval.

## Consolidation blocks

| ID | Status | Evidence / remaining work |
|---|---|---|
| C-01 | Complete | Targets, Set Availability rebuilds, onboarding, draft room, draft order and clock consume the shared server feed. |
| C-02 | Complete | Shared slot-free key parser/formatter/year helpers added and engine parser delegates to it. |
| C-03 | Complete | Targets, offer snapshots, insider, pick-values and NFL context use shared viewer-aware valuation; storage-only rebuild code remains. |
| C-04 | Complete | Studio, trade-up and trade-back use the canonical engine adapters; draft-room profiles use the shared feed. |
| C-05 | Complete | Private route audit is recorded; ownership routes use current membership/resource participation and administrative routes use stable roles or centralized secrets. |
| C-06 | Complete | Zero-import modules and caller-free debug/intel/memo/draft-sim/health routes were verified by repository search and removed. |

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
| D-16 | Live-evidence blocked | Ladder remains fixed and missing anchors degrade to zero; versioned seed awaits the exact confirmed 1.01–3.12 `pick_template` values and `cfc_assets` constraints returned by `pick-ladder-readonly.sql`. |
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
| D-28 | Complete | Full service-client/private-route review is documented; team-scoped endpoints reject foreign roster IDs and resource handlers verify ownership/participation. |
| D-29 | Complete | Commissioner controls derive from the current stable membership role; all three Founders-name route fallbacks and the dead name-based resolver were removed. |
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
| DB-07 | Prepared / live-blocked | Combined two-phase CI includes 018; exact ladder/constraint capture, combined CI, approved isolated restore and rollout remain required. |

## Provenance

The branch starts at verified security head
`005f2fec3821ebb37b71aa43b392d1deee57aa61`, integrates security head
`b90603a91ae89bd6b568b30936808f2213470615`, and cherry-picks the four
published audit files at `d1d62caf9c1c817aa8961516a8a7dfd4ee15cb16`.
Object `ff91766` is not present after an authorized fetch, so none of its
reported 39-file patch is represented as copied or independently verified.
