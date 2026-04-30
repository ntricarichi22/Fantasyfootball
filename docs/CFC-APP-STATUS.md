# CFC Front Office — App Status

**Last Updated:** April 29, 2026
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
- **Scoring:** Dynasty/SuperFlex (QB, 2×RB, 2×WR, TE, FLEX, SUPERFLEX)

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
- Auto-start at scheduled time via `/api/draft-tick`
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

### Trade Builder — REDESIGNED (In Progress, Mostly Built)
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

**Files:**
- `src/components/trade/PlayerRow.tsx` — Reusable row with filled availability chips (fixed 62px width)
- `src/components/trade/TierDivider.tsx` — Section divider
- `src/components/trade/RoutingPopup.tsx` — 3-team routing
- `src/components/trade/CartSidebar.tsx` — Shopping cart
- `src/components/trade/ConfirmModal.tsx` — Player added modal with suggestions
- `src/components/trade/RosterModal.tsx` — Full roster browse, position-based
- `src/components/trade/DealCard.tsx` — 2-team and 3-team layouts
- `src/components/trade/AIAdvisor.tsx` — Grade chip + prose + directional suggestions
- `src/components/trade/LandingPage.tsx` — Landing page
- `src/components/trade/TradeBuilder.tsx` — Builder
- `src/app/(app)/trade-builder/page.tsx` — Page wrapper
- `src/app/api/trades/targets/route.ts` — Targets + rankings + rosters + profiles
- `src/app/api/trades/advisor/route.ts` — Anthropic-powered trade advisor

---

## Known Issues / Active Bugs

### AI Advisor
The AI prose frequently contradicts the grade chip direction, suggests wrong team's players, conflates position needs with wants_more, uses filler language, and references completed draft picks. Multiple prompt rewrites have been attempted. The pre-interpreted verdict approach (server tells AI the conclusion, AI explains it) is the latest fix but has not been fully tested. The suggestion direction logic (which side to suggest) was also recently corrected but needs verification.

### Draft Pick Scoring
Picks were not appearing in Top 10 or Priority Targets despite user having `picks_market = buy`. The scoring formula was fixed to use the same `needLevel * 30 + wantsW + value_bonus` path as players, but this fix has not been deployed and tested yet.

### Value Lookups
The trade builder was computing client-side adjusted values instead of reading `final_value` from `cfc_team_trade_values_current`. Fixed to read directly from the database, but not yet deployed.

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
| `/api/trades/targets` | GET | Landing page targets + rankings | ⚠️ Rebuilt, needs deploy/test |
| `/api/trades/advisor` | POST | Trade builder AI advisor | ⚠️ Rebuilt, needs deploy/test |
| `/api/onboarding/player-attachment` | POST | Save attachments | ✅ Working |
| `/api/onboarding/complete` | POST | Mark onboarding complete | ✅ Working |
| `/api/auth/finalize` | POST | Set profile cookie on login | ✅ Working |
| `/api/active-teams` | GET | Active teams | ✅ Working |

---

## Key Libraries

| File | Purpose |
|------|---------|
| `src/lib/draftState.ts` | Draft types, constants (INITIAL_PICK_SECONDS=1800, TOTAL_DRAFT_PICKS=12) |
| `src/lib/draftAutoAdvance.ts` | Auto-announce, auto-skip, auto-advance, draft completion |
| `src/lib/picks.ts` | Pick utilities: labels, values, traded pick computation, withComputedDraftPicks |
| `src/lib/trade/value.ts` | getPickValue, getPlayerValue, getCFCPickKey |
| `src/lib/trade/profile.ts` | Team strategy profiles |
| `src/lib/storedTeam.ts` | readStoredTeam() — cookie-first auth |
| `src/lib/config.ts` | LEAGUE_ID, getLeagueId() |
| `src/lib/supabaseAdmin.ts` | Supabase admin client |

---

## What's Next

### Priority 1: Fix AI Advisor (Trade Builder)
The AI prose, grade chip, and suggestion directions are all working independently but not aligned. Need to deploy the latest fixes and test thoroughly:
- Pre-interpreted verdict in prompt (server tells AI the answer)
- Suggestion direction correction (getting more → suggest sending, giving more → suggest receiving)
- Full roster with stud/youth tags in prompt
- Strategy interpretation paragraph separating position needs from wants_more
- Behavioral context from trade_offers + trade_messages

### Priority 2: Fix Pick Surfacing
- Picks should appear in Top 10 on landing page when picks_market = buy
- Picks should appear in AI Priority Targets on roster modal
- Draft pick exclusion via draft_log (not draft_state status)
- Current year picks show actual slots, future picks show generic

### Priority 3: Mobile Layouts
- Mobile inbox, thread detail, trade builder, counter drawer
- All desktop features need mobile equivalents

### Priority 4: Day 2 Draft
- Build draft room for Rounds 2-3
- Add league_id + season columns to draft_log
- Wire draft_state for phase 2 (or rely on draft_log pick exclusion)

### Deferred
- "Shop Around" screen with AI-generated offers
- Trade Machine / Trade Studio consolidation
- Watchlist management UI
- "Shop This Deal" mechanic (24-hour competing offer window)
- Old trade-builder directory cleanup (`src/components/trade-builder/TradeBuilderView.tsx`, `TradeDrawerPanel.tsx`, `TradeHandle.tsx`)
- Email notifications / Sleeper push integration
- Historian section (historical trades, draft history, league records)
- Vercel cron job for draft auto-start
- Error monitoring / logging

---

## Files to Delete (After Trade Builder Stabilizes)

| File | Reason |
|------|--------|
| `src/components/trade-builder/TradeBuilderView.tsx` | Replaced by new trade system |
| `src/components/trade-builder/TradeDrawerPanel.tsx` | Replaced by new trade system |
| `src/components/trade-builder/TradeHandle.tsx` | Replaced by new trade system |

---

## Useful SQL Commands

```sql
-- Check current draft state
SELECT * FROM draft_state WHERE league_id = '1328902558617473024';

-- Check drafted picks
SELECT pick_index, pick_number, player_name, team_name, submitted_at
FROM draft_log WHERE submitted_at IS NOT NULL ORDER BY pick_index;

-- Check a team's strategy profile
SELECT * FROM cfc_team_strategy_profiles WHERE team_id = '2';

-- Check a team's player attachments
SELECT sleeper_player_id, attachment
FROM cfc_team_player_attachment WHERE team_id = '2';

-- Check team-adjusted values for specific players
SELECT player_name, base_value, final_value, market_modifier_pct
FROM cfc_team_trade_values_current
WHERE team_id = '2' AND player_name IN ('Chase Brown', 'DJ Moore')
ORDER BY final_value DESC;

-- Check base pick values
SELECT display_name, cfc_value
FROM cfc_trade_values_current
WHERE display_name IN ('1.06', '2.06', '3.06');

-- Check all table columns (ALWAYS DO THIS BEFORE GUESSING)
SELECT column_name, data_type
FROM information_schema.columns
WHERE table_name = 'YOUR_TABLE_NAME'
ORDER BY ordinal_position;
```
