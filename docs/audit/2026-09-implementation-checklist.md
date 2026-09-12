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
| C-04 | Partial | Studio and trade-up simulation run through canonical engines; draft-room profiles use the shared feed. Trade-back simulation still uses its specialized package generator. |
| C-05 | Partial | Changed private endpoints use current membership and commissioner role; a complete untouched-route authorization audit remains. |
| C-06 | Complete | Zero-import modules and caller-free debug/intel/memo/draft-sim/health routes were verified by repository search and removed. |

## Divergences

| ID | Status | Evidence / remaining work |
|---|---|---|
| D-01 | Complete | Targets and Set Availability roster rebuilds use `getLeagueData().teams`. |
| D-02 | Complete | Targets no longer drops zero-valued roster players. |
| D-03 | Complete | Migration 018 adds accepted overlays; the shared feed applies them and a secret-gated cron reconciles only after Sleeper matches. |
| D-04 | Complete | Draft room now adapts the authenticated league snapshot and makes no direct Sleeper requests. |
| D-05 | Complete | Live hook clears data and reports Sleeper unavailable; demo fallback was removed. |
| D-06 | Complete | Draft, accepted trade, strategy, attachment, rename and value rebuild writes invalidate shared bundle/value caches. |
| D-07 | Complete | Onboarding loads every roster player from the snapshot; the 25-player truncation was removed. |
| D-08 | Complete | Converted display consumers call shared valuation with the authenticated viewer perspective. |
| D-09 | Complete | Shared status unions submitted app picks and Sleeper picks; completed draft advances the season. |
| D-10 | Complete | Calendar uses shared status, mock URL redirects, and a read-only results board is live. |
| D-11 | Complete | Draft room derives its pick adapter exclusively from snapshot `pickOwnership`. |
| D-12 | Complete | Migration 018 archives collisions and migrates attachment/class/value/offer keys; runtime reads old keys during rollout. |
| D-13 | Complete | Current unslotted picks use projected finish, never roster index. |
| D-14 | Complete | Player and pick display values use the same viewer perspective in converted consumers. |
| D-15 | Complete | CFC year and first-undrafted three-season horizon are derived centrally. |
| D-16 | Partial | Ladder remains fixed and missing anchors degrade to zero; versioned seed awaits confirmed live row shape. |
| D-17 | Complete | Request-time roster backfill and its sole module were removed. |
| D-18 | Complete | Player/pick modifiers are +20/+10/0/-10 in both shared and rebuild paths. |
| D-19 | Complete | Onboarding saves attachments, patch-merges strategy, rebuilds values, then invalidates caches. |
| D-20 | Complete | NFL situation context now emits league-value percentiles before letter grading. |
| D-21 | Complete | Relevant strategy, tag, override, draft, rename and overlay paths invalidate bundle and valuation caches. |
| D-22 | Complete | Create, advisor, Studio, memo and drawer paths price through shared context and persona-aware grades; fixture parity is required below. |
| D-23 | Complete | Counter drawer uses canonical viewer prices and persona-aware grading; sent offers are regraded server-side. |
| D-24 | Complete | Studio route now builds an `EngineContext` and runs `runStudio`; its response mapper preserves the UI contract. |
| D-25 | Partial | Trade-up simulation now adapts `runScouting`; trade-back retains its specialized package generator and still needs an engine adapter. |
| D-26 | Complete | Memo offer cards fetch a participant-authorized live persona grade at render time. |
| D-27 | Complete | Vercel schedules the secret-gated sweep; calls use explicit background metering attribution and remain fail-closed. |
| D-28 | Partial | All changed private reads/writes require current membership; untouched endpoint audit remains. |
| D-29 | Complete (security base) | Commissioner authority is the stable membership role; no personal email was added to code. |
| D-30 | Complete | Draft components use the shared stored-team reader/writer while server authorization remains current membership. |
| D-31 | Complete | Identity exposes full name, location and shared exception-aware nickname; rename override and roster-keyed art/personality survive. |
| D-32 | Complete | Snapshot ships the canonical fantasy-player pool; draft room/onboarding consume it and rookie filtering uses Sleeper experience. |
| D-33 | Complete | Draft pool derives rookies from Sleeper years of experience; curated rows only enrich missing bios/draft fields. |
| D-34 | Complete | Snapshot serializes shared team profiles and the draft-room adapter derives its legacy display shape from those facts. |
| D-35 | Complete | The single strategy save function merges submitted fields over the stored profile before normalization/upsert. |
| D-36 | Complete | Studio configuration delegates validation/normalization to the roster-keyed canonical persona source. |
| D-37 | Complete | Existing fetch configuration remains 0.5 PPR, superflex, 12 teams. |
| D-38 | Complete | All eight call sites resolve one configurable model; unsupported pricing fails before provider dispatch. |
| D-39 | Complete | Draft/home badge now uses the inbox attention-count route; the duplicate home count route was removed. |
| D-40 | Complete | Clock-bar trade-up writes the existing builder seed contract and navigates to the real builder route. |
| D-41 | Complete | Unimplemented Team HQ tile and mobile nav entry removed. |
| D-42 | Complete | Chats remain browser-only; no persistence added. |

## Database decisions

| ID | Status | Evidence / remaining work |
|---|---|---|
| DB-01 | Prepared / live-blocked | Strict read-only inventory, archive/checksum script, fail-closed rename/drop proposals and runbook exist; live inventory/restore/approval remain. |
| DB-02 | Prepared / live-blocked | Raw caches are in inventory/archive tooling; dependency results and verified restore are required before rename/drop. |
| DB-03 | Prepared / live-blocked | OID/text/job inventory is prepared; external Historian job ownership still requires production evidence. |
| DB-04 | Complete (retain) | Flea/MFL mirrors were not changed. |
| DB-05 | Prepared / live-blocked | Orphans are catalogued without asserting existence; zero-dependency and archive evidence remain required. |
| DB-06 | Complete | Migration 017 preserves Flea/MFL and replaces only Sleeper selected-by actual results; automated sync calls the hardened rebuild. |
| DB-07 | Prepared / live-blocked | CI baseline is retained and live-only DDL/pick ladder queries are prepared; production definitions remain required. |

## Provenance

The branch starts at verified security head
`005f2fec3821ebb37b71aa43b392d1deee57aa61` and cherry-picks the four
published audit files at `d1d62caf9c1c817aa8961516a8a7dfd4ee15cb16`.
Object `ff91766` is not present after an authorized fetch, so none of its
reported 39-file patch is represented as copied or independently verified.
