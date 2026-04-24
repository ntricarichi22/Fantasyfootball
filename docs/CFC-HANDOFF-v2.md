# CFC Front Office App — Comprehensive Handoff Document
*Last updated: April 22, 2026*

---

## INSTRUCTIONS FOR THE NEW CLAUDE INSTANCE

You are picking up an ongoing app build with a specific user who has strong opinions, a clear vision, and zero tolerance for sloppy work. Read this entire document before responding to anything. Then, before writing a single line of code or making any assumptions:

1. **Ask the user what they want to work on today**
2. **Ask for any files you need to see** — never assume file contents, always ask to paste them
3. **Start with ideation, then mockups, then code** — this is the user's preferred workflow. Never jump straight to code.
4. **Generate downloadable HTML mockup files** when doing UI work so the user can open them in a browser at full desktop width
5. **Never make multiple changes at once without confirming** — surgical, targeted edits only
6. **When outputting code files for the user to paste**, generate them as downloadable markdown files so the user can open and copy with one click
7. **Never assume column names** — always verify against the schema section below. Wrong column names have burned hours of debugging.

---

## Big Picture

**App name:** CFC Front Office
**What it is:** A custom browser-based dynasty fantasy football management app for Cleveland Football Club (CFC), a 12-team Sleeper league that has been running since 2019 (7 years). It is NOT a generic fantasy app — it is a bespoke front office tool built specifically for this league with league-specific trade values, AI assistance, and a premium UI.

**The core philosophy:** Every owner should feel like they run an NFL franchise. The UI should feel like a front office tool, not a fantasy sports website. The aesthetic is 1990s Topps trading cards meets neobrutalism — bold borders, solid offset shadows, high contrast, no gradients, no rounded pills.

**Repo:** `github.com/ntricarichi22/Fantasyfootball`
**Deployed on:** Vercel
**Database:** Supabase
**League platform:** Sleeper (external API)

---

## Tech Stack

- Next.js 16
- React 19
- TypeScript
- Tailwind 4
- Supabase (PostgreSQL database + Realtime subscriptions)
- Vercel (deployment + preview environments)
- Sleeper API (roster data, player dictionary, league info)
- Anthropic API (Assistant GM AI chat in draft room)

---

## Design System — LOCKED, DO NOT CHANGE

Full spec in `DESIGN_SYSTEM.md` at repo root. Key rules:

**Colors:**
- Blue: `#3366CC`
- Red: `#E8503A`
- Yellow: `#F5C230`
- Ink: `#1A1A1A`
- Canvas: `#F5F0E6`
- Card: `#FEFCF9`
- Muted: `#8C7E6A`
- Border muted: `#C8C3B8`

**Position chip colors:**
- QB: `#E8503A` bg, white text
- RB: `#3366CC` bg, white text
- WR/TE: `#F5C230` bg, `#1A1A1A` text

**Fonts:**
- Syne 800/900 — headlines, card titles, emphasis
- DM Sans — body text, descriptions
- JetBrains Mono — stats, numbers, timestamps, labels

**Non-negotiable rules:**
- 2.5px solid `#1A1A1A` borders everywhere
- Solid offset box shadows (e.g. `4px 4px 0 #1A1A1A`)
- NO gradients (Zubaz card background image is the one exception)
- NO rounded corners / pill shapes
- NO blurred shadows
- **Lean heavily into black/ink** — the user has repeatedly pushed back on too much color. Default to black, use color sparingly and purposefully
- Everything must fit on screen without page-level scrolling. Use `overflow: hidden` at the page level and internal scrolling on specific panels only

---

## App Navigation — The Three Doors + Historian

The homepage (`/`) shows four "door" cards in a 2×2 grid styled as Topps trading cards. Each door navigates to a section:

### 1. War Room (`/draft`)
The live draft room. The most complex feature — fully built and functional.

### 2. Owner's Box (`/team-hq`)
Previously called "Team HQ". Renamed to "Owner's Box" during this session. Three tabs:
- **Strategy** — team profile settings (renamed from generic form UI)
- **Depth Chart** — placeholder with hardcoded data, not yet wired to real roster
- **Trade Chart** — player trade values with pick-based adjustment

### 3. GM Office (`/trades`)
Previously called "Trade Center". Renamed to "GM Office". This is the trade proposal and negotiation feature. **Trade Center is fully built on the backend but the UI needs a redesign.** This is the next major work item.

### 4. League Historian (`/historian`)
AI chat interface for asking questions about league history. Fully built and functional.

---

## Feature Status

### ✅ COMPLETE — War Room (Draft Room)
- Real-time draft with 30-minute async pick windows
- Desktop + mobile layouts
- Clock bar with pick announcement animation
- Zubaz-style player cards (front: portrait with Topps styling, back: scouting report)
- Assistant GM AI panel (powered by Anthropic API)
- Auto-announcement system with 3-second polling safety net
- Draft ticker (scrolling pick feed)
- Pick submission with duplicate prevention
- Auto-skip when timer expires
- Chime audio on pick submission and announcement

### ✅ COMPLETE — Auth System
- Email + password auth (replaced old dropdown team picker)
- `team_email_map` table maps emails to roster IDs
- Cookies: `cfc_roster_id`, `cfc_team_name`, `cfc_email`, `cfc_identity` (non-httpOnly, readable client-side)
- **CRITICAL:** `readStoredTeam()` in `src/lib/storedTeam.ts` reads `cfc_identity` cookie FIRST, then falls back to sessionStorage. This fixed all navigation bounce bugs. Never revert this.

### ✅ COMPLETE — Onboarding
- First-login flow at `/onboarding` (4 screens)
- Redirected to automatically if `profile_complete = false`
- Sets team strategy profile on completion

### ✅ COMPLETE — Homepage
- Four Topps-style door cards
- Live data: draft pick count, open trade thread count
- "Make your move" headline
- "Front Office" hero title
- "Cleveland Football Club · 7 Years Running" eyebrow

### ✅ REDESIGNED THIS SESSION — Owner's Box Strategy Tab
- Three sections: Team Needs (Low/Med/High per position), Priority Targets (picks/studs/youth/depth), Taking Calls (player-level availability)
- Taking Calls pulls real Sleeper roster via `useMyRoster` hook
- Player attachment saves per-player to `cfc_team_player_attachment` table
- New attachment values: `untouchable`, `core_piece`, `listening`, `moveable`
- Old values (`love_my_guys`, `prefer_to_keep_them`, `neutral`, `ready_to_shake_it_up`) are mapped on read — no migration needed
- Layout: fixed to screen, no page scroll, left column (Team Needs + Priority Targets stacked) + right column (Taking Calls with internal scroll)

### ✅ REDESIGNED THIS SESSION — Owner's Box Trade Chart Tab
- New UI: clean table with accordion expand per row
- Columns: Player | Pos | Team | CFC Value | Your Value | +/− | chevron
- Clicking a row expands an inline dark panel (same height as row) showing 1sts / 2nds / 3rds steppers
- Auto-saves on every stepper click (no Save button)
- Auto-populates pick counts from base value on load
- Chevron is always `#1A1A1A` (black) in both open and closed states

### 🔲 NEXT — GM Office (Trade Center) Redesign
The backend is fully built. The UI needs a redesign. The user's workflow: **ideation → mockup → code**. Start by asking the user what they want the GM Office to look and feel like before touching any files.

### 🔲 PENDING — Depth Chart Tab
Currently shows hardcoded placeholder data (not real roster). Needs to be wired to Sleeper roster data. Not urgent — leave as-is for now.

### 🔲 PENDING — Season record / standings data on homepage
Currently hardcoded placeholder ("8th place, 7-6"). Needs to pull from Sleeper historical data.

---

## File Map — Key Files

### Pages
- `src/app/page.tsx` — **ROOT PAGE** — renders HomeScreen OR the draft room depending on route. 650+ lines. Contains all draft room state management. Do not refactor without extreme caution.
- `src/app/(app)/draft/page.tsx` — 5-line wrapper that imports from `src/app/page.tsx`
- `src/app/(app)/team-hq/page.tsx` — renders `<TeamHqView />` wrapped in Suspense
- `src/app/(app)/historian/page.tsx` — renders historian
- `src/app/login/page.tsx` — email + password login page
- `src/app/onboarding/page.tsx` — first-time onboarding flow

### Components
- `src/components/HomeScreen.tsx` — homepage with four door cards. Uses `window.location.href` (NOT `router.push`) for all navigation.
- `src/components/TeamHqView.tsx` — Owner's Box with three tabs (Strategy, Depth Chart, Trade Chart). ~600 lines. Redesigned this session.
- `src/components/TeamHqTabs.tsx` — tab navigation component for Owner's Box
- `src/components/ClockBar.tsx` — draft room clock bar, pick announcement animation, chime, tick trigger. ~1200 lines. Most complex component.
- `src/components/DraftTicker.tsx` — scrolling pick feed at bottom of draft room
- `src/components/DraftStatusProvider.tsx` — Supabase Realtime context provider for draft state
- `src/components/historian/` — folder containing all historian components (HistorianChat, WelcomeScreen, ChatInput, ChatMessage, ConversationSidebar, markdown, types)

### Hooks
- `src/lib/storedTeam.ts` — **CRITICAL** — `readStoredTeam()` reads `cfc_identity` cookie first, then sessionStorage fallback. All pages use this for identity. Do not change the cookie-first logic.
- `src/lib/hooks/useMyRoster.ts` — fetches logged-in user's Sleeper roster. New this session. Returns `{ players, loading, error }` where players are `{ id, name, position, nflTeam }[]`
- `src/lib/hooks/useDraftStatus.ts` — draft state hook
- `src/lib/hooks/useDraftClock.ts` — draft clock management
- `src/lib/hooks/useSleeperData.ts` — fetches all 12 rosters, player dictionary, league data from Sleeper
- `src/lib/hooks/useRookieProspects.ts` — fetches rookie prospects from Supabase
- `src/lib/draftState.ts` — draft types, `INITIAL_PICK_SECONDS` (currently 30 for testing, must be 1800 for real draft), `computeSecondsUntilAnnouncement`

### API Routes
- `src/app/api/auth/prepare/route.ts` — checks if email is in team_email_map
- `src/app/api/auth/signup/route.ts` — creates Supabase auth user
- `src/app/api/auth/finalize/route.ts` — sets identity cookies after login
- `src/app/api/draft-tick/route.ts` — **CRITICAL** — idempotent endpoint that auto-announces picks and auto-skips teams when timer expires
- `src/app/api/draft-state/route.ts` — GET draft state
- `src/app/api/draft/submit-pick/route.ts` — pick submission with duplicate prevention
- `src/app/api/home/trade-count/route.ts` — GET count of open trade threads for logged-in user
- `src/app/api/team-hq/strategy/route.ts` — GET/POST team strategy profile
- `src/app/api/team-hq/trade-chart/route.ts` — GET/POST trade chart data
- `src/app/api/team-hq/trade-chart/override/route.ts` — POST manual pick value override
- `src/app/api/team-hq/attachment/route.ts` — GET/POST player attachment values. New this session.
- `src/app/api/llm/ask/route.ts` — historian AI endpoint

### Static Assets
- `public/zubaz-card-bg.png` — Zubaz tiger stripe pattern (blue/red/black) used on player card fronts
- `public/nfl-draft-chime.mp3` — chime audio
- `public/cfc-logo.png` — CFC logo used in topbar

### Config
- `DESIGN_SYSTEM.md` — full design system spec
- `CLAUDE.md` — project context for AI agents
- `middleware.ts` — auth middleware, checks `cfc_roster_id` cookie, redirects to `/login` if missing

---

## Supabase Schema — CRITICAL, NEVER GET THESE WRONG

### `draft_state`
| Column | Type | Notes |
|--------|------|-------|
| league_id | text (PK) | |
| status | text | 'running', 'paused', 'completed' |
| seconds_remaining | int | Current pick window |
| clock_started_at | timestamptz | When current clock started |
| current_pick_index | int | 0-based |
| pick_submitted | bool | True when team has submitted |
| pick_announced_at | timestamptz | When pick will be revealed |
| starts_at | timestamptz | Scheduled draft start |

### `draft_log`
| Column | Type | Notes |
|--------|------|-------|
| pick_index | int (PK) | 0-based |
| pick_number | text | e.g. "1.01" |
| team_count | int | |
| team_name | text | |
| roster_id | int | Sleeper roster ID |
| player_id | text | |
| player_name | text | |
| positions | JSONB | e.g. ["RB"] |
| nfl_team | text | |
| submitted_at | timestamptz | |
| announced_at | timestamptz | |
| is_announced | bool | |
| is_skip | bool | |

Unique constraint: `CREATE UNIQUE INDEX draft_log_player_unique ON draft_log (player_id) WHERE player_id IS NOT NULL;`

### `rookie_prospects`
| Column | Type | Notes |
|--------|------|-------|
| player_id | text (PK) | |
| player_name | text | **NOT "name" — this caused a major bug** |
| position | text | |
| college | text | |
| age | int | |
| height_inches | int | |
| weight | int | |
| nfl_team | text | |
| nfl_draft_round | int | |
| nfl_draft_pick | int | |
| avatar_url | text | |

### `cfc_trade_values_current`
League trade values. Key columns: `player_name`, `birth_date` (for age calc), various value columns. Used by draft board and Assistant GM.

### `cfc_team_trade_values_current`
Team-specific adjusted trade values. Used by trade chart.

### `team_email_map`
| Column | Type |
|--------|------|
| email | text |
| roster_id | text |
| team_name | text |
| profile_complete | bool |

### `cfc_team_player_attachment`
| Column | Type | Notes |
|--------|------|-------|
| league_id | text (PK) | |
| team_id | text (PK) | |
| sleeper_player_id | text (PK) | |
| attachment | text | 'untouchable', 'core_piece', 'listening', 'moveable' |
| updated_at | timestamptz | |

Old values in DB: `love_my_guys` → `untouchable`, `prefer_to_keep_them` → `core_piece`, `neutral` → `listening`, `ready_to_shake_it_up` → `moveable`. Mapped on read in API route.

### `trade_threads`
| Column | Type | Notes |
|--------|------|-------|
| id | uuid | |
| league_id | text | |
| team_a_id | text | |
| team_b_id | text | |
| created_by_team_id | text | |
| status | text | 'open', 'closed', 'withdrawn', 'declined' |
| last_activity_at | timestamptz | |
| unread_by_team_a | int | |
| unread_by_team_b | int | |

### `trade_offers`
| Column | Type | Notes |
|--------|------|-------|
| id | uuid | |
| league_id | text | |
| from_team_id | text | |
| to_team_id | text | |
| assets_from | jsonb | |
| assets_to | jsonb | |
| from_value | int | |
| to_value | int | |
| grade_label | text | |
| status | text | |
| parent_offer_id | uuid | |
| thread_id | uuid | |
| created_at | timestamptz | |

### `trade_messages`
Chat messages within trade threads.

---

## Feature Naming Conventions (LOCKED)

The three main sections were renamed this session. Use these names everywhere:

| Old Name | New Name | Route |
|----------|----------|-------|
| Draft War Room | **War Room** | `/draft` |
| Team HQ | **Owner's Box** | `/team-hq` |
| Trade Center | **GM Office** | `/trades` |
| League Historian | **League Historian** | `/historian` |

The homepage cards show these names. The tabs inside Owner's Box are: Strategy, Depth Chart, Trade Chart.

---

## Owner's Box — Strategy Tab Details

Three sections on the Strategy tab:

**1. Team Needs** (position stance)
- 5 position buckets: QB, RB, WR, TE, Picks
- Each has Low / Med / High toggle
- Previously was Buy/Hold/Sell — renamed and simplified this session
- Saves to `team_strategy_profile` table via `/api/team-hq/strategy`

**2. Priority Targets** (asset priority)
- 4 options: Picks (Draft capital), Studs (Elite producers), Youth (Young upside), Depth (Roster depth)
- Multi-select
- Saves to `wants_more` field in strategy profile

**3. Taking Calls** (player availability)
- Player-level attachment — one setting per player on your roster
- 4 options: Untouchable, Core Piece, Listening, Moveable
- Pulls real Sleeper roster via `useMyRoster` hook
- Saves per-player to `cfc_team_player_attachment` via `/api/team-hq/attachment`
- Summary pills at top showing count of each category

---

## Owner's Box — Trade Chart Tab Details

**What it does:** Shows each owned player with:
- CFC Value (base league value from `cfc_trade_values_current`)
- Your Value (team-adjusted, computed from strategy profile + manual overrides)
- Premium/Discount (delta between CFC and Your Value)
- Pick Ask (how many 1st/2nd/3rd round picks you'd want for this player)

**How pick values work:**
- Pick anchors: 1st = 3,000, 2nd = 1,000, 3rd = 350
- On load, pick counts are auto-populated by decomposing the player's final_value into picks
- User adjusts via +/− steppers per round
- Every adjustment auto-saves immediately (no Save button)
- Saved value is recomposed from picks: `(1sts × 3000) + (2nds × 1000) + (3rds × 350)`
- These team-specific values drive the trade matching in GM Office

**UI pattern:** Clean table with accordion expand. Click any row → dark inline panel drops down (same height as row) showing 1sts/2nds/3rds each with +/− buttons. Chevron arrow always black.

---

## GM Office (Trade Center) — Next Work Item

**Backend is fully built.** The UI needs a redesign.

Key tables: `trade_threads`, `trade_offers`, `trade_messages`

**Thread statuses:** open, closed, withdrawn, declined

**The trade value chain** (important context):
1. CFC base value (from `cfc_trade_values_current`) — league standard
2. Auto-adjusted for team profile (strategy preferences applied by the system)
3. Manually overridden via pick equivalents in Trade Chart tab
4. These team-specific values drive the GM Office — when you propose a trade, the system knows what each team values each player at

**Before starting GM Office work**, ask the user:
- What does the current UI look like? (ask them to paste the relevant component files)
- What specific problems do they want to solve with the redesign?
- What do they want to feel when using the GM Office?

---

## Working Style — Very Important

**The user's workflow is always:**
1. **Ideation** — talk through the concept, get alignment on direction
2. **Mockup** — generate a downloadable HTML file the user opens at full desktop width
3. **Iterate mockup** — usually 3-6 rounds of refinement
4. **Code** — only after mockup is approved

**Never skip to code.** Even if the change seems obvious.

**Mockup rules:**
- Always generate as a downloadable `.html` file
- Use the real fonts (Google Fonts CDN)
- Use the real colors from the design system
- Make it interactive when possible (JavaScript for toggles, accordions, etc.)
- Always use `overflow: hidden` on body so it fits the screen without scrolling

**The user's feedback style:**
- Direct and impatient when the same mistake is made twice
- Prefers one file = one paste (full file replacement, not diffs)
- Hates excessive explanatory text or verbosity
- Wants things to "feel like a front office tool" not a website
- Default toward MORE black, LESS color
- Text should always be larger than you think — they have pushed back on small text every single time
- Spacing should always be more generous than you think

**Code delivery rules:**
- Always output full files as downloadable `.md` files the user can open and copy
- When making surgical edits, specify the EXACT block to delete and what to replace it with
- Never make multiple changes across multiple files without confirming with the user first
- Always include `npm run lint` and `npm run build clean` instruction at end of agent prompts

**Navigation rule (CRITICAL):**
All navigation uses `window.location.href` — NOT `router.push()`. This forces a full page mount and prevents stale React state bugs. Never use `router.push()` for door navigation.

---

## Known Issues / Remaining Work

### Before Real Draft (if not done)
- Change `INITIAL_PICK_SECONDS` from `30` back to `1800` in `src/lib/draftState.ts`

### Active Bugs (minor)
- React hydration error #418 in draft room — non-blocking, caused by `Date.now()` in render
- Draft board occasionally takes up to 3 seconds to update after a pick on other clients (polling catches it)
- Assistant GM recommendation sometimes times out on first load

### Pending Features
- **GM Office redesign** — next up
- **Depth Chart** — wire to real Sleeper roster data (not urgent)
- **Season record on homepage** — pull from Sleeper historical data
- **Pre-draft countdown** on clock bar before draft starts
- **Mobile GM Office** layout

---

## League Context

- **League name:** Cleveland Football Club (CFC)
- **Format:** 12-team dynasty fantasy football
- **Platform:** Sleeper
- **Years running:** 7 seasons
- **League ID:** `1328902558617473024`
- **Draft format:** 1-round async rookie draft, 12 picks, 30-minute windows
- **Roster format:** Superflex, no required TE starter, only 1 required RB

**The 12 teams:**
Fairmount Freaks, Virginia Founders, Mayfield Matzo Balls, Kentucky Kush, Buffalo Wingmen, Doylestown Destroyers, Windy City Crossfitters, Brunswick Buschmasters, Brokepark Browns, Boston Birdmen, Ridgeville Rawdoggers, Oregon Onslaught

---

## Important Lessons Learned

1. **`player_name` NOT `name`** — `rookie_prospects` table uses `player_name`. Using `name` causes 500 errors.
2. **`readStoredTeam()` must read cookie first** — sessionStorage is empty on fresh page load with new auth system. The cookie-first logic in `storedTeam.ts` is what makes all pages work.
3. **`window.location.href` for navigation** — `router.push()` causes stale React state and page bounce bugs across all pages.
4. **`INITIAL_PICK_SECONDS = 30`** — currently set for testing. Must change to 1800 before real draft.
5. **Draft board updates via polling** — Realtime subscription exists but the 3-second polling safety net is what reliably keeps all clients in sync.
6. **Old attachment values in DB** — `cfc_team_player_attachment` has old values from onboarding. The API route maps them on read. Do not write old values.
7. **Agent scope creep** — Multiple agents have made changes beyond their stated scope. Always tell agents: "Do not change anything else."
8. **Trade values are real numbers** — Never pass normalized 0-100 scores to the LLM. Always use real trade values from `cfc_trade_values_current`.
