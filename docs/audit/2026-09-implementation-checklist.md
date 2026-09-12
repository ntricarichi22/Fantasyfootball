# Approved 55-item implementation and verification checklist

Status is against this branch, not the unavailable Claude commit. **Complete**
means code and a local check exist; **partial** names remaining work; **blocked**
requires live metadata or a destructive rollout approval.

## Consolidation blocks

| ID | Status | Evidence / remaining work |
|---|---|---|
| C-01 | Partial | Targets now consumes shared rosters; strategy, onboarding and draft-room consumers still need conversion. |
| C-02 | Complete | Shared slot-free key parser/formatter/year helpers added and engine parser delegates to it. |
| C-03 | Partial | Shared viewer valuation now handles slot-free picks; remaining direct-table readers need conversion. |
| C-04 | Partial | Drifted Studio ratio bands removed; legacy profile/value adapter remains because it has a live importer. |
| C-05 | Partial | Snapshot and feedback reads/writes use trusted sessions; remaining display-only storage readers need conversion. |
| C-06 | Partial | Four independently confirmed zero-import modules removed; route inventory needs caller verification before deletion. |

## Divergences

| ID | Status | Evidence / remaining work |
|---|---|---|
| D-01 | Partial | Targets uses `league.teams`; Set Availability service remains. |
| D-02 | Complete | Targets no longer drops zero-valued roster players. |
| D-03 | Still needed | Needs a confirmed pending-overlay schema and reconciliation marker; no table was invented without live inspection. |
| D-04 | Still needed | Draft room still uses its legacy browser feed. |
| D-05 | Still needed | Live room demo fallback remains. |
| D-06 | Partial | Shared bundle/draft/value invalidator exists and attachment writes use it; audit all writes. |
| D-07 | Still needed | Onboarding pagination conversion remains. |
| D-08 | Partial | Targets values every player and pick from viewer perspective. |
| D-09 | Complete | Shared status unions submitted app picks and Sleeper picks; completed draft advances the season. |
| D-10 | Complete | Calendar uses shared status, mock URL redirects, and a read-only results board is live. |
| D-11 | Still needed | Draft-room pick ownership conversion remains. |
| D-12 | Partial | New keys are slot-free and old keys parse; persisted-key SQL awaits live column inspection. |
| D-13 | Complete | Current unslotted picks use projected finish, never roster index. |
| D-14 | Partial | Shared valuation and targets comply; remaining surfaces need parity conversion. |
| D-15 | Complete | CFC year and first-undrafted three-season horizon are derived centrally. |
| D-16 | Partial | Ladder remains fixed and missing anchors degrade to zero; versioned seed awaits confirmed live row shape. |
| D-17 | Complete | Request-time roster backfill and its sole module were removed. |
| D-18 | Complete | Player/pick modifiers are +20/+10/0/-10 in both shared and rebuild paths. |
| D-19 | Still needed | Onboarding save must call rebuild and invalidation. |
| D-20 | Still needed | Scouting grade percentile conversion remains. |
| D-21 | Partial | Attachment invalidates caches; all value/tag/override writers need audit. |
| D-22 | Partial | Canonical engine exists; all display surfaces have not been parity-tested. |
| D-23 | Still needed | Drawer parity conversion remains. |
| D-24 | Still needed | Studio adapter conversion remains. |
| D-25 | Still needed | Mock-draft adapter conversion remains. |
| D-26 | Still needed | Memo render-time regrade remains. |
| D-27 | Still needed | Existing user-scoped sweep cannot safely be cron-called as-is; background attribution/refactor remains. |
| D-28 | Partial | New snapshot/player-values/feedback routes require current membership; full endpoint audit remains. |
| D-29 | Complete (security base) | Commissioner authority is the stable membership role; no personal email was added to code. |
| D-30 | Partial | New private routes use verified account/membership; legacy display readers remain. |
| D-31 | Partial | Existing rename override is preserved; full-name/location/nickname resolver consolidation remains. |
| D-32 | Still needed | Board pool consolidation remains. |
| D-33 | Still needed | Rookie class derivation remains. |
| D-34 | Still needed | Draft-room profiler migration remains. |
| D-35 | Still needed | Strategy patch/merge save path remains. |
| D-36 | Partial | Persona ratio bands now have one math source; voice mapping audit remains. |
| D-37 | Complete | Existing fetch configuration remains 0.5 PPR, superflex, 12 teams. |
| D-38 | Partial | Security base meters providers; historian still has a separate literal model setting. |
| D-39 | Still needed | Open-trade route consolidation remains. |
| D-40 | Still needed | Trade-up builder seed wiring remains. |
| D-41 | Complete | Unimplemented Team HQ tile and mobile nav entry removed. |
| D-42 | Complete | Chats remain browser-only; no persistence added. |

## Database decisions

| ID | Status | Evidence / remaining work |
|---|---|---|
| DB-01 | Blocked | Read-only inventory + archive/restore evidence required before migration 018. |
| DB-02 | Blocked | Raw cache dependencies and archive must be verified live. |
| DB-03 | Blocked | External Historian build provenance is not visible from this environment. |
| DB-04 | Complete (retain) | Flea/MFL mirrors were not changed. |
| DB-05 | Blocked | Live existence and zero-dependency proof required. |
| DB-06 | Complete (security base) | Migration 017 preserves Flea/MFL and replaces only Sleeper actual results; 004 mirrors selected-by only. |
| DB-07 | Partial | CI-only pre-001 baseline exists; remaining live-only DDL needs metadata capture. |

## Provenance

The branch starts at verified security head
`005f2fec3821ebb37b71aa43b392d1deee57aa61` and cherry-picks the four
published audit files at `d1d62caf9c1c817aa8961516a8a7dfd4ee15cb16`.
Object `ff91766` is not present after an authorized fetch, so none of its
reported 39-file patch is represented as copied or independently verified.
