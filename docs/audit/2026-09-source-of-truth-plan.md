# Single Source of Truth Refactor + Supabase Cleanup

## Context

The CFC Front Office app grew module-by-module (scouting, pro-personnel, research-strategy, inbox, historian), and several modules built their own path to the same facts. Reported symptoms: the roster on the trade-block page differs from the mock-draft lobby and other modules; Trade Builder / Set Availability still show 2026 picks 2.06 and 2.07 as owned even though the 2026 Sleeper draft is done (those picks became Mike Washington and Ted Hurst); the scouting lobby still offers "Mock Day Two" instead of "Review Results". The same duplication exists for values, trade-engine constants, team names, the CFC-year rule, pick-key parsing, and name normalization.

Second problem: Supabase carries seven seasons of history merged from Fleaflicker, MFL and Sleeper, plus raw API caches, intermediate build tables, and tables written only by unreachable code. The owner wants the schema slimmed without breaking the app or losing the ability to audit league history.

Outcome: every surface reads each fact through one shared feed; the trade engine has one calculation core with per-surface adapters; dead code is removed; the database is reduced to live-app tables plus a clearly tiered, archived history warehouse.

**Decisions from the owner (this session):**
1. Canonical roster/pick feed = live Sleeper via `getLeagueData()`, and it must reflect the completed Sleeper draft (season's picks spent, lobby flips to results).
2. Value shown on every surface = **viewer's perspective**: the viewer's own adjusted `final_value` for the viewer's players, league base `cfc_value` for everyone else's. This is what `valueAsset(asset, ctx, {perspective: viewer})` already computes.
3. DB access: owner adds `NEXT_PUBLIC_SUPABASE_URL` + `SUPABASE_SERVICE_ROLE_KEY` (or a read-only Postgres URL) to the cloud environment. Not present in this container yet; a fresh session picks them up.
4. History retention: archive dump, then drop.

Branch: `claude/brave-lovelace-gq28fx`. CI note: `.github/workflows/supabase-migrate.yml` runs `supabase db push` on every push to `main`, so any DROP placed in `supabase/migrations/` executes in production on merge. All destructive SQL ships as a separate, clearly named migration in its own PR.

An exhaustive read-only audit workflow (9 finders + adversarial verification + 3 table-inventory agents + completeness critic) is running in the background; its confirmed findings extend the checklists below during implementation. Everything listed here was verified first-hand.

---

## Part 1 — Canonical feeds: what exists, what diverges

### 1.1 Team rosters

**Canonical (keep):** `getLeagueData()` in `src/shared/league-data/accessors.ts`: live Sleeper rosters/users/traded picks/drafts (300s revalidate), player dict (24h), `draft_log` graft of in-app picks Sleeper hasn't processed, `team_email_map` name overrides, 60s `ttlMemo`. Already used by mock-draft, draft-sim, big-board pool, advisor, builder/studio generate, partner-fit, storylines, office, inbox ai-counter, memos sweep, pick service.

**Divergent consumers → refactor to the feed:**

| Surface | File | Today | Why it differs |
|---|---|---|---|
| Set Availability (trade block) | `src/research-strategy/api/service.ts` `readTeamTradeChart` | Reads `cfc_team_trade_values_current` as the roster | Table only rebuilt by daily cron, strategy save, or attachment save; a Sleeper trade is invisible until then |
| That table's rebuild | `service.ts` `getOwnedPlayerIds` → `fetchLeagueRosters` (`src/infrastructure/sleeper/api.ts`, no-store) + own player dict cache + own age parser | Second Sleeper path | No `draft_log` graft, different cache policy |
| Builder / Studio / Door roster panel | `src/app/api/pro-personnel/targets/route.ts` | Direct Sleeper fetch, then `if (val <= 0) continue` on `cfc_team_trade_values_current` | Newly acquired players vanish until a rebuild; names from `team_email_map` only; own `computeAge` |
| Draft Room | `src/infrastructure/sleeper/useSleeperData.ts` (client) | Browser fetch of 5 Sleeper endpoints, uncached | Own team/pick model, hardcoded `PICK_SLOT_SEASON = "2026"` |
| Draft log / order / clock-context | `src/app/api/scouting/draft/{log,order,clock-context}/route.ts` | Own `fetchJson` to Sleeper; `league.season ?? PICK_SLOT_SEASON` | Recompute order separately from `pickOwnership` |
| Onboarding attachment | `src/onboarding/OnboardingAttachment.tsx` | Browser fetch of Sleeper rosters + players | No shared feed |
| Inbox name map fallback | `src/shared/league-data/clientTeamIdentity.ts` | `/api/team-identity` then raw Sleeper | Third team-name resolution |
| Scouting intel data layer | `src/scouting/intel/dataLayer.ts` | Own Sleeper + strategy load | `/api/scouting/intel/*` has no UI caller |
| `useMyRoster` | `src/infrastructure/identity/useMyRoster.ts` | Browser Sleeper fetch | Zero importers — dead |

**Target:** `GET /api/league/snapshot` serializes the client-safe slice of `getLeagueData()` (teams + player meta, names, pick ownership, draft status). Client hooks call it; server routes import `getLeagueData()` directly. `cfc_team_trade_values_current` becomes a value lookup keyed `(team_id, sleeper_player_id)`, never a roster list.

### 1.2 Pick ownership, draft status, pick keys

**Canonical (keep):** `getLeagueData().pickOwnership` (built in `buildPickOwnership` via `src/infrastructure/picks`). Key format `pick:YYYY-R-SS-RID` (current) / `pick:YYYY-R-RID` (future). Parser: `parsePickKey` in `src/pro-personnel/engine/core/classification.ts`.

**Root cause of the stale 2.06 / 2.07 bug:** `fetchSpentPickNumbers()` marks a pick spent only if it is in `draft_log` (the in-app Day One draft). Day Two (rounds 2–3) ran in Sleeper, so those picks never reach `draft_log` and stay "ownable". Sleeper already shows the drafted players on rosters, so rosters are right and picks are wrong.

**Root cause of the lobby bug:** `src/app/api/scouting/draft-calendar/route.ts` derives `dayTwoComplete` solely from round 2–3 rows in `draft_log`, so the phase never reaches `complete` and "Mock Day Two" stays live; the complete-phase "Review Results" plate is a teaser (unbuilt).

**Fix (one new shared fact):** add `getDraftStatus()` to `src/shared/league-data`:
- `season` (cfcYear), Sleeper rookie draft for that season from `fetchDrafts()` (`draft_id`, `status` ∈ pre_draft/drafting/complete), Sleeper `/draft/{id}/picks` (new `fetchDraftPicks()` in `sleeper.ts`).
- `dayOneComplete` = `draft_log` round 1 full; `dayTwoComplete` = Sleeper draft `complete` OR `draft_log` rounds 2–3 full.
- `spentPicks` = `draft_log` submitted picks ∪ Sleeper draft picks; if Sleeper status is `complete`, every pick of that season is spent.
- Ownable seasons = `[firstUndraftedSeason, +1, +2]` where `firstUndraftedSeason` = cfcYear+1 when that season's draft is complete (verify against what Sleeper's `traded_picks` actually returns for 2029).

Consumers: `buildPickOwnership` (spent set + seasons), `draft-calendar` (phase), `useSleeperData`/draft routes (season instead of `PICK_SLOT_SEASON`), mock-draft page (redirect to results when `complete`), lobby (Review Results plate goes live).

**Review Results (complete phase):** minimal implementation = the existing draft-room board rendered read-only from merged picks (`draft_log` Day One + Sleeper Day Two via `getDraftStatus().picks`), reached from the lobby plate and the mock-draft redirect. Not a new archive feature.

**Duplicates to collapse:** private `parsePickKey` in `src/shared/asset-values/valuation.ts`; `parsePickKey` in `trades/create/route.ts`; `src/components/research-strategy/pickDisplay.ts` (zero importers, delete); local `pickKey` formatters in `mock-draft/trade-up` and `trade-back` routes, `pickLabel` in `team-dossier/builder.ts` and `pickService.ts` → one `formatPickLabel`. Move `parsePickKey` into `src/shared/league-data` so shared never imports from a department; `engine/core/classification.ts` re-exports it.

### 1.3 Player and pick values

**Canonical (keep):** `buildValuationContext()` + `valueAsset()` in `src/shared/asset-values/valuation.ts`. Display rule everywhere: `valueAsset(ref, ctx, {perspective: viewerTeamId})` (own adjusted → base for others). The engine's two-scoreboard model in `src/pro-personnel/engine/pricing.ts` / `construct.ts` already follows this (our assets at our perspective, theirs at base; mirrored for the partner read).

**Violations / direct table readers → `valueAsset` / `getValues()`:**
- `targets/route.ts` shows each roster at the **owner's** adjusted value (`teamValues[rid:pid]`) → must use viewer perspective.
- `src/app/api/player-values/route.ts` (draft room) reads `cfc_trade_values_current` directly and runs `backfillMissingRosteredPlayers` (`src/infrastructure/identity/rosterBackfill.ts`), which writes `cfc_value_upload_staging` + RPC `cfc_apply_value_upload`. Docs say the staging table was dropped; if confirmed live, this fails silently on every draft-room load. Route serves `getValues()`; backfill removed (cron owns the pipeline).
- `inbox/insider`, `scouting/intel/dataLayer.ts`, `scouting/draft/nfl-team-context`, `research-strategy/pick-values` read value tables directly.
- `trades/create` reads `cfc_trade_values_current` directly for base snapshots → `getValues()` / `getPickValues()`.
- `src/pro-personnel/trade-engine/value.ts` + `tgif_values.json`: zero importers — dead legacy source.

### 1.4 Trade engine

**Canonical (keep):** `src/pro-personnel/engine/` — `core/gap.ts`, `core/personas.ts` (`PERSONA_BANDS`: SS/Architect 0.90–1.10, Closer 0.85–1.05, Hustler 1.00–99), `core/classification.ts`, `construct.ts` + `adapters.ts` (studio/builder/scouting requests → one `construct`). `shared/trade-matching`, mock-draft trade-up/back, inbox ai-counter already route through it.

**Drift / dead copies:**
- `src/pro-personnel/trade-engine/studio/persona.ts` `PERSONAS` carries different bands (Closer 0.85–1.00, SS/Architect 0.85–1.10). Only `isValidPersona` and the `PersonaKey` type are imported (feedback route, OfferCard, OfferDrawer) → delete the ratio fields, re-export from `engine/core/personas`, repoint 3 importers.
- `trade-engine/advisor/context.ts` zero importers; `advisor/engine.ts`/`prompt.ts` one importer each (advisor route uses `personality.ts` only) → confirm and delete.
- `trade-engine/profile.ts` + `starterLevel.ts` used only by the draft room for roster grading — a second lineup/strength model beside `src/shared/team-profiles` (`computeStrength`, `SLOT_ELIGIBLE`). Migrate draft room to shared team-profiles or wrap them as an adapter over it.
- Docs (`docs/CFC-APP-STATUS.md`, `docs/CFC-SUPABASE-SCHEMA.md`, `CLAUDE.md`) cite `src/lib/trade/*`, `trade-engine/core/` — stale.

### 1.5 Team identity and "my team"

- Canonical: `readStoredTeam()` (`src/infrastructure/identity/storedTeam.ts`); names via `getTeamNameOverrides()` + Sleeper inside `getLeagueData()`; client via `/api/team-identity`.
- Violations: `src/scouting/draft-room/DraftRoom.tsx` and `draft-room/helpers.ts` read/write `sessionStorage` directly; `targets` and `advisor` routes read `team_email_map` with no Sleeper fallback.
- Supabase client: `src/app/api/active-teams/shared.ts` re-implements `getSupabaseAdminClient`; inline `createClient` in 4 admin ingest routes and `trade-studio/feedback` → all import `src/infrastructure/supabase/admin.ts`.

### 1.6 Player metadata

- Canonical: `LeagueData.players` (`playerName`, `playerAge` in `src/shared/league-data/sleeper.ts`).
- Duplicates: own dict + age parser in `research-strategy/api/service.ts`; `computeAge` in `targets`; `normalizeName` in `src/infrastructure/values/normalize.ts` and `src/infrastructure/commissioner.ts` beside canonical `src/infrastructure/strings/normalize.ts`.

### 1.7 League constants

- `getCFCYear` implemented 5× (`league-data/accessors.ts`, `asset-values/valuation.ts`, `trades/create`, `advisor`, `engine/core/classification.ts`) → one export in `src/shared/league-data`.
- League id resolved 3 ways (`LEAGUE_ID`, `getLeagueId()`, raw env in 10 files) → `getSleeperLeagueId()`.
- `DEFAULT_PICK_SEASONS = ["2026","2027"]` / `PICK_SLOT_SEASON` in `src/infrastructure/picks/index.ts` → derived from `getDraftStatus()`.

### 1.8 Dead code (first pass; workflow completes the list)

Zero-importer modules: `infrastructure/identity/useMyRoster.ts`, `components/research-strategy/pickDisplay.ts`, `trade-engine/value.ts` + `tgif_values.json`, `trade-engine/advisor/context.ts`, `infrastructure/league/leagueRankings.ts`, `historian/leagueHistorySync.ts` (sole writer of 14 `league_*` tables).

Routes with no client/cron/script caller: `/api/league/{profiles,needs,dossiers}`, `/api/pro-personnel/debug/*` (7), `/api/scouting/intel/*` (5), `/api/scouting/memos/*` (3), `/api/scouting/draft-sim{,/round1}`, `/api/inbox/memos/sweep`, `/api/llm/health`. `/api/admin/*` are secret-gated manual ingest — keep. (`mock-draft/trade-back` is a template-literal false positive.)

---

## Part 2 — Refactor plan (implementation order, one commit per step)

1. **Shared feed hardening** (`src/shared/league-data`): export `getCFCYear`, `parsePickKey`, `formatPickLabel`, `playerAge`; add `fetchDraftPicks` + `getDraftStatus()`; wire spent picks + ownable seasons into `buildPickOwnership`; add `LeagueSnapshot` type + `GET /api/league/snapshot`.
2. **Draft phase**: `draft-calendar` reads `getDraftStatus()`; lobby "Review Results" goes live; `/scouting/mock-draft` redirects to results when complete; read-only results board from merged picks.
3. **Roster consumers → feed**: `targets` (assets from `league.teams`, viewer-perspective `valueAsset`, keep zero-value players), `research-strategy/api/service.ts` (owned ids from `getLeagueData`, delete own dict/age code), `useSleeperData` → snapshot, `OnboardingAttachment` → snapshot, `draft/{log,order,clock-context}` → `getLeagueData`; delete `useMyRoster`; delete `scouting/intel/*` if confirmed dead, else migrate.
4. **Values**: `player-values` serves `getValues()`; drop `rosterBackfill` staging path after live check; `insider`, `nfl-team-context`, `pick-values` via `buildValuationContext`; `trades/create` via `getValues`/`getPickValues`.
5. **Engine consolidation**: strip drifted bands from `trade-engine/studio/persona.ts`; delete dead engine files; draft-room grading onto `shared/team-profiles`; fix docs.
6. **Identity + client**: draft room uses `readStoredTeam()`; `active-teams/shared.ts` re-exports infra client; remove inline `createClient`.
7. **Constants/utilities**: one `getCFCYear`, one `normalizeName`, one league-id accessor, no hardcoded seasons.
8. **Dead code removal**: modules + routes from 1.8 after workflow confirmation.
9. **Docs**: `CLAUDE.md` paths (`src/lib/*` → `src/infrastructure/*`, `api/draft/*` → `api/scouting/draft/*`), `CFC-APP-STATUS.md` engine paths, `CFC-SUPABASE-SCHEMA.md` table list.

---

## Part 3 — Supabase cleanup

### 3.1 Tiering from code (live verification required before any DROP)

| Tier | Tables | Action |
|---|---|---|
| **Live-critical** | trade_threads, trade_offers, trade_messages, team_email_map, active_teams, draft_state, draft_log, rookie_prospects, cfc_trade_values_current (view), cfc_team_trade_values_current, cfc_asset_calculations, cfc_assets, cfc_asset_source_values, cfc_value_sources, cfc_value_settings, cfc_player_scoring_factors, cfc_player_alias_map, cfc_unmapped_log, cfc_team_strategy_profiles, cfc_team_player_attachment, cfc_team_player_value_overrides, cfc_team_draft_class_strength, cfc_big_board_{rankings,tiers,stars}, cfc_director_memos, cfc_trade_passes, cfc_studio_offer_feedback; RPC cfc_rebuild_value_layers (cfc_apply_value_upload goes with the backfill removal) | Keep |
| **Historian warehouse** | llm_seasons, llm_franchises, llm_players, llm_player_games, llm_team_games, llm_season_records, llm_season_weeks, llm_transactions, llm_draft_picks (read via `LLM_DATABASE_URL` in `/api/llm/ask`) | Keep |
| **Canonical history (AGENTS.md)** | ff_master_draft_picks, ff_master_transactions, ff_master_transaction_items, other ff_master_*, ff_source_franchise_map, ff_source_player_map; function ff_rebuild_master_draft_picks_actual_results | Keep — the audit trail |
| **Mirror / build tables (admin ingest)** | slp_mirror_draft_results (input to ff_rebuild), slp_leagues_mirror, slp_transactions_mirror, slp_transaction_items, slp_lineup_stats, slp_starters_enriched, slp_lineups_weekly, slp_player_weekly_game_log, slp_player_weekly_presence, slp_playoff_true_games, slp_weekly_high_scores, flea_mirror_*, mfl_mirror_* | Keep any a view/function/llm_* build depends on; archive + drop the rest |
| **Raw payload caches** | slp_raw_global, slp_raw_smoke, flea_raw_global, flea_raw_smoke, mfl_raw_global, mfl_raw_smoke | Archive dump, then drop (owner decision) |
| **Dead-code only** | league_seasons, league_users, league_teams, league_roster_snapshots, league_roster_players, league_drafts, league_draft_picks, league_matchups, league_matchup_teams, league_transactions, league_transaction_assets, league_traded_picks, league_playoff_bracket_games, league_final_standings, league_champions | Archive + drop after row-count and dependency check |
| **Documented but unreferenced** | watchlist (no code reference), cfc_value_upload_staging (docs say dropped; still referenced by `rosterBackfill.ts`) | Confirm live; drop / fix code |
| **Already dropped per docs** | definitive_values, tgif_pick_anchors, cfc_team_value_preferences, cfc_team_asset_values_current | Verify gone |

### 3.2 Procedure (once env vars are present)

1. Inventory with `information_schema.tables/columns`, `pg_views`, `pg_proc` bodies, `pg_depend`/`pg_rewrite` dependency query, row counts, `pg_stat_user_tables` last activity; diff against the tier table; confirm how `llm_*` is built (SQL functions or external job) so nothing upstream of it is dropped.
2. Archive script: `pg_dump --table` list for every drop candidate (owner keeps the dump), or `ALTER TABLE … RENAME TO zz_archive_…` as an interim.
3. One migration per tier (`012_drop_dead_league_tables.sql`, `013_drop_raw_caches.sql`, …), each idempotent, each gated by a dependency check that raises before dropping, with validation queries after (AGENTS.md rules). Shipped in a separate PR because CI applies migrations on merge.
4. Update `docs/CFC-SUPABASE-SCHEMA.md` to the final schema.

---

## Verification

- `npm ci`, `npm run lint`, `npx tsc --noEmit` clean after each step.
- Feed parity script (`scripts/verify-feeds.mjs`): for every roster id, `/api/league/snapshot`, `/api/pro-personnel/targets`, `/api/research-strategy/trade-chart`, `/api/scouting/mock-draft` return identical player-id sets and pick-key sets; no 2026 picks appear anywhere once the Sleeper draft is complete.
- Value parity: for the viewer's players, every surface shows the viewer's `final_value`; for others' players, base `cfc_value`.
- Engine parity: `computeGap` / `personaAwareGrade` unchanged on fixtures from `scripts/simulate-studio*.mjs`.
- Lobby shows "Draft Complete" + live "Review Results"; `/scouting/mock-draft` redirects.
- Draft room, onboarding, inbox make no direct `api.sleeper.app` calls (only `/api/*`).
- DB: after each migration, live routes and `/api/llm/health` pass; `ff_rebuild_master_draft_picks_actual_results()` still runs.

## Assumptions to flag during implementation

- The engine's internal partner-acceptance model keeps using the partner's own adjusted values (their untouchables); only *display* follows the viewer rule.
- Admin ingest routes and their Sleeper mirror tables stay so Sleeper history can be re-pulled; Flea/MFL raw payloads survive only in the archive dump.

---

## Decisions applied (2026-09-12)

All 55 cards on the decision sheet are decided; the full record is in `2026-09-decisions.json`. Every card took the recommended option except:

- **D-13 → B**: before Sleeper publishes the current-year order, price current-year picks by the owner's projected finish (the same rule already used for future-year picks). Never a roster-index guess.
- **D-16 → keep the fixed ladder**: the 1.01–3.12 prices are a hand-set CFC value system by design. No source refresh. Commit the ladder as a versioned seed; the trade-chart page must degrade, not error, when an anchor row is missing.
- **D-18 → one table, +20 / +10 / 0 / −10** (untouchable / core / listening / moveable) for players and picks alike.
- **D-29 → commissioner keyed to the owner's account email** (`ntricarichi@gmail.com`) via a flag on the `team_email_map` row.
- **D-31 → one identity, three fields** (full name, location, nickname) sourced from Sleeper with a multi-word-nickname exception list; colors, GM names and negotiation personalities keyed by roster id. **Keep the in-app rename** as an override; the league intends to detach from Sleeper later.
- **D-37 → B**: keep the hardcoded source scoring settings; document them at the fetch sites.

Implementation order (each step one commit; lint + typecheck + before/after diffs of read-only routes against live data before every push):

1. Shared feed: `getDraftStatus()` (Sleeper draft status + pick list + draft_log), spent picks and ownable seasons (D-09, D-15), projected-finish pricing for unslotted current-year picks (D-13), slot-free pick identity with a one-time key migration (D-12), one `parsePickKey` / `formatPickLabel` / `getCFCYear` (C-02), `LeagueSnapshot` + `GET /api/league/snapshot`, cache invalidation on writes (D-06, D-21).
2. Draft status surfaces: calendar phase, Review Results board, mock-draft redirect (D-10); draft room onto `pickOwnership` and the shared roster/profile feeds (D-04, D-11, D-34); trade-up button wired to the builder (D-40); remove the demo fallback (D-05).
3. Roster consumers onto the feed (D-01, D-02, D-32, C-01); onboarding pages through the full roster and rebuilds values on save (D-07, D-19); pending-trade graft on accept (D-03).
4. Values: viewer-perspective everywhere including picks (D-08, D-14); one modifier table (D-18); remove the draft-room backfill (D-17); versioned ladder seed (D-16); percentile scouting grades (D-20); value plumbing block (C-03).
5. Engine: one pricing lens + persona-aware grade on every surface, computed live (D-22, D-23, D-26); Studio and mock-draft trades through `construct` adapters (D-24, D-25); schedule the memo sweep (D-27); one persona source keyed by roster id (D-36); one LLM model setting + shared voice rules (D-38); engine dead code and docs (C-04).
6. Identity and access: cookie-resolved team on every write and private read (D-28); commissioner flag (D-29); one stored-team reader (D-30); identity model per D-31; strategy save path merges (D-35); one open-trades definition (D-39); remove the Team HQ tile (D-41); identity plumbing block (C-05).
7. Dead code removal (C-06); rookie class derived from Sleeper (D-33).
8. Database (separate PR, after the live inventory): tiers DB-01..DB-07 as decided, archive dump → soft-rename → drop; baseline migration capturing the undocumented live DDL.
