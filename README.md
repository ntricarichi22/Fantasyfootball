# CFC Draft App — Comprehensive Technical Reference

> This README is a complete, technical inventory of what the application currently does. It is intended as a hand-off document for another AI/engineer who will redesign and extend the app. Wherever possible, exact file paths, table names, route paths, environment variables, model names, and constants are called out verbatim from the code. Anything described as "known issue" or "limitation" is flagged in §9.

---

## 1. App Overview

**Name (package):** `cfcdraftapp` (see `package.json`)
**User-facing name / branding:** "CFC Draft" / "2026 Command" (sidebar header in `AppShell`)
**Audience:** Members of a single private dynasty fantasy football league ("CFC", commissioner team is `Virginia Founders`). The app is currently scoped to one Sleeper league at a time, identified by `NEXT_PUBLIC_SLEEPER_LEAGUE_ID`. Known historical Sleeper league IDs (per `AGENTS.md`):
- 2024: `1040100278152646656`
- 2025: `1183585976810295296`

**What it does (one paragraph):** It is a multi-feature, browser-based companion for a Sleeper-hosted dynasty league. It hosts a live draft room with a synchronized server clock; a strategy/valuation hub ("Team HQ") where each manager configures their team's posture and per-player trade values; a manual trade machine and an AI-driven trade generator with counter-offer suggestions; a threaded trade messaging center; and a Claude-powered chat agent ("CFC Historian") that answers natural-language questions about all of league history by writing SQL against a curated `llm_*` warehouse.

**Tech stack:**
- **Framework:** Next.js `16.1.6` (App Router), React `19.2.3`, TypeScript `5.9.3`
- **Styling:** Tailwind CSS v4 (`@tailwindcss/postcss`), Lucide-React icons, custom dark theme (`#0b0c10` bg, red-600 accents)
- **Database:** Supabase (Postgres). Two clients are used:
  - Browser/anon client — `src/lib/supabaseClient.ts`
  - Server/service-role admin client — `src/lib/supabaseAdmin.ts`
- **Direct Postgres (LLM only):** `pg` (node-postgres) Pool against a separate `LLM_DATABASE_URL` for the Historian's SQL tool-use (read-only against `llm_*` tables).
- **AI providers:** Anthropic (`claude-sonnet-4-5`) for the Historian; OpenAI (`gpt-4o-mini`) for trade re-ranking commentary.
- **External data:** Sleeper API, Fleaflicker API, MyFantasyLeague (MFL) API, FantasyCalc API, DynastyProcess (raw GitHub CSV), Yahoo Sports (scraped via Playwright + `@sparticuz/chromium`), HTML parsing via `cheerio`.
- **Hosting:** Vercel (cron defined in `vercel.json`, Vercel CRON auth via `Authorization: Bearer ${CRON_SECRET}` is recognized in admin routes).

**Repository layout (high-level):**
```
src/
  app/
    layout.tsx                 # Root HTML shell
    page.tsx                   # /  → Draft room (large client component, ~80KB)
    globals.css
    (app)/                     # Authenticated/team-selected route group
      layout.tsx               # Wraps in <AppShell>
      draft/page.tsx           # /draft   (re-exports root DraftRoom)
      historian/page.tsx       # /historian
      team-hq/page.tsx         # /team-hq
      team-snapshot/page.tsx   # /team-snapshot (alias for TeamHqView)
      trade-builder/page.tsx   # /trade-builder
      trade-studio/page.tsx    # /trade-studio
      trades/page.tsx          # /trades  (?view=active|history)
      trades/[id]/page.tsx     # /trades/<offerId>
    api/                       # All server routes (see §4)
  components/
    AppShell.tsx               # Sidebar shell + unread-trades polling badge
    DraftTimer.tsx             # Server-synced pick clock
    TeamHqView.tsx             # Team HQ tabs container
    TeamHqTabs.tsx             # Tab strip (strategy / depth-chart / trade-chart)
    TradeCenterTabs.tsx        # Tab strip (Active / History / AI Generator / Trade Machine)
    historian/                 # Chat UI components
  lib/                         # Shared modules (see §5)
  _disabled_league-history/    # Two old "league-history" routes, parked out of routing
supabase/migrations/           # 001..004 SQL migrations (see §3.6)
docs/sleeper-draft-results-runbook.md
.env.example                   # Lists only NEXT_PUBLIC_SLEEPER_LEAGUE_ID
vercel.json                    # Daily cron at 11:00 UTC
```

---

## 2. Feature Inventory

### 2.1 Landing / Team Selection
**Route:** `/` → `src/app/page.tsx` (the root client component is also re-rendered at `/draft`).
**What it does:** First-time visit prompts the user to pick a team from the league's rosters. Selection is persisted in `sessionStorage` under `cfc_selected_team` (`{ rosterId, sessionId, teamName }`). `sessionId` is generated using `crypto.randomUUID()` (with a `Uint32Array` fallback). Picking a team posts to `/api/active-teams/claim`; switching/leaving posts to `/api/active-teams/release`. While a team is selected the page sends heartbeats to `/api/active-teams/heartbeat` so other clients see it as live.
**Auth model:** `(app)/layout.tsx` redirects to `/` if no `cfc_selected_team` is in sessionStorage. There is no real authentication — team selection is the only identity model.

### 2.2 Draft Room
**Route:** `/draft` (and `/`)  
**File:** `src/app/page.tsx` (largest single file in the codebase, ~80KB)
**What it does:**
- Loads the league configuration from Sleeper (`/v1/league/{leagueId}`), rosters, users, traded picks, drafts, and the `players/nfl` dictionary. The player dictionary is cached in `localStorage` as `sleeper_player_dict` with timestamp `sleeper_player_dict_time` (TTL ≈ 6 hours, 24 hours in some pages).
- Renders an interactive draft board with drag-and-drop roster slots and a search/filter for available players (by position, including FLEX and SUPERFLEX eligibility logic).
- Uses `<DraftTimer>` for the on-the-clock display. Format: `"ON THE CLOCK: <Team> <Round.Pick> MM:SS"`. Default `INITIAL_PICK_SECONDS = 30` (note: `src/lib/draftState.ts` declares a different default of 300 — see §9).
- Subscribes to Supabase realtime on `draft_state` so all clients share a single server-driven clock (status: `running` | `paused` | `stopped`, `seconds_remaining`, `clock_started_at`).
- Records picks via `POST /api/draft-log`. Pick rows include `pick_index, pick_number, team_count, team_name, roster_id, player_id, player_name, positions, nfl_team`.
- Commissioner-only UI: pick deletion via `DELETE /api/draft-log`. The commissioner's identity is resolved by name match `Virginia Founders` against Sleeper users + rosters (`src/lib/commissioner.ts`).
- Demo mode: if `NEXT_PUBLIC_SLEEPER_LEAGUE_ID` is unset, the page renders fake teams so the UI is still navigable.

**Local storage keys used by Draft Room:**
- `sleeper_player_dict`, `sleeper_player_dict_time`
- `drafted_players_state`
- `draft_log_state`
- `lineup_overrides_state`

**API routes called:** `/api/active-teams/claim|heartbeat|release`, `/api/draft-state` (GET/POST), `/api/draft-log` (GET/POST/DELETE), Sleeper API directly from the client.

### 2.3 CFC Historian (League History Chatbot)
**Route:** `/historian`  
**Files:** `src/app/(app)/historian/page.tsx` → `src/components/historian/HistorianChat.tsx` (+ `WelcomeScreen`, `ConversationSidebar`, `ChatInput`, `ChatMessage`, `markdown`, `types`)

**UX:**
- Three-pane layout: collapsible conversation sidebar (left), message list (center), `ChatInput` (bottom). Mobile uses an overlay drawer.
- New conversation button creates a blank thread; first user message becomes the title (via `deriveTitle`, truncated to 60 chars).
- All conversations are stored in `localStorage` under `cfc_historian_conversations_v1`. Loaded via `loadConversations()`, persisted via `saveConversations()` after every reducer action (`hydrate | select | new | delete | appendMessage`).
- `WelcomeScreen` shows 8 hard-coded suggestion chips (e.g., "Who has won the most championships?", "What's the all-time record between Virginia Founders and Fairmount Freaks?", "Show me the biggest blowout in league history").
- A "fun fact" card auto-fetches once per session (cached in `sessionStorage` as `cfc_historian_fun_fact_v1`) by sending the prompt: *"Give me one fun or surprising fact about CFC league history…"*.
- Assistant responses are rendered through a tiny custom markdown parser (`src/components/historian/markdown.tsx`) supporting `**bold**`, `` `code` ``, `-`/`*`/numbered lists, and paragraphs.
- A copy button on each assistant message produces:
  ```
  🏈 CFC Historian
  Q: <question>
  A: <answer>
  ```

**Powered by:** `POST /api/llm/ask` (Anthropic Claude Sonnet 4.5 + SQL tool-use). See §6.1.

### 2.4 Team HQ
**Routes:** `/team-hq` and `/team-snapshot` (alias). Both render `<TeamHqView>`. The active tab is controlled via `?tab=strategy|depth-chart|trade-chart` (default `strategy`). `<TeamHqTabs>` is a simple tab strip.

#### 2.4.1 Strategy tab
- Loads/saves a `TeamStrategyProfile` via `GET/POST /api/team-hq/strategy?teamId=<rosterId>`.
- Profile shape (`src/lib/team-hq/types.ts`):
  - `wants_more`: subset of `["picks", "studs", "youth", "depth"]`
  - `qb_market`, `rb_market`, `wr_market`, `te_market`, `picks_market`: one of `"buy" | "hold" | "sell"`
  - `own_guys_preference`: one of `"love_my_guys" | "prefer_to_keep_them" | "neutral" | "ready_to_shake_it_up"`
- Saving the profile triggers a server-side rebuild of `cfc_team_trade_values_current` for that team (see §5 `team-hq/service.ts`).

#### 2.4.2 Depth Chart tab
- Predefined position slots (QB, RB×2, WR×2, SK×2, PC×2, SF). Currently uses **hard-coded demo player candidates** (flagged in §9).
- Drag/select players into slots.

#### 2.4.3 Trade Chart tab
- Reads computed per-team values via `GET /api/team-hq/trade-chart?teamId=<rosterId>` and pick anchors (1st = 3000, 2nd = 1000, 3rd = 350 by default).
- For every player, shows: `base_value`, `auto_value`, `manual_override_value`, `final_value`, plus the percent contribution of each modifier (`studs_pct`, `youth_pct`, `market_pct`, `own_guys_pct`).
- Manual override for a single player: `POST /api/team-hq/trade-chart/override` (returns the rebuilt chart).
- Full team rebuild: `POST /api/team-hq/trade-chart`.

### 2.5 Trade Center

`TradeCenterTabs` ties together four URL destinations:
1. **Active** — `/trades?view=active` (default)
2. **History** — `/trades?view=history`
3. **AI Generator** — `/trade-studio`
4. **Trade Machine** — `/trade-builder`

The sidebar nav badge on "Trade Center" polls `GET /api/trades/unread-count?teamId=<id>` every 15 s.

#### 2.5.1 Trades inbox (`/trades`)
**File:** `src/app/(app)/trades/page.tsx`
- Lists `trade_threads` for the current team via `GET /api/trades/threads?teamId=<id>` (polled every 10 s with an `AbortController`).
- Filters Active vs History based on thread `status`.
- Status colors: `open` amber, `accepted` emerald, `declined` red, `withdrawn`/`closed` gray.
- Displays relative timestamps (`"2m ago"`, `"5h ago"`).
- Resolves team display names by fetching Sleeper rosters + users on mount.

#### 2.5.2 Trade thread detail (`/trades/[id]`)
**File:** `src/app/(app)/trades/[id]/page.tsx` (~32KB)
- Loads the full thread + offers via `GET /api/trades/threads/<threadId>` and messages via `GET /api/trades/threads/<threadId>/messages` (with periodic re-polling).
- Shows the offer history (chronological), each with grade/value.
- Action buttons:
  - Accept / Decline / Withdraw → `POST /api/trades/status` with `{ offer_id, team_id, status }`
  - Counter → composes a new offer and `POST /api/trades/create` with `parent_offer_id`
  - "AI Counter Suggestions" (sparkles icon) → `POST /api/trades/ai-counter` with optional preference
  - Send message → `POST /api/trades/threads/<threadId>/messages`
- Mark-as-read on view → `POST /api/trades/mark-read`.
- User preferences for the AI counter (`more_value`, `more_picks`, `more_depth`, `upgrade_at_QB|RB|WR|TE`, `prefer_2026`, `prefer_2027`) are persisted in `localStorage`.

#### 2.5.3 Trade Machine (`/trade-builder`)
**File:** `src/app/(app)/trade-builder/page.tsx` (~40KB), client component.
- Manual two-team trade builder. User picks Team A and Team B and drags/clicks players or pick assets onto either side.
- Asset shape: `{ key, label, type, position?, team?, ageLabel?, value }`.
- Uses CFC-league valuations (player-level + pick-level), with position multipliers `QB ×1.25`, `TE ×0.75` applied at the asset level.
- Real-time deal classification: **Steal**, **Good Deal**, **Fair**, **Slight Overpay**, **Big Overpay** (thresholds described in §6.2.5).
- Sends finalized trades via `POST /api/trades/create`.

#### 2.5.4 Trade Studio / AI Generator (`/trade-studio`)
**File:** `src/app/(app)/trade-studio/page.tsx` (~95KB, monolithic client component).
- Three workbench tabs: `trade-block`, `incoming`, `chat`.
- User configures: own team, players/picks on the trade block, **Timeline** (`Contend | Re-tool | Rebuild`), **Posture** (`Buyer | Seller`), and an **Aggression** slider (0–100).
- Computes league context locally:
  - `buildLeagueProfiles` from `src/lib/trade/profile.ts` (mode/posture/needs per team)
  - `computeLeagueRankings` from `src/lib/leagueRankings.ts`
  - `computeStarterLevels` and `computeCoreTeamStrength` from `src/lib/trade/starterLevel.ts` to detect contend/middle/rebuild tiers
- Generates 4–6 deterministic trade suggestions client-side via an internal `buildOfferSuggestions` (see §6.2). Suggestions are auto-regenerated 300 ms after any input change.
- Optionally re-ranks the suggestions through `POST /api/trade/llm-rerank` (OpenAI `gpt-4o-mini`) which returns ESPN-style 1–2 bullet explanations and a new ordering. Fails silently to deterministic ordering if the API key is missing or the call fails.
- "Send offer" creates a real `trade_offers` row via `POST /api/trades/create` and routes the user into the resulting thread.

**Cached state in `localStorage`:** `trade_studio_availability`, `cfc_selected_team`, `sleeper_player_dict` (24 h TTL on this page).

**Notable constants (Trade Studio):**
```
YOUNG_PLAYER_AGE_THRESHOLD     = 24
VETERAN_PLAYER_AGE_THRESHOLD   = 29
REBUILD_PICK_THRESHOLD         = 3
CONTEND_NEAR_TERM_PICK_MAX     = 2
STUD_PLAYER_THRESHOLD          = 9000   // value, not points
OFFER_TARGET_COUNT             = 6
OFFER_MIN_COUNT                = 4
QB multiplier 1.25 / TE multiplier 0.75
```

### 2.6 Sidebar / Global Shell
**File:** `src/components/AppShell.tsx`
- Fixed 240-px sidebar: logo, nav, current-team panel, "Switch Team" button.
- Nav items (Lucide icons in parens): Draft Room (`Compass`) → `/draft`; CFC Historian (`ScrollText`) → `/historian`; Team HQ (`Gauge`) → `/team-hq` (also active for `/team-hq/*` and `/team-snapshot`); Trade Center (`ArrowLeftRight`) → `/trades` (also active for `/trade-studio`, `/trade-builder`).
- Subscribes to a `storage` event so a team change in another tab updates this sidebar.
- Polls `/api/trades/unread-count?teamId=<id>` every 15 s and renders the count as a badge.

### 2.7 Active-Team Session Tracking
- `active_teams` Supabase table tracks who currently has each roster claimed in a given league (`league_id`, `roster_id`, `session_id`, `last_seen`).
- `ACTIVE_TEAM_TIMEOUT_MS` is 5 min in `src/lib/activeTeams.ts` but the Draft Room UI uses `ACTIVE_TEAM_TIMEOUT_MINUTES = 30` (also flagged in §9).
- Heartbeats are sent every 30 s; the active-teams list is refreshed every 12 s for in-page UIs.

---

## 3. Data Architecture

The app talks to **three** databases:
1. The main Supabase project (browser anon key + service-role admin key) — everything except the Historian.
2. A separate Postgres database referenced only via `LLM_DATABASE_URL` — read-only home of the curated `llm_*` tables that Claude queries.
3. Various raw external APIs whose payloads are mirrored into Supabase (`slp_raw_*`, `mfl_raw_*`, `flea_raw_*`).

### 3.1 App-state tables (live, user-facing)
| Table | Purpose | Read by | Written by |
|---|---|---|---|
| `active_teams` | Live session map of roster→sessionId, with `last_seen` heartbeats | `/api/active-teams` (GET) | `/api/active-teams/{claim,heartbeat,release}` |
| `draft_state` | Single-row server-controlled draft clock (`status`, `seconds_remaining`, `clock_started_at`, `updated_at`, `league_id`) | `/api/draft-state`, `/api/draft-log`, Draft Room (Supabase realtime) | `/api/draft-state`, `/api/draft-log` |
| `draft_log` | Ordered draft pick history rows | `/api/draft-log` (GET) | `/api/draft-log` (POST/DELETE) |
| `app_state` | Generic key/value app state (used to record `player_values` last-refresh timestamp) | `/api/player-values/refresh` | `/api/player-values/refresh` |
| `player_values` | Legacy/intermediate per-player CFC values (FantasyCalc-derived) | `/api/player-values/refresh` | `/api/player-values/refresh` |

### 3.2 CFC valuation tables
| Table | Purpose |
|---|---|
| `cfc_assets` | Master registry of valuable assets (players + picks) keyed by `asset_key` |
| `cfc_asset_source_values` | Per-source raw values (FantasyCalc, DynastyProcess, Yahoo, …) per asset |
| `cfc_asset_calculations` | Per-asset aggregates (e.g., `multiple_101` ratio) |
| `cfc_trade_values_current` | Canonical league-wide CFC value per asset; columns include `sleeper_player_id`, `asset_key`, `cfc_value`. Read by nearly every trade-aware feature |
| `cfc_value_upload_staging` | Staging rows for value imports; unique on `(import_batch, asset_key, source_key)`. Applied via `cfc_apply_value_upload(import_batch)` RPC |
| `cfc_team_strategy_profiles` | One row per (`league_id`, `team_id`) holding a `TeamStrategyProfile` |
| `cfc_team_player_value_overrides` | Manual per-team per-player overrides + notes |
| `cfc_team_trade_values_current` | Per-team computed values after applying strategy modifiers |
| `cfc_manual_player_mappings` | Manual mapping of raw CFC sheet entries → Sleeper player ids |
| `tgif_pick_anchors` | Static "TGIF" pick value anchors per year (1.06, 2.06, 3.06, …) |
| `definitive_values` | Merged/ranked output of `refresh-definitive-values` (CFC + DynastyProcess + FantasyCalc + Yahoo + multipliers) |
| `v_player_values_definitive` (view) | Convenience view returning the latest definitive values per `sleeper_id` |

### 3.3 Trade workflow tables
| Table | Purpose |
|---|---|
| `trade_threads` | Pair-wise conversation grouping (`league_id`, `team_a_id`, `team_b_id`, `created_by_team_id`, `status`, `last_activity_at`, `last_message_at`, `last_offer_at`, unread counters) |
| `trade_offers` | Individual offers; columns include `from_team_id`, `to_team_id`, `assets_from`, `assets_to`, `from_value`, `to_value`, `grade_label`, `status`, `parent_offer_id`, `thread_id`, `read_at` |
| `trade_messages` | Free-form messages within a thread |

State machine for `trade_offers.status` is enforced in `/api/trades/status`: `pending → accepted | declined | withdrawn | countered`. Withdrawing a base offer also deletes attached messages on that thread (see route).

### 3.4 Sleeper mirror & history tables (warehouse — `slp_*`)
Populated by `src/app/api/admin/*` ingest routes and `src/lib/leagueHistorySync.ts`.

| Table | Purpose |
|---|---|
| `slp_raw_global` | Raw globally-cached Sleeper payloads (e.g., `players/nfl`) |
| `slp_raw_smoke` | Raw per-call audit snapshots from Sleeper |
| `slp_leagues_mirror` | Normalized per-season league rows |
| `slp_transactions_mirror` | Normalized league transactions |
| `slp_transaction_items` | Denormalized transaction asset rows (built by `build-transaction-items`) |
| `slp_starters_enriched` | Enriched starter lineup data (built by `lineup-stats`) |
| `slp_lineups_weekly` | Weekly lineup snapshots |
| `slp_lineup_stats` | Aggregated lineup stats |
| `slp_player_weekly_game_log` | Per-player per-week scoring with playoff classification (built by `build-player-weekly-game-log`) |
| `slp_player_weekly_presence` | Per-player per-week starter/bench/IR/taxi presence (built by `build-player-weekly-presence`) |
| `slp_playoff_true_games` | Reconstructed list of truly-playoff games (used to label `is_playoff` correctly) |
| `slp_mirror_draft_results` | Mirror of draft results from Sleeper (added by migration 004) |

### 3.5 MFL & Fleaflicker mirror tables
| Table | Purpose |
|---|---|
| `mfl_raw_global`, `mfl_raw_smoke` | Raw + per-call MFL payloads |
| `mfl_mirror_rosters_current`, `mfl_mirror_lineup_entries` | Normalized MFL roster + lineup data |
| `flea_raw_global`, `flea_raw_smoke` | Raw + per-call Fleaflicker payloads |
| `flea_mirror_teams` | Normalized Fleaflicker team data |
| `ff_master_draft_picks` | Cross-platform unified draft results table (rebuilt by `ff_rebuild_master_draft_picks_actual_results()`) |
| `ff_master_transactions`, `ff_master_transaction_items` | Cross-platform unified transaction history (referenced in `AGENTS.md` — exact provenance is admin-managed) |
| `ff_source_franchise_map`, `ff_source_player_map` | Lookup tables aligning per-platform IDs to canonical CFC franchise/player IDs |

### 3.6 League-history (`league_*`) tables
Written by `src/lib/leagueHistorySync.ts` (currently only invoked from the **disabled** `src/_disabled_league-history/{sync,backfill}/route.ts` — see §9).

`league_seasons`, `league_users`, `league_teams`, `league_roster_snapshots`, `league_roster_players`, `league_drafts`, `league_draft_picks`, `league_matchups`, `league_matchup_teams`, `league_transactions`, `league_transaction_assets`, `league_traded_picks`, `league_playoff_bracket_games`, `league_final_standings`, `league_champions`.

### 3.7 Historian (`llm_*`) tables — separate Postgres
Documented inline in `src/lib/llm/schema-context.ts` (the system prompt for Claude). Tables are denormalized so franchise and player names are repeated in fact tables to minimize JOINs.

| Table | Contents (high level) |
|---|---|
| `llm_franchises` | Canonical team identities (active flag, names) |
| `llm_players` | NFL player registry (position, age, rookie year, NFL team, status) |
| `llm_seasons` | Season metadata (year, playoff structure, source platform) |
| `llm_season_weeks` | Week calendar incl. playoff round classification |
| `llm_season_records` | Full-season standings (W-L, PF, PA, titles) |
| `llm_team_games` | Head-to-head game results with starter, bench, optimal points |
| `llm_player_games` | Per-player per-week scoring (starter vs bench flag) |
| `llm_draft_picks` | All-time draft results with player outcome columns |
| `llm_transactions` | Trade / waiver / add-drop history with asset movement |

### 3.8 SQL migrations (under `supabase/migrations/`)
1. **`001_trade_threads.sql`** — Adds `trade_threads` table; adds `thread_id` FK on `trade_offers` and `trade_messages`; backfills one thread per unique league+team-pair.
2. **`002_fix_cfc_apply_value_upload.sql`** — Adds the `(import_batch, asset_key, source_key)` unique constraint on `cfc_value_upload_staging`; rewrites `cfc_apply_value_upload` with filtered DELETEs (PostgREST compatibility) and idempotent UPSERTs.
3. **`003_fix_cfc_value_column.sql`** — Adds `sleeper_player_id` to `cfc_trade_values_current`; adds UNIQUE constraints needed for `ON CONFLICT`; recreates `cfc_apply_value_upload` with the correct `cfc_value` column name (was previously `trade_value`).
4. **`004_sleeper_draft_results_sync.sql`** — Creates `slp_mirror_draft_results` and `ff_rebuild_master_draft_picks_actual_results()` (which unifies actual draft results across Sleeper + MFL + Fleaflicker into `ff_master_draft_picks`). Runbook: `docs/sleeper-draft-results-runbook.md`.

### 3.9 Postgres functions / RPCs called from the app
- `cfc_apply_value_upload(import_batch text)` — applies a batch of staged value rows into `cfc_assets`, `cfc_asset_source_values`, `cfc_asset_calculations`, `cfc_trade_values_current`. Called from `rosterBackfill.ts`, `/api/admin/import-cfc-values`, `/api/admin/backfill-player`, `/api/admin/refresh-definitive-values`.
- `ff_rebuild_master_draft_picks_actual_results()` — rebuilds `ff_master_draft_picks` from the three platform mirrors. Documented in the runbook.

---

## 4. API Routes

All routes live under `src/app/api/`. Most server routes use the service-role admin client from `src/lib/supabaseAdmin.ts`. Admin-gated routes accept *any* of: `?secret=`, `x-admin-secret` header, `Authorization: Bearer ${ADMIN_REFRESH_SECRET}`, or the Vercel CRON header (`Authorization: Bearer ${CRON_SECRET}`).

### 4.1 Active teams (session presence)
| Method & path | Purpose | Body / query | Returns | Tables |
|---|---|---|---|---|
| `GET /api/active-teams?leagueId=` | List currently-active teams | — | `{ data: { rosterId, sessionId, lastSeen }[] }` | reads `active_teams` |
| `POST /api/active-teams/claim` | Claim a roster (errors if held by another live session) | `{ leagueId, rosterId, sessionId }` | `{ ok, lastSeen }` | upsert `active_teams` |
| `POST /api/active-teams/heartbeat` | Bump `last_seen`; validates session id | same as claim | `{ ok, lastSeen }` | update `active_teams` |
| `POST /api/active-teams/release` | Clear the row | same as claim | `{ released: true }` | delete `active_teams` |

(Shared helpers: `src/app/api/active-teams/shared.ts`; constants: `src/lib/activeTeams.ts`.)

### 4.2 Draft routes
| Method & path | Purpose | Body / query | Returns | Tables / external |
|---|---|---|---|---|
| `GET /api/draft-state` | Current clock state | — | `{ data: DraftStateRow }` | reads `draft_state` |
| `POST /api/draft-state` | Lifecycle: `start` / `pause` / `resume` / `advance` | `{ action, secondsRemaining? }` | `{ data, status? }` | upsert/update `draft_state` |
| `GET /api/draft-log` | Read full pick log | — | `{ data: DraftLogRow[] }` | reads `draft_log`; uses Sleeper for commissioner-display in some paths |
| `POST /api/draft-log` | Append a pick (refuses if `draft_state.status === 'paused'`) | `{ pickIndex, pickNumber, teamCount, teamName, rosterId, playerId, playerName, positions, nflTeam }` | `{ success: true }` | upsert `draft_log`, side-effect on `draft_state` |
| `DELETE /api/draft-log` | Remove a pick (commissioner-only via Sleeper rosters/users name match) | `{ pickIndex, rosterId }` | `{ success: true }` | delete `draft_log`; calls Sleeper `rosters` + `users` |

### 4.3 Player values
| Method & path | Purpose | Returns | Tables / external |
|---|---|---|---|
| `GET /api/player-values` | Map of `sleeperId → cfc_value`, with non-fatal backfill of any rostered players missing from the table | `{ data, meta }` | reads `cfc_trade_values_current`; calls Sleeper rosters + FantasyCalc + DynastyProcess for backfill (via `rosterBackfill.ts`) |
| `GET /api/player-values-definitive` | Canonical merged values from view | `{ ok, count, data, meta }` | reads `v_player_values_definitive` |
| `GET /api/definitive-player-values-smoke` | Smoke test (latest 25 rows) | `{ ok, count, sample }` | reads `v_player_values_definitive` |
| `GET\|POST /api/player-values/refresh` | Refresh `player_values` from FantasyCalc (TE rows multiplied by 0.7) and stamp `app_state` | `{ updated }` | writes `player_values`, `app_state`; calls FantasyCalc |

### 4.4 Team HQ routes
| Method & path | Purpose | Body / query |
|---|---|---|
| `GET /api/team-hq/strategy?teamId=` | Read `TeamStrategyProfile` | — |
| `POST /api/team-hq/strategy` | Save profile and recompute team values | `{ teamId, profile }` |
| `GET /api/team-hq/trade-chart?teamId=` | Read computed values + pick anchors | — |
| `POST /api/team-hq/trade-chart` | Force a full team rebuild | `{ teamId }` |
| `POST /api/team-hq/trade-chart/override` | Save a manual per-player override | `{ teamId, sleeperPlayerId, manualOverrideValue, overrideNote? }` |

All four delegate to `src/lib/team-hq/service.ts`, which reads/writes `cfc_team_strategy_profiles`, `cfc_team_player_value_overrides`, `cfc_team_trade_values_current` (and reads `cfc_trade_values_current` + Sleeper rosters/players).

### 4.5 Trade routes
| Method & path | Purpose | Body / query |
|---|---|---|
| `GET /api/trades/list?teamId=&tab=inbox\|sent` or `?offerId=` | List or fetch single offer | — |
| `POST /api/trades/create` | Create offer; resolves/creates `trade_threads`; marks `parent_offer_id` as `countered` if applicable | `{ from_team_id, to_team_id, assets_from, assets_to, from_value, to_value, grade_label, parent_offer_id?, thread_id? }` |
| `POST /api/trades/status` | Transition offer status with role-based validation; cascades to thread on terminal status; deletes messages on `withdrawn` | `{ offer_id, team_id, status }` |
| `GET /api/trades/unread-count?teamId=` | Count of unread pending inbound offers | — |
| `POST /api/trades/mark-read` | Set `read_at` if null | `{ offer_id, team_id }` |
| `GET /api/trades/threads?teamId=` | All threads where team is a/b | — |
| `POST /api/trades/threads` | Find-or-create thread | `{ team_a_id, team_b_id, created_by_team_id }` |
| `GET /api/trades/threads/[threadId]` | Thread metadata + ordered offers | — |
| `GET /api/trades/threads/[threadId]/messages` | All messages | — |
| `POST /api/trades/threads/[threadId]/messages` | Post a message; bumps thread timestamps | `{ from_team_id, message }` |
| `GET /api/trades/[id]/messages` | Messages for the offer's thread | — |
| `POST /api/trades/[id]/messages` | Same as above, addressed by offer id | `{ from_team_id, message }` |
| `POST /api/trades/ai-counter` | Deterministic AI counter-offer suggestions | `{ thread_id, counter_team_id, preference? }` (see §6.3) |
| `POST /api/trade/llm-rerank` | OpenAI-powered re-ranking + commentary on existing offers | `{ userTeam, partners, offers, teamProfiles? }` (see §6.2.4) |
| `GET /api/trade-offers?league_id=&to_team_id=` | Legacy: pending offers for a league/team | — |
| `POST /api/trade-offers` | Legacy: insert into `trade_offers` directly | `{ league_id, from_team_id, to_team_id, assets_from, assets_to, from_value, to_value, grade_label }` |

### 4.6 LLM routes
| Method & path | Purpose |
|---|---|
| `GET /api/llm/health` | Connectivity + key-config status; reports row counts for `llm_seasons`, `llm_franchises`, `llm_player_games` |
| `GET\|POST /api/llm/ask` | Historian — Claude `claude-sonnet-4-5` with `run_sql` tool-use loop (max 12 turns, per-query 200-row cap) |

### 4.7 Admin routes (all admin-gated)
| Method & path | Purpose |
|---|---|
| `GET\|POST /api/admin/seed-tgif-pick-anchors?year=` | Upsert `tgif_pick_anchors` from local JSON |
| `GET /api/admin/refresh-definitive-values` | **Daily cron** (11:00 UTC). Pulls FantasyCalc + DynastyProcess CSV + Yahoo (Playwright-scraped) + Sleeper players, applies position/rank multipliers, populates `cfc_trade_values_current` and `cfc_value_upload_staging`. |
| `GET /api/admin/import-cfc-values?sleeper_player_id=` | One-off CFC value import for a single player (FantasyCalc + DynastyProcess + Sleeper). Writes staging then calls `cfc_apply_value_upload`. |
| `GET\|POST /api/admin/backfill-player?sleeper_player_id=` | Manually compute & upsert one player's CFC value (used when a rostered player is missing from `cfc_trade_values_current`). |
| `GET /api/admin/sleeper-history` | Multi-season Sleeper history ingest. Walks `previous_league_id`, paginates matchups & transactions, has a `budget_ms` (5000–55000 ms) and `mode=core\|full` switch. Writes to `slp_raw_smoke`, `slp_lineups_weekly`, etc. |
| `GET /api/admin/sleeper-smoke?endpoint=` | One-shot raw-payload capture into `slp_raw_smoke`. |
| `GET /api/admin/sleeper-players` | Capture full `players/nfl` payload into `slp_raw_global`. |
| `POST /api/admin/ingest/sleeper-draft-results` | Sync Sleeper draft picks into `slp_mirror_draft_results`. Body shape supports either `{ season_year, source_league_id }` or `{ league_ids: [...] }`. Documented in runbook. |
| `GET /api/admin/ingest/mfl?seasonYear=&sourceLeagueId=&maxScoringPeriod=` | Comprehensive MFL ingest (rules, standings, rosters, draftResults, futureDraftPicks, playoffBrackets, transactions, weeklyResults). Uses `?token=` for auth. |
| `GET /api/admin/ingest/mfl-players` | Batched (200/req) MFL player metadata ingest, scoped to players actually present in `mfl_mirror_lineup_entries` + `mfl_mirror_rosters_current`. |
| `GET /api/admin/ingest/fleaflicker?seasonYear=&sourceLeagueId=` | Comprehensive Fleaflicker ingest (rules, standings, draftBoard, rosters, scoreboard, boxscore, picks, listings, transactions). |
| `GET /api/admin/ingest/fleaflicker-roster-detail?maxScoringPeriod=` | Per-team per-week `FetchRoster` ingest into `flea_raw_*`. |
| `GET /api/admin/build-transaction-items` | Build `slp_transaction_items` from `slp_transactions_mirror` + players dict. |
| `GET /api/admin/build-player-weekly-presence` | Build `slp_player_weekly_presence` from `slp_raw_smoke` rosters + `slp_starters_enriched`. |
| `GET /api/admin/build-player-weekly-game-log` | Build `slp_player_weekly_game_log` from raw matchups + `slp_playoff_true_games`. |
| `GET /api/admin/lineup-stats?mode=starters\|transactions\|transaction_items` | Multi-purpose builder driving `slp_starters_enriched`, `slp_player_weekly_game_log`, etc. |

---

## 5. Shared Libraries (`src/lib/`)

| Module | Exports | Used by |
|---|---|---|
| `config.ts` | `getLeagueId()`, `LEAGUE_ID` | every league-scoped route |
| `supabaseClient.ts` | `getSupabaseClient()`, singleton `supabase` (anon key) | client components |
| `supabaseAdmin.ts` | `getSupabaseAdminClient()` (service-role) | every server route |
| `activeTeams.ts` | `ACTIVE_TEAM_TIMEOUT_MS` (5 min), `ACTIVE_TEAM_TIMEOUT_MINUTES` | `/api/active-teams/*` |
| `commissioner.ts` | `COMMISSIONER_TEAM_NAME = "Virginia Founders"`, `isCommissionerTeamName`, `findCommissionerRosterId` | `/api/draft-log` (DELETE), Draft Room |
| `draftState.ts` | `normalizeDraftStateRow`, `computeRemainingSeconds`, `INITIAL_PICK_SECONDS = 300`, types | `/api/draft-state`, `/api/draft-log`, Draft Room/`DraftTimer` |
| `sleeperApi.ts` | Typed fetch helpers for league, users, rosters, matchups, brackets, transactions, traded picks, drafts, draft picks; `fetchLeagueChain()` walks `previous_league_id` history | `leagueHistorySync`, admin ingest routes, all client trade pages |
| `picks.ts` | `deriveDraftOrderForSeason`, `buildDraftState`, `computeCurrentDraftPicks`, `withComputedDraftPicks`, `applyDraftStateToRosters`, `formatDraftPickLabel`, `logDraftPickDistribution`, `DEFAULT_PICK_SEASONS = ["2026","2027"]`, types | Trade Studio, Trade Builder, `/api/trades/ai-counter` |
| `rosterBackfill.ts` | `buildValueMap`, `backfillMissingRosteredPlayers` (FantasyCalc + DynastyProcess + Sleeper, writes via `cfc_apply_value_upload` RPC) | `/api/player-values`, admin backfill routes |
| `leagueRankings.ts` | `computeLeagueRankings`, `rankBandLabel`, `TE_FLEX_MULTIPLIER = 0.75` | Trade Studio profile/needs UI |
| `leagueHistorySync.ts` | `syncLeagueSeason`, `syncLeagueMetadata`, `syncUsers`, `syncTeams`, `syncRosterSnapshots`, `syncRosterPlayers`, `syncDrafts`, `syncDraftPicks`, `syncMatchups`, `syncTransactions`, `syncTradedPicks`, `syncPlayoffBracket`, `syncFinalStandings` — writes the entire `league_*` table family from Sleeper data | the **disabled** `_disabled_league-history/*` routes |
| `llm/schema-context.ts` | `SCHEMA_CONTEXT` (string) — the system prompt injected into every Historian Claude call. Documents 9 `llm_*` tables, SQL safety rules, query patterns, response style. | `/api/llm/ask` |
| `trade/value.ts` | `getPlayerValue`, `getCFCPickKey`, `getPickValue`, `getAssetValue`, `sumPackageValue`. Supports two value sources (CFC table + a static `tgif_values.json`). Discounts future-season picks 0.88×. | Trade Studio, Trade Builder, `/api/trades/ai-counter` |
| `trade/profile.ts` | `buildLeagueProfiles` → `{ mode: contend|retool|rebuild, posture: buyer|neutral|seller, positionRanks, positionBands, needs, totalValue, averageAge }` per team | Trade Studio, `/api/trade/llm-rerank` |
| `trade/starterLevel.ts` | `STARTER_COUNTS = { QB:2, RB:2, WR:2 }`, `CORE_BENCH_SIZE`, `TOP_TIER_SIZE`, `BOTTOM_TIER_SIZE`, `computeStarterLevels`, `computeCoreTeamStrength`, `classifyTeamTier` | Trade Studio offer generator |
| `team-hq/service.ts` | `readTeamTradeChartAnchors`, `getTeamStrategyProfile`, `saveTeamStrategyProfile`, `rebuildTeamTradeValuesForTeam`, `rebuildTeamTradeValueForPlayer`, `saveManualPlayerOverride`, `readTeamTradeChart`. Implements modifier math: studs +8% if `wants_more` includes `studs` AND value > 250; youth ±10% by age/position; market ±7% (buy/hold/sell per position); own_guys ±5–10%; total clamped to ±20%. Also caches Sleeper `players/nfl` for 6 h. | all `/api/team-hq/*` routes |
| `team-hq/types.ts` | `TeamHqWantsMore`, `TeamHqMarket`, `TeamHqOwnGuysPreference`, `TeamStrategyProfile`, `TeamStrategyProfileInput`, `TeamTradeValueRow`, defaults | service + UI |

---

## 6. AI / LLM Features

The app has **three distinct AI surfaces**. Two of them call hosted LLMs; the "AI counter" feature is deterministic and has no LLM call.

### 6.1 The Historian (Anthropic Claude + SQL tool-use)
- **UI:** `/historian` (see §2.3).
- **Server route:** `GET|POST /api/llm/ask` (`src/app/api/llm/ask/route.ts`).
- **Provider/model:** Anthropic, **`claude-sonnet-4-5`**, max 2048 output tokens.
- **Auth env:** `ANTHROPIC_API_KEY`. Database via `LLM_DATABASE_URL` (a separate Postgres, accessed via `pg.Pool` with `max:2`, `idleTimeoutMillis: 30000`, search_path forced to `public`).
- **System prompt:** the entire `SCHEMA_CONTEXT` from `src/lib/llm/schema-context.ts` (~179 lines). It documents all nine `llm_*` tables, lists pattern queries (head-to-head records, championship history, biggest blowouts, best/worst picks by efficiency, worst benching, etc.), enforces a conversational answer style, and tells Claude to keep results under 200 rows.
- **Tool definition:** A single tool, `run_sql`, with input `{ sql: string }`, "single PostgreSQL SELECT statement; no INSERT/UPDATE/DELETE/DDL".
- **Agent loop:** Up to **12 turns**. Per turn:
  - If `stop_reason === "end_turn"` → concatenate text blocks → return.
  - If `stop_reason === "tool_use"` → for every `tool_use` block, run `isSafeSelectQuery` and execute against the pool, then append the JSON results back into the conversation and continue.
- **`isSafeSelectQuery`** (lines ~33–66): query must start with `SELECT` or `WITH`; rejects 12 forbidden keywords (`INSERT`, `UPDATE`, `DELETE`, `DROP`, `ALTER`, `CREATE`, `TRUNCATE`, `GRANT`, `REVOKE`, `COPY`, `CALL`, `EXECUTE`); forbids multiple statements (internal semicolons); 200-row hard cap.
- **Response shape:** `{ ok, question, answer, queries: [{ sql, rowCount, error? }], usage: { input_tokens, output_tokens } }` — the executed SQL and token usage are returned for observability.
- **Frontend state:** Conversations persisted in `localStorage` (`cfc_historian_conversations_v1`); fun fact in `sessionStorage` (`cfc_historian_fun_fact_v1`).
- **Health probe:** `GET /api/llm/health` reports DB connectivity, whether `ANTHROPIC_API_KEY` is set, and counts of `llm_seasons`, `llm_franchises`, `llm_player_games`.

### 6.2 Trade Studio's AI Trade Generator + LLM re-rank
The Trade Studio's offer generation itself is **deterministic** — there is no LLM call in the suggestion algorithm. The optional LLM step is post-hoc commentary/re-ordering.

#### 6.2.1 `buildOfferSuggestions` (deterministic, client-side)
Located inside `src/app/(app)/trade-studio/page.tsx`. Inputs include the user's selected trade block, the league rosters & player dictionary, the player-value map (from `/api/player-values`), the per-team `TradeProfile` map (from `buildLeagueProfiles`), and the user's aggression slider (0–100).

Algorithm (high level):
1. Build asset inventories for every roster (players + future picks via `picks.ts`).
2. Detect the sender's intent: stud trade (player value > 9000), upgrade trade, depth/value, or QB-protection (sending a starter QB).
3. Rank candidate partners by complementary mode/posture, position needs, and core strength tier (`computeCoreTeamStrength`).
4. For each candidate, propose 1–2 receive packages whose total value lies in a band around the sent value (band shifts with the aggression slider, default ratio 1.0, range ~0.75–1.25).
5. Tag offers (`Rebuild fit`, `Buyer/Seller match`, `RB need match`, …) and grade them (`Fair`, `Slight Underpay`, `Slight Overpay`, `Underpay`, `Overpay`).

Heuristic scoring (non-exhaustive): QB-protection +1000, stud-trade fit +500, position upgrade +150, low-value team prefers picks +50 / youth +30, high-value team prefers stars +40.

Generation is debounced 300 ms after any input change.

#### 6.2.2 Player & pick valuation (`src/lib/trade/value.ts`)
Players: `cfc_trade_values_current` keyed by `sleeper_player_id`. Picks: canonical key `pick.R.SS` (e.g. `pick.1.01`, `pick.2.06`); future-season picks (e.g. 2027) discounted by 0.88×. Position multipliers `QB ×1.25`, `TE ×0.75` are applied at the offer level (not in raw values).

#### 6.2.3 Team profiling (`src/lib/trade/profile.ts`)
- **Mode:** `contend` (top-third by total value, avg age < 26), `rebuild` (bottom-third, avg age > 28 OR < 25), else `retool`.
- **Posture:** contend → `buyer`, rebuild → `seller`, retool → `neutral`.
- **Position scoring:** weighted sums of top players per slot vs the league, surfaced as `positionRanks`, `positionBands`, and `needs` strings ("needs RB depth", "needs TE upgrade").

#### 6.2.4 LLM re-rank (`POST /api/trade/llm-rerank`)
- **Provider/model:** OpenAI **`gpt-4o-mini`**, `temperature: 0.4`, max 2048 tokens.
- **Auth env:** `OPENAI_API_KEY` (if missing, returns the deterministic ranking with `source: "deterministic"`).
- **Prompt:** "You are an ESPN-style fantasy football trade analyst. Given these trade offers, rerank them from best to worst for the user. For each offer, write a 1–2 bullet explanation: why it fits both teams, and one suggested counter idea." plus user team name, partner names, `teamProfiles`, and the offer JSON. Output is required to be **strict JSON** of shape `{ "ranked": [ { "id", "explanation" } ] }` — invalid JSON triggers fallback.
- **Fallback ranking:** sort by fairness (`Fair, Slight Underpay, Slight Overpay, Underpay, Overpay`) then by `valueReceived/valueSent` ratio descending.

#### 6.2.5 Deal grading thresholds (Trade Builder + AI Counter)
Computed as `valueSent / max(valueSent, 1)` (and inversely):
- `≥ 1.20` → **Steal**
- `≥ 1.05` → **Good Deal**
- `≥ 0.95` → **Fair**
- `≥ 0.80` → **Slight Overpay**
- `< 0.80` → **Big Overpay**

### 6.3 AI counter-offer suggestions (deterministic)
- **UI:** Trade thread page `/trades/[id]` → "AI Counter Suggestions".
- **Server route:** `POST /api/trades/ai-counter`.
- **No LLM is involved.** The route fetches the latest pending offer in the thread + the sender's roster from Sleeper, then builds **up to 3** add-on suggestions by appending assets to the sender's side, sorted/filtered by the receiver's `preference`:
  - `more_value` — sender's highest-value remaining assets first
  - `more_picks` — picks first, ordered late→early round, optionally filtered by `prefer_2026` / `prefer_2027`
  - `more_depth` — cheap bench players first
  - `upgrade_at_QB|RB|WR|TE` — only that position, descending value
- Three output sets: best single asset, second-best single asset, both combined. Each comes with `from_value`, `to_value`, and a grade from §6.2.5.

### 6.4 Other AI-shaped surfaces (intentionally non-LLM)
- The "fun fact" on the Historian welcome screen calls Claude — not a separate model.
- Trade Studio's commentary text is templated (e.g., `"Rival gains Calvin to support a contend push; you gain RB depth for a retool path (Fair)"`), only re-written when the optional `/api/trade/llm-rerank` step succeeds.

---

## 7. Component Structure

### 7.1 Layouts
- `src/app/layout.tsx` — root HTML/body wrapper, imports `globals.css`. Title is still the Next.js boilerplate (flagged in §9).
- `src/app/(app)/layout.tsx` — wraps the authenticated route group in `<AppShell>` with a black `<Suspense>` fallback.

### 7.2 Global shell
- **`AppShell.tsx`** — 240-px sidebar with logo, nav (Draft Room / CFC Historian / Team HQ / Trade Center), current-team panel, switch-team button. Polls `/api/trades/unread-count` every 15 s and renders the unread badge on Trade Center. Listens to the cross-tab `storage` event so a team change in another tab updates the sidebar. Redirects to `/` when no team is selected.

### 7.3 Draft components
- **`DraftTimer.tsx`** — Configurable timer (`teams`, `clockStatus`, `clockSeconds`, `onPickMade`, `onTeamChange`, `externalPick`, `registerStartHandler`, `onStartRequest`, etc.). Two modes: an internal countdown (default `INITIAL_PICK_SECONDS = 30`) and an external server-driven mode that respects pause/stop. Debounces duplicate `externalPick` deliveries via a ref.

### 7.4 Team HQ components
- **`TeamHqView.tsx`** — Tabs container holding `StrategyTab`, `DepthChartTab`, `TradeChartTab`. Wires API calls in §4.4.
- **`TeamHqTabs.tsx`** — `?tab=` URL-driven tab strip (Strategy / Depth Chart / Trade Chart).

### 7.5 Trade components
- **`TradeCenterTabs.tsx`** — top-of-page tab strip for the Trade Center (Active / History / AI Generator / Trade Machine). Determines active tab from current pathname + `?view=`.
- The major trade pages (Trade Builder, Trade Studio, Trades inbox, Trade detail) are themselves single large client components — there is no sub-component library extracted out of them.

### 7.6 Historian components (`src/components/historian/`)
```
HistorianChat
├── ConversationSidebar
├── WelcomeScreen        (fun-fact card + 8 suggestion chips)
├── ChatMessage          (user vs assistant, copy button, error variant)
│   └── markdown.tsx     (custom inline+block parser, no external dep)
├── TypingIndicator      (three bouncing dots)
└── ChatInput            (auto-grow textarea, Enter/Shift+Enter handling)
```
Types and helpers (`uid`, `deriveTitle`, `relativeTime`, `formatTimestamp`, `loadConversations`, `saveConversations`) live in `src/components/historian/types.ts`.

### 7.7 Cross-cutting UX patterns
- **Theme:** dark (`#0b0c10` body, `#0f1118` sidebar, `#0d0f16` cards), red-600 accents, amber for warnings, emerald for success.
- **Polling intervals:** unread-count 15 s, threads inbox 10 s, active-teams refresh 12 s, heartbeat 30 s.
- **AbortControllers** are used to cancel in-flight fetches on navigation.
- **No** modal library — inline forms + toasts (3 s auto-dismiss; 1.8 s for "Copied!").
- **No real auth provider** — identity = team selection in `sessionStorage`.

---

## 8. External Integrations

### 8.1 Sleeper API
Base: `https://api.sleeper.app/v1`. Helpers in `src/lib/sleeperApi.ts`. Endpoints used somewhere in the codebase:
```
/league/{id}
/league/{id}/users
/league/{id}/rosters
/league/{id}/matchups/{week}
/league/{id}/winners_bracket
/league/{id}/losers_bracket
/league/{id}/transactions/{week}
/league/{id}/traded_picks
/league/{id}/drafts
/draft/{id}
/draft/{id}/picks
/players/nfl
```
Called from: `sleeperApi.ts` (typed wrappers), `leagueHistorySync.ts` (warehouse), `team-hq/service.ts` (player metadata + rosters, 6-h cache), `rosterBackfill.ts` (fill missing rostered players), Draft Room and trade pages directly from the browser, and many admin ingest routes. `fetchLeagueChain()` walks `previous_league_id` to get all historical seasons.

### 8.2 Fleaflicker API
Used only by `/api/admin/ingest/fleaflicker` and `/api/admin/ingest/fleaflicker-roster-detail`. Endpoints touched: `FetchLeagueRules`, `FetchLeagueStandings`, `FetchLeagueDraftBoard`, `FetchLeagueRosters`, `FetchLeagueScoreboard`, `FetchLeagueBoxscore`, `FetchTeamPicks`, `FetchPlayerListing`, `FetchLeagueTransactions`, `FetchRoster`. Output to `flea_raw_*` and `flea_mirror_teams`. Admin-triggered (no cron).

### 8.3 MyFantasyLeague (MFL) API
Used only by `/api/admin/ingest/mfl` and `/api/admin/ingest/mfl-players`. `TYPE` values: `league`, `leagueStandings`, `rosters`, `draftResults`, `futureDraftPicks`, `playoffBrackets`, `transactions`, `weeklyResults`, `players` (paginated 200 IDs at a time, with `DETAILS=1`). Output to `mfl_raw_*` and `mfl_mirror_*`. Admin-triggered (no cron).

### 8.4 FantasyCalc
- `https://api.fantasycalc.com/values/current?isDynasty=true&numQbs=2&numTeams=12&ppr=0.5`
- Called from `rosterBackfill.ts`, `/api/player-values/refresh` (TE rows multiplied by 0.7), `/api/admin/import-cfc-values`, `/api/admin/backfill-player`, `/api/admin/refresh-definitive-values` (the daily cron).

### 8.5 DynastyProcess
- Raw GitHub CSV: `https://raw.githubusercontent.com/dynastyprocess/data/master/files/values.csv`
- Called from `rosterBackfill.ts`, `/api/admin/backfill-player`, `/api/admin/import-cfc-values`, `/api/admin/refresh-definitive-values`.

### 8.6 Yahoo Sports (scraped)
- Pulled by `/api/admin/refresh-definitive-values` using `playwright-core` + `@sparticuz/chromium` for a serverless-friendly headless browser, plus `cheerio` for DOM parsing. Used to feed values into the merged `definitive_values` calculation.

### 8.7 Anthropic
- `https://api.anthropic.com/v1/messages`, model `claude-sonnet-4-5`. Only `/api/llm/ask`. See §6.1.

### 8.8 OpenAI
- `https://api.openai.com/v1/chat/completions`, model `gpt-4o-mini`. Only `/api/trade/llm-rerank`. See §6.2.4.

### 8.9 Cron schedule (`vercel.json`)
```json
{ "crons": [ { "path": "/api/admin/refresh-definitive-values", "schedule": "0 11 * * *" } ] }
```
Daily at 11:00 UTC. All other admin routes are on-demand only.

### 8.10 Environment variables observed in code
The shipped `.env.example` only lists `NEXT_PUBLIC_SLEEPER_LEAGUE_ID`; the actual variables read by the codebase are:
- `NEXT_PUBLIC_SLEEPER_LEAGUE_ID` — required, read by `src/lib/config.ts`
- `NEXT_PUBLIC_SUPABASE_URL` — browser/admin Supabase clients
- `NEXT_PUBLIC_SUPABASE_ANON_KEY` — browser client
- `SUPABASE_SERVICE_ROLE_KEY` — server admin client (`supabaseAdmin.ts`)
- `LLM_DATABASE_URL` — Historian Postgres pool (`/api/llm/{ask,health}`)
- `ANTHROPIC_API_KEY` — Historian
- `OPENAI_API_KEY` — Trade re-rank (optional)
- `ADMIN_SECRET` and/or `ADMIN_REFRESH_SECRET` — gate admin routes (different routes accept different names)
- `CRON_SECRET` — Vercel cron header (`Authorization: Bearer ${CRON_SECRET}`)
- `LLAMA_CLOUD_API_KEY` — referenced in the old README as a LlamaCloud Extract bearer token for "FantasyPros PDF fallback" (no current usage in `src/` was found — see §9)

---

## 9. Current Limitations & Known Issues

These are concrete things an extending engineer should be aware of. They are observations from the code, not opinions.

### 9.1 Half-built / disabled
- **`src/_disabled_league-history/`** — the directory name itself prevents Next.js routing (leading underscore). It contains a complete `sync` and `backfill` route that drive `leagueHistorySync.ts` against the `league_*` table family. Those tables are currently only writable through this disabled code path; nothing in production keeps them up to date.
- **`Depth Chart` tab in Team HQ** uses **hard-coded demo player candidates**, not real roster data. Players cannot be persisted as a saved depth chart anywhere in the schema today.
- **The Trade Studio is one ~95KB monolithic client component**. There is no extracted component library for offer cards, asset chips, etc.; refactor surface is large.
- **The Trade Studio's "incoming" and "chat" workbench tabs** exist as labeled tabs but rely on the same client-side state — there is no real-time push channel beyond the polled inbox endpoints.

### 9.2 Inconsistencies
- **Pick clock default differs by location.** `src/lib/draftState.ts` declares `INITIAL_PICK_SECONDS = 300`. The Draft Room page declares its own `INITIAL_PICK_SECONDS = 30`. The server clock in `draft_state` is whatever was last written by `/api/draft-state`.
- **Active-team timeout differs by location.** `src/lib/activeTeams.ts` defines `ACTIVE_TEAM_TIMEOUT_MS` as 5 minutes; the Draft Room UI uses `ACTIVE_TEAM_TIMEOUT_MINUTES = 30`.
- **Two parallel "trade offers" surfaces.** `/api/trade-offers` (raw `trade_offers` insert/list) coexists with the newer `/api/trades/*` set that wraps offers in `trade_threads` + `trade_messages`. The legacy endpoints don't create or update threads.
- **Two routes render the same component:** `/team-hq` and `/team-snapshot` both render `<TeamHqView>` with no behavioral difference detected.
- **`.env.example` is severely incomplete** — only one of the ~10 env vars actually consumed by the code is documented.
- **`LLAMA_CLOUD_API_KEY`** is described in the old README but isn't read anywhere under `src/` in the current code (vestigial).
- **Root `<title>` / metadata** is still the `create-next-app` boilerplate ("Create Next App", "Generated by …").

### 9.3 Data-pipeline gaps highlighted by `AGENTS.md` and migration 004
- The intended canonical draft-results table is **`ff_master_draft_picks`**, rebuilt by `ff_rebuild_master_draft_picks_actual_results()` from three platform mirrors. The Sleeper side of that pipeline is the most recent addition (migration `004` + `/api/admin/ingest/sleeper-draft-results` + `docs/sleeper-draft-results-runbook.md`). MFL and Fleaflicker mirrors have been ingested for longer but the master rebuild has to be re-run after every Sleeper sync to keep them aligned.
- **`AGENTS.md` explicitly warns** not to bake "original/current pick ownership" logic into `ff_master_draft_picks`; that table is **actual results only**. Pick-ownership/trade history lives in `ff_master_transactions` + `ff_master_transaction_items`.
- The `ff_*` master tables are referenced by admin/SQL operations, not by any of the user-facing trade UIs — those still talk to Sleeper directly for current-roster data and to `cfc_trade_values_current` for valuation.

### 9.4 Operational considerations
- **Admin routes accept multiple secret styles.** Different admin routes accept different env vars (`ADMIN_SECRET` vs `ADMIN_REFRESH_SECRET`) and different parameter names (`?secret=`, `?token=`, `x-admin-secret`, `Authorization: Bearer`). There is no central middleware.
- **The Historian's Postgres pool is a process-global singleton (`globalThis.llmAskPool`)** with `max: 2`. Under sudden load, requests will queue.
- **No rate limiting is implemented** on `/api/llm/ask`, `/api/trade/llm-rerank`, or `/api/trades/ai-counter`. Cost control depends on the upstream API keys.
- **No automated test suite exists** in this repo — only ESLint (`npm run lint`) and `next build`.
- **No CI/CD configuration** is present in `.github` beyond what Vercel imposes.
- **Service-role Supabase key is required** to run almost any server route locally, including unauthenticated public-facing reads (`/api/player-values`, etc.) — there is no read-only-public split.
- **Clock authority** lives entirely in `draft_state` and is mutated by any caller of `POST /api/draft-state`. There is no role check on that endpoint (only `DELETE /api/draft-log` checks the commissioner).
- **Browser cache TTLs vary.** `sleeper_player_dict` is 6 h on the Draft Room and 24 h on the Trade Studio/Builder.

### 9.5 LLM-specific risk areas
- The Historian relies on `isSafeSelectQuery` *and* on a permission-restricted DB role. The code does not verify the role at runtime — an over-privileged `LLM_DATABASE_URL` would be a security issue.
- The 200-row cap and 12-turn cap are hard-coded constants in the route file.
- The OpenAI re-rank assumes strict JSON output; any deviation by the model triggers the deterministic fallback silently (no user-visible warning, no logged metric).

---

## Appendix A — Quick file-to-feature map

| Feature | Primary files |
|---|---|
| Draft Room | `src/app/page.tsx`, `src/components/DraftTimer.tsx`, `src/lib/draftState.ts`, `src/app/api/draft-state/route.ts`, `src/app/api/draft-log/route.ts`, `src/app/api/active-teams/*` |
| Historian | `src/app/(app)/historian/page.tsx`, `src/components/historian/*`, `src/app/api/llm/ask/route.ts`, `src/app/api/llm/health/route.ts`, `src/lib/llm/schema-context.ts` |
| Team HQ | `src/app/(app)/team-hq/page.tsx`, `src/components/TeamHqView.tsx`, `src/components/TeamHqTabs.tsx`, `src/lib/team-hq/{service,types}.ts`, `src/app/api/team-hq/**` |
| Trade Builder (manual) | `src/app/(app)/trade-builder/page.tsx`, `src/lib/trade/value.ts`, `src/lib/picks.ts` |
| Trade Studio (AI) | `src/app/(app)/trade-studio/page.tsx`, `src/lib/trade/{value,profile,starterLevel}.ts`, `src/lib/leagueRankings.ts`, `src/app/api/trade/llm-rerank/route.ts` |
| Trades inbox + thread | `src/app/(app)/trades/page.tsx`, `src/app/(app)/trades/[id]/page.tsx`, `src/components/TradeCenterTabs.tsx`, `src/app/api/trades/**` |
| Player values | `src/app/api/player-values/**`, `src/app/api/player-values-definitive/route.ts`, `src/app/api/definitive-player-values-smoke/route.ts`, `src/lib/rosterBackfill.ts` |
| Admin ingest / warehouse | `src/app/api/admin/**`, `src/lib/sleeperApi.ts`, `src/lib/leagueHistorySync.ts`, `supabase/migrations/*.sql`, `docs/sleeper-draft-results-runbook.md` |

## Appendix B — Notable constants (collected)

```
INITIAL_PICK_SECONDS         = 30   (Draft Room) / 300 (lib/draftState.ts)   [conflict — see §9.2]
ACTIVE_TEAM_TIMEOUT_MS       = 5 * 60 * 1000        (lib/activeTeams.ts)
ACTIVE_TEAM_TIMEOUT_MINUTES  = 30                   (Draft Room UI)          [conflict — see §9.2]
HEARTBEAT_INTERVAL_MS        = 30_000
ACTIVE_TEAMS_REFRESH_MS      = 12_000
PLAYER_DICT_CACHE_TTL        = 6h (Draft Room) / 24h (Trade Studio/Builder)
STATUS_MESSAGE_TIMEOUT_MS    = 3000
COMMISSIONER_TEAM_NAME       = "Virginia Founders"
TE_FLEX_MULTIPLIER           = 0.75
QB_PREMIUM (offer level)     = 1.25
TE_DISCOUNT (offer level)    = 0.75
FUTURE_PICK_DISCOUNT         = 0.88×  (e.g. 2027 vs 2026)
DEFAULT_PICK_SEASONS         = ["2026", "2027"]
PICK_SLOT_SEASON             = "2026"
TRADE STUDIO thresholds      : YOUNG=24, VETERAN=29, REBUILD_PICK=3, CONTEND_NEAR_TERM_PICK_MAX=2,
                               STUD_VALUE=9000, OFFER_TARGET=6, OFFER_MIN=4
DEAL GRADES                  : Steal ≥1.20, Good ≥1.05, Fair ≥0.95, Slight Overpay ≥0.80, Big Overpay <0.80
HISTORIAN                    : claude-sonnet-4-5, max_tokens=2048, max 12 turns, 200-row cap per query, pool max=2
TRADE RE-RANK                : gpt-4o-mini, max_tokens=2048, temperature=0.4
PICK ANCHORS (Trade Chart)   : 1st=3000, 2nd=1000, 3rd=350
SUPABASE migrations          : 001..004 (see §3.6)
```
