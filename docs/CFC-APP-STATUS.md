# CFC Front Office — App Status

**Last Updated:** May 3, 2026
**Live URL:** https://fantasyfootball-six.vercel.app

---

## Project Overview

CFC Front Office is a bespoke dynasty fantasy football web app for a 12-team Sleeper league called the Cleveland Football Club. It provides team owners with a premium, club-like experience for managing rosters, making trades, running the rookie draft, and analyzing their dynasty assets.

---

## Tech Stack

- **Framework:** Next.js 16 (App Router), React 19, TypeScript
- **Styling:** Tailwind 4 + inline styles (neobrutalist design system)
- **Database:** Supabase (PostgreSQL + Realtime subscriptions)
- **Hosting:** Vercel
- **Data Source:** Sleeper API (rosters, players, draft picks, traded picks)
- **AI:** Anthropic API (Claude Sonnet 4.5) for trade advisor, AI quips, counter suggestions
- **Auth:** Supabase Auth (email/password) with cookie-based profile completion check

---

## League Configuration

- **League ID (Sleeper):** `1328902558617473024` (new league ID each season)
- **Teams:** 12
- **Draft:** 2 drafts per season — Day 1 (Round 1), Day 2 (Rounds 2-3). Slow draft format, 30-min pick windows.
- **Pick announcement:** Snaps to :00/:30 wall-clock boundaries
- **Scoring:** Dynasty/SuperFlex (QB, 2×RB, 2×WR, TE, FLEX, SUPERFLEX). 0.05/passing yard, 1.0/receiving first down, 0.5/rushing first down, otherwise standard PPR (no per-reception).

---

## Routes

| Route | File | Purpose |
|-------|------|---------|
| `/` | `src/app/page.tsx` | Root — HomeScreen or Draft Room based on state |
| `/draft` | `src/app/(app)/draft/page.tsx` | 5-line wrapper importing root page |
| `/trade-builder` | `src/app/(app)/trade-builder/page.tsx` | Trade builder (landing page ↔ builder flow) |
| `/trades` | `src/app/(app)/trades/page.tsx` | Trade inbox (GM Office) |
| `/trades/[id]` | `src/app/(app)/trades/[id]/page.tsx` | Trade thread detail |
| `/trade-studio` | `src/app/(app)/trade-studio/page.tsx` | AI trade generator (needs review) |
| `/onboarding` | `src/app/(app)/onboarding/page.tsx` | 4-screen onboarding flow |
| `/login` | `src/app/(app)/login/page.tsx` | Login |
| `/signup` | `src/app/(app)/signup/page.tsx` | Signup |

---

## Completed Features

### Auth & Onboarding
- Supabase Auth with email/password
- `middleware.ts` checks `cfc_profile_complete` cookie, redirects to `/onboarding` if false
- 4-screen onboarding: Welcome (envelope animation) → Player Attachment (2×2 grid per player) → Wants More (Topps cards) → Team Needs (sliding bars for Low/Med/High + picks)
- Onboarding saves to `cfc_team_strategy_profiles` (position markets + picks_market + wants_more) and `cfc_team_player_attachment` (per-player availability)

### Homepage
- Responsive: 2-column mobile, 4-column desktop
- Cards: War Room, GM Office, Owner's Box, Historian
- Dynamic draft subtext with 2026 date

### Draft Room (Day 1 — Complete)
- Real-time draft with 30-minute pick windows
- Auto-start at scheduled time via `/api/draft-tick` (Vercel cron job in place)
- Pick announcement on :00/:30 wall-clock boundaries with 3-phase reveal animation
- Auto-skip on timeout, auto-advance, draft completion at 12 picks
- Collapsible roster panel with lineup/bench/picks view
- Start/Pause/Resume controls visible to all users
- Mute toggle for draft chime
- "Trade up" / "Shop this pick" buttons in ClockBar linking to trade builder

### Owner's Box
- Refactored from monolith into: OwnersBoxView, StrategyTab, DepthChartTab, TradeChartTab, Card
- Strategy editing with buy/hold/sell ↔ Low/Med/High mapping fix
- Player attachment editing (untouchable/core_piece/listening/moveable)

### GM Office — Trade Inbox
- Three-column sticky marquee: CFC Insider (black) + Make an Offer (blue) + Shop Around (yellow)
- Left column: CFC Insider feed (4 item types: done_deal, active_talks, on_the_block, multiple_calls)
- Right column: filter pills (All/Open/Closed) + search, trade cards
- Trade cards with perspective-aware AI quips, action buttons (Accept/Reject/Counter/View)
- Active/closed deal separators

### Trade Thread Detail Page
Two modes, both fully built and deployed:

**Default mode:** Full-width unified timeline. Offers (yellow 2.5px border, bottom shadow) and chat bubbles (black borders, white for theirs, ink for yours) interleaved chronologically. Latest pending offer shows Accept/Reject/Counter. Previous offers compact at 60% opacity. Chat input pinned at bottom with red arrow. Scroll-to-bottom button. Height fixed to `calc(100vh - 44px)`.

**Counter mode:** Timeline slides to 40% width at 40% opacity. Counter drawer takes 60% on right. Flow: pinned current offer → AI negotiation brief → aggression slider ("How do you want to play this counter?" with "Get it done" ↔ "Test their floor") → 3 numbered AI counter suggestions (Syne 800 numerals, selected = ink fill) → "Build it yourself" (outline blue). Send flow: tap suggestion → goes black → "Send counter" → modal with optional message.

**Files:**
- `src/components/gm-office/ThreadPage.tsx`
- `src/components/gm-office/CounterDrawer.tsx`
- `src/components/gm-office/ChatBubble.tsx`
- `src/components/gm-office/AcceptModal.tsx`
- `src/components/gm-office/RejectModal.tsx`
- `src/app/api/trades/ai-counter/route.ts`

### Trade Builder — REDESIGNED
Complete redesign from old three-panel layout. Two-screen flow:

**Landing Page ("Who are you targeting?"):**
- Search bar across all players + picks across all other teams
- "On the block" section: top 10 targets driven by MY needs (position markets + wants_more), availability as secondary sort. Both players and picks. Left-aligned section dividers.
- "Trade partners" section: 11 teams ranked by three-stage sort (have what I want → complementary profile → I have what they want). Each row: rank, team name, wants chips, headline, chevron.
- Cart sidebar appears on right after first item added
- Confirmation modal after clicking player: 4 AI suggestion cards + "See more" card
- Roster modal: organized by position (QBs → RBs → Pass Catchers → Picks), AI Priority Targets at top (3-5 max), filled availability chips, dual listing

**Trade Builder:**
- Left 58%: Dark blue deal card → AI advisor card → Pinned send button
- Right 42%: Team name tabs (nicknames, dynamic font for 3-team) → Search → Roster by position with filled chips
- AI advisor: Anthropic-powered prose (debounced 2s) + client-side grade chip + always-on gap-closing suggestions with "Send →" / "← Receive" directional chips
- 2-team: per-side +Add buttons in deal card, auto-routing
- 3-team: universal +Add at bottom, routing popup for every tap
- Grade: Red >20% gap, Yellow 10-20%, Green <10%

**Manual trade proposal UI shipped earlier:**
- Change team button (modal-based — keeps user's send side, drops other team's assets)
- +Add team button (3rd team appended, auto-switches to new team's tab)
- Remove third team via ✕ on third tab
- Asset row tap-popover: "Remove" + "Reroute to [team]" options

**Files:**
- `src/components/trade/PlayerRow.tsx`
- `src/components/trade/TierDivider.tsx`
- `src/components/trade/RoutingPopup.tsx`
- `src/components/trade/CartSidebar.tsx`
- `src/components/trade/ConfirmModal.tsx`
- `src/components/trade/RosterModal.tsx`
- `src/components/trade/DealCard.tsx`
- `src/components/trade/TeamPickerModal.tsx`
- `src/components/trade/AIAdvisor.tsx`
- `src/components/trade/LandingPage.tsx`
- `src/components/trade/TradeBuilder.tsx`
- `src/app/(app)/trade-builder/page.tsx`
- `src/app/api/trades/targets/route.ts`
- `src/app/api/trades/advisor/route.ts`

### Value Pipeline (REBUILT — May 3, 2026)

Complete replacement of the old scrape-based pipeline. Now API/scrape-only with three independent sources, all using Superflex/2QB endpoints.

**Architecture:**
```
External sources (3) → cfc_asset_source_values
                            ↓
                cfc_rebuild_value_layers()
                            ↓
                  cfc_asset_calculations
                            ↓
                cfc_trade_values_current (VIEW)
                            ↓
        rebuildTeamTradeValuesForTeam (per team)
                            ↓
            cfc_team_trade_values_current
```

**Sources:**
- **FantasyCalc** — `https://api.fantasycalc.com/values/current?isDynasty=true&numQbs=2&numTeams=12&ppr=1` — has `player.sleeperId` natively
- **DynastyProcess** — GitHub raw CSVs (`values.csv` for `value_2qb`, `db_playerids.csv` for name → sleeper_id)
- **KeepTradeCut** — scraped from `https://keeptradecut.com/dynasty-rankings?page={N}&filters=QB|WR|RB|TE|RDP&format=2`. Paginates 10 pages. Strips team suffixes including Roman numerals embedded before team codes (handles "Kenneth Walker IIIKCC", "Chris Brazzell IIRCAR", etc).

**Each source returns** `{ rows: SourceRow[]; pick_101_value: number | null }`. The 1.01 pick value is used as the denominator: `multiple_101 = raw_value / pick_101_value`. Sources without a 1.01 anchor are skipped automatically.

**Source files:**
- `src/lib/values/sources/fantasycalc.ts`
- `src/lib/values/sources/dynastyprocess.ts`
- `src/lib/values/sources/keeptradecut.ts`
- `src/lib/values/normalize.ts` — multi-tier name resolution: alias map → Sleeper dict (with diacritic / suffix / nickname / punctuation handling)
- `src/app/api/internal/refresh-values/route.ts` — orchestration

**League-level multipliers** (in `cfc_rebuild_value_layers()` Postgres function):
1. Source consensus (median of multiples × $300 anchor → `composite_value`)
2. Position multiplier — QB 1.00, WR 1.00, TE tiered (1.00/0.85/0.70/0.50), RB tiered (1.00/0.97/0.95/0.92, floor 0.88)
3. Elite multiplier — 1.20 for `composite_value > $300`
4. Age multiplier — rookie 1.12, young 1.10, prime 1.00, aging 0.90
5. Per-player scoring factor (CFC-specific) — last/prior season 70/30 blend for vets, 1.00 for rookies. Formula: `cfc_pts = standard_PPR - 1.0×rec + 1.0×rec_fd + 0.5×rush_fd + 0.01×pass_yd`. Floored 0.5, capped 1.5.
6. Manual override (escape hatch on `cfc_assets.manual_override_value`)

**Age cutoffs (used in BOTH league multipliers AND team-level youth modifier):**
- QB: young ≤25, prime 26-32, aging 33+
- RB: young ≤23, prime 24-26, aging 27+
- WR/TE: young ≤24, prime 25-29, aging 30+

**Team-level modifiers** (in `src/lib/team-hq/service.ts`, function `rebuildTeamTradeValuesForTeam`):

Three modifiers, additive, NO global cap (bounded individually by design):

1. **Studs:** +5% if `base_value > $250` AND `wants_more` includes "studs"
2. **Youth:** +5% young / -5% aging / 0% prime — only fires if `wants_more` includes "youth". Uses age cutoffs above.
3. **Attachment** (per-player from `cfc_team_player_attachment`):
   - `untouchable`: +10%
   - `core_piece`: +5%
   - `listening`: 0%
   - `moveable`: -5%

**Max stack:** studs (+5) + youth_young (+5) + untouchable (+10) = **+20%**
**Min stack:** youth_old (-5) + moveable (-5) = **-10%**

**Removed in this session:** market modifier (qb/rb/wr/te buy/hold/sell ±7%) and own_guys_modifier (team-wide ±10%). The new attachment system makes both redundant. Schema columns kept for backward compatibility — `own_guys_modifier_pct` repurposed to hold the attachment modifier value.

**Manual overrides:** absolute dollar amounts in `cfc_team_player_value_overrides`. NOT touched by cron — they represent the user's stable signal of "what would I trade this player for." The override → final_value path stays intact.

### Cron Orchestration
- Schedule: `0 8 * * *` (4am ET daily) in `vercel.json`
- Auth: accepts `Bearer ${CRON_SECRET}` (Vercel cron auto-injects) OR `Bearer ${ADMIN_SECRET}` (header) OR `?secret=${ADMIN_SECRET}` (query string for browser triggering)
- Flow: fetch all 3 sources in parallel → skip+log+continue on individual failures → abort if <2 succeed (keeps yesterday's values intact) → upsert `cfc_assets` (with `years_exp` from Sleeper) → replace `cfc_asset_source_values` for the 3 sources → compute scoring factors from Sleeper season stats → call `cfc_rebuild_value_layers()` → loop teams 1-12 calling `rebuildTeamTradeValuesForTeam`
- Returns JSON summary including `pick_101_by_source` for visibility

### Cleanup Completed (May 3, 2026)
- Dropped legacy admin routes: `refresh-definitive-values`, `backfill-player`, `import-cfc-values`, `seed-tgif-pick-anchors`
- Removed old vercel.json cron entry for `refresh-definitive-values`
- Cleared stale source values from disabled sources (draftsharks, fantasypros, yahoo)
- Dropped orphaned table: `definitive_values`
- Old `src/components/trade-builder/` directory deleted (replaced by `src/components/trade/`)
- Cron auth now supports both CRON_SECRET (Vercel cron) and ADMIN_SECRET (manual)

---

## Known Issues / Active Bugs

### League Historian
Nick noticed issues with the historian section. Will be tackled in a separate session. Keeping the slp/flea/mfl admin ingestion routes around until then in case re-ingestion is needed.

### AI Advisor
The AI prose has historically had alignment issues with the grade chip direction, suggested wrong team's players, conflated position needs with wants_more, used filler language, and referenced completed draft picks. Multiple prompt rewrites have been attempted. The pre-interpreted verdict approach (server tells AI the conclusion, AI explains it) is the latest fix but has not been fully re-tested with the new value pipeline.

### Manual Override Drift
Manual override values stored in `cfc_team_player_value_overrides` are absolute dollar amounts that don't update when league values change. By design — overrides represent the user's stable signal ("what would I trade this player for"). However, the UI does not currently surface when an override has drifted significantly from the auto-calculated value. Slated for next session.

---

## API Routes

| Route | Method | Purpose | Status |
|-------|--------|---------|--------|
| `/api/draft-state` | GET/POST | Draft state read/write | ✅ Working |
| `/api/draft-tick` | GET/POST | Draft heartbeat | ✅ Working |
| `/api/draft/submit-pick` | POST | Submit draft pick | ✅ Working |
| `/api/draft/rookie-prospects` | GET | Rookie prospect data | ✅ Working |
| `/api/player-values` | GET | CFC base player values | ✅ Working |
| `/api/trades/create` | POST | Create trade offer | ✅ Working |
| `/api/trades/list` | GET | List trade offers | ✅ Working |
| `/api/trades/threads/[id]` | GET | Trade thread detail | ✅ Working |
| `/api/trades/ai-quip` | POST | AI quips for trade cards | ✅ Working |
| `/api/trades/insider` | GET | CFC Insider feed | ✅ Working |
| `/api/trades/ai-counter` | POST | Counter suggestions for thread page | ✅ Working |
| `/api/trades/targets` | GET | Landing page targets + rankings | ✅ Working |
| `/api/trades/advisor` | POST | Trade builder AI advisor | ⚠️ Re-test against new value pipeline |
| `/api/internal/refresh-values` | GET/POST | Daily value refresh (cron) | ✅ Working |
| `/api/onboarding/player-attachment` | POST | Save attachments | ✅ Working |
| `/api/onboarding/complete` | POST | Mark onboarding complete | ✅ Working |
| `/api/auth/finalize` | POST | Set profile cookie on login | ✅ Working |
| `/api/active-teams` | GET | Active teams | ✅ Working |

### Admin/Ingestion Routes (Kept until historian session)
| Route | Purpose |
|-------|---------|
| `/api/admin/sleeper-history` | Backfill Sleeper league history |
| `/api/admin/sleeper-players` | Refresh Sleeper player dictionary |
| `/api/admin/sleeper-smoke` | Sleeper draft data ingestion |
| `/api/admin/lineup-stats` | Populate slp_starters_enriched |
| `/api/admin/build-player-weekly-game-log` | Populate slp_player_weekly_game_log |
| `/api/admin/build-player-weekly-presence` | Populate slp_player_weekly_presence |
| `/api/admin/build-transaction-items` | Populate slp_transaction_items |
| `/api/admin/ingest/sleeper-draft-results` | Populate slp_mirror_draft_results |
| `/api/admin/ingest/fleaflicker` | Legacy Fleaflicker league ingestion |
| `/api/admin/ingest/fleaflicker-roster-detail` | Legacy Fleaflicker roster detail |
| `/api/admin/ingest/mfl` | Legacy MFL league ingestion |
| `/api/admin/ingest/mfl-players` | Legacy MFL player metadata |
| `/api/admin/populate-rookies` | One-time rookie pool bootstrap |

---

## Key Libraries

| File | Purpose |
|------|---------|
| `src/lib/draftState.ts` | Draft types, constants (INITIAL_PICK_SECONDS=1800, TOTAL_DRAFT_PICKS=12) |
| `src/lib/draftAutoAdvance.ts` | Auto-announce, auto-skip, auto-advance, draft completion |
| `src/lib/picks.ts` | Pick utilities: labels, values, traded pick computation, withComputedDraftPicks |
| `src/lib/trade/value.ts` | getPickValue, getPlayerValue, getCFCPickKey |
| `src/lib/trade/profile.ts` | Team strategy profiles |
| `src/lib/team-hq/service.ts` | rebuildTeamTradeValuesForTeam, team-level modifier math |
| `src/lib/values/normalize.ts` | Multi-tier player name → Sleeper ID resolution |
| `src/lib/storedTeam.ts` | readStoredTeam() — cookie-first auth |
| `src/lib/config.ts` | LEAGUE_ID, getLeagueId() |
| `src/lib/supabaseAdmin.ts` | Supabase admin client |

---

## What's Next

### Priority 1: Manual Override UI Enhancement
Surface auto_value vs override delta in the UI. Show user when their override has drifted significantly from current auto_value so they can decide whether to revisit. UI work, no backend changes. Both `auto_value` and `final_value` are already stored as separate columns in `cfc_team_trade_values_current` — just needs visual treatment.

### Priority 2: League Historian Troubleshooting
Nick noticed issues with the historian section. Tackle in a separate session. The slp/flea/mfl admin ingestion routes are still in place if re-ingestion is needed.

### Priority 3: Re-test AI Advisor
The trade builder AI advisor was last tuned before the value pipeline rebuild. The new modifiers (untouchable +10%, no market modifier, etc.) may surface new advisor inconsistencies. Spot-check with realistic trades.

### Priority 4: Mobile Layouts
Mobile inbox, thread detail, trade builder, counter drawer. All desktop features need mobile equivalents.

### Priority 5: Day 2 Draft
Build draft room for Rounds 2-3. Add league_id + season columns to draft_log. Wire draft_state for phase 2 (or rely on draft_log pick exclusion).

### Deferred / Parking Lot
- Layer 2 personality learner (nightly job summarizing each team's negotiating personality from accepted offers + chat)
- "Shop Around" screen with AI-generated offers
- Trade Machine / Trade Studio consolidation
- Watchlist management UI
- "Shop This Deal" mechanic (24-hour competing offer window)
- Email notifications / Sleeper push integration
- Historian section (historical trades, draft history, league records)
- Drop now-orphaned table: `tgif_pick_anchors`
- Error monitoring / logging
- Phase 5 alias seeding for any new unmapped names that appear over time

---

## Known unmapped players (low priority — safe to ignore)

These show up in `cfc_unmapped_log` but aren't worth aliasing:
- KTC: Chigoziem Okonkwo, Bam Knight, Frank Gore Jr.
- DynastyProcess: Hollywood Brown (Sleeper has him as Marquise Brown)

---

## Useful SQL Commands

```sql
-- Check current draft state
SELECT * FROM draft_state WHERE league_id = '1328902558617473024';
```

```sql
-- Check drafted picks
SELECT pick_index, pick_number, player_name, team_name, submitted_at
FROM draft_log WHERE submitted_at IS NOT NULL ORDER BY pick_index;
```

```sql
-- Check a team's strategy profile
SELECT * FROM cfc_team_strategy_profiles WHERE team_id = '2';
```

```sql
-- Check a team's player attachments
SELECT sleeper_player_id, attachment
FROM cfc_team_player_attachment WHERE team_id = '2';
```

```sql
-- Check team-adjusted values for specific players
SELECT player_name, base_value, auto_value, manual_override_value, final_value,
       studs_modifier_pct, youth_modifier_pct, own_guys_modifier_pct as attachment_pct, total_modifier_pct
FROM cfc_team_trade_values_current
WHERE team_id = '2'
ORDER BY final_value DESC;
```

```sql
-- Check base pick values
SELECT display_name, cfc_value
FROM cfc_trade_values_current
WHERE display_name IN ('1.06', '2.06', '3.06');
```

```sql
-- Check value pipeline freshness
SELECT MAX(rebuilt_at) FROM cfc_asset_calculations;
SELECT source_key, COUNT(DISTINCT asset_key) as players, MAX(import_batch)
FROM cfc_asset_source_values GROUP BY source_key;
```

```sql
-- Spot check Mahomes with multipliers
SELECT a.display_name, a.position, a.years_exp,
  c.source_count, c.composite_value,
  c.position_multiplier_applied, c.elite_multiplier_applied,
  c.age_multiplier_applied, c.scoring_factor_applied,
  c.final_cfc_value
FROM cfc_assets a
JOIN cfc_asset_calculations c ON c.asset_key = a.asset_key
WHERE a.display_name = 'Patrick Mahomes';
```

```sql
-- Recent unmapped players from value pipeline
SELECT source_key, source_player_name, MAX(raw_value) as raw_value
FROM cfc_unmapped_log
WHERE created_at > NOW() - INTERVAL '24 hours'
GROUP BY source_key, source_player_name
ORDER BY raw_value DESC NULLS LAST;
```

```sql
-- Check all table columns (ALWAYS DO THIS BEFORE GUESSING)
SELECT column_name, data_type
FROM information_schema.columns
WHERE table_name = 'YOUR_TABLE_NAME'
ORDER BY ordinal_position;
```
