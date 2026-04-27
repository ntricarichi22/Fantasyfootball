# CFC Front Office — Handoff Document v3

**Last Updated:** April 25, 2026 (post-draft day)

---

## Project Overview

CFC Front Office is a bespoke dynasty fantasy football web app for a 12-team Sleeper league. It provides team owners with a premium, club-like experience for managing rosters, making trades, running the rookie draft, and analyzing their dynasty assets.

**Live URL:** https://fantasyfootball-six.vercel.app

---

## Tech Stack

- **Framework:** Next.js 16 (App Router), React 19, TypeScript
- **Styling:** Tailwind 4 + inline styles (neobrutalist design system)
- **Database:** Supabase (PostgreSQL + Realtime subscriptions)
- **Hosting:** Vercel
- **Data Source:** Sleeper API (rosters, players, draft picks, traded picks)
- **Auth:** Supabase Auth (email/password)

---

## Design System

Neobrutalist aesthetic throughout:
- 2.5px solid borders (#1A1A1A)
- Offset box shadows (3-4px)
- No gradients, no rounded corners (border-radius: 0)
- Color palette: Ink (#1A1A1A), Paper (#FEFCF9), Cream (#F5F0E6), Blue (#3366CC), Red (#E8503A), Yellow (#F5C230), Muted (#8C7E6A)
- Fonts: Syne (headlines, 800-900 weight), DM Sans (body, 400-800), JetBrains Mono (data/labels)

---

## Developer Workflow

1. **Ideate** → discuss the feature and layout
2. **Mockup** → interactive HTML mockup for approval
3. **Iterate** → refine based on feedback
4. **Code** → implement in the actual codebase

File delivery preferences:
- Full file replacement for files under ~500 lines
- Targeted find/replace blocks for larger files
- All navigation uses `window.location.href` (not `router.push`) except where `router.push` is explicitly used (e.g., ClockBar)
- Components use inline styles matching the neobrutalist system

---

## App Structure

### Routes

| Route | File | Purpose |
|-------|------|---------|
| `/` | `src/app/page.tsx` | Root — renders HomeScreen or Draft Room based on state |
| `/draft` | `src/app/(app)/draft/page.tsx` | 5-line wrapper importing root page |
| `/trade-builder` | `src/app/(app)/trade-builder/page.tsx` | Trade builder (slim Suspense wrapper) |
| `/trades` | `src/app/(app)/trades/page.tsx` | Trade inbox |
| `/trades/[id]` | `src/app/(app)/trades/[id]/page.tsx` | Trade thread detail |
| `/trade-studio` | `src/app/(app)/trade-studio/page.tsx` | AI trade generator |
| `/onboarding` | `src/app/(app)/onboarding/page.tsx` | 4-screen onboarding flow |
| `/login` | `src/app/(app)/login/page.tsx` | Login page |
| `/signup` | `src/app/(app)/signup/page.tsx` | Signup page |

### Key Components

**Onboarding (src/components/onboarding/)**
- `OnboardingWelcome.tsx` — Envelope tear animation with membership card
- `OnboardingAttachment.tsx` — Player attachment survey (untouchable/core_piece/listening/moveable)
- `OnboardingWantsMore.tsx` — Trade preferences (Topps-style cards, 2×2 grid)
- `OnboardingPosture.tsx` — Team needs by position (sliding bars, Low/Med/High)

**Draft Room (src/components/draft/)**
- `RosterPanel.tsx` — Collapsible roster drawer with vertical toggle handle (18px)
- `RosterDisplay.tsx` — Full roster display with lineup/bench/picks
- `DraftControls.tsx` — Start/Pause/Resume buttons
- `DraftCountdownModal.tsx` — Pre-draft countdown overlay with auto-start
- `LineupCard.tsx` — Compact lineup view inside RosterPanel
- `TeamNeedsCard.tsx` — Team needs display inside RosterPanel

**Trade Builder (src/components/trade-builder/)**
- `TradeBuilderView.tsx` — Main component: all hooks, state, data fetching, three-panel layout
- `TradeDrawerPanel.tsx` — Collapsible roster drawer (light/dark variants) with player/pick rows
- `TradeHandle.tsx` — Vertical toggle handle (18px, blue for "My Team", red for "Their Team")

**Shared**
- `ClockBar.tsx` — Global draft status bar (pre-draft countdown, on-the-clock, pick-is-in, reveal animation)
- `HomeScreen.tsx` — Homepage with 2×2 mobile / 4-col desktop grid
- `TradeCenterTabs.tsx` — Tab navigation for trade section
- `DraftStatusProvider.tsx` — Context provider for draft state polling

### Key Libraries

**Draft State (src/lib/)**
- `draftState.ts` — Types, constants (INITIAL_PICK_SECONDS = 1800, TOTAL_DRAFT_PICKS = 12)
- `draftAutoAdvance.ts` — processAutoAdvance: announce picks, auto-skip, advance clock, draft completion
- `picks.ts` — Draft pick utilities: labels, values, traded pick computation, draft order derivation

**Trade (src/lib/trade/)**
- `value.ts` — getPickValue, getPlayerValue
- `profile.ts` — Team strategy profiles
- `starterLevel.ts` — Starter asset classification

### API Routes

| Route | Method | Purpose |
|-------|--------|---------|
| `/api/draft-state` | GET | Read current draft state (pure, no mutations) |
| `/api/draft-state` | POST | Actions: start, pause, resume, advance, submit_pick, announce |
| `/api/draft-tick` | GET/POST | Heartbeat: auto-start, auto-announce, auto-skip, auto-advance |
| `/api/draft/submit-pick` | POST | Submit a draft pick |
| `/api/draft/rookie-prospects` | GET | Rookie prospect data (college map) |
| `/api/player-values` | GET | CFC player dynasty values |
| `/api/trades/create` | POST | Create trade offer |
| `/api/trades/list` | GET | List trade offers |
| `/api/trades/threads/[id]` | GET | Trade thread detail |
| `/api/onboarding/player-attachment` | POST | Save player attachment values |
| `/api/onboarding/complete` | POST | Mark onboarding complete, flip cookie |
| `/api/auth/finalize` | POST | Set profile_complete cookie on login |
| `/api/active-teams` | GET | Currently active teams |

---

## Database (Supabase)

### Key Tables

**draft_state** — Single row per league controlling draft clock
- `league_id` (PK), `status` (not_started/running/paused/completed), `seconds_remaining`, `clock_started_at`, `pick_submitted`, `pick_announced_at`, `current_pick_index`, `starts_at`

**draft_log** — One row per draft pick
- `pick_index`, `player_id`, `player_name`, `team_name`, `positions`, `roster_id`, `is_announced`, `is_skip`, `league_id`

**team_email_map** — Maps emails to teams
- `id`, `email`, `team_name`, `roster_id`, `profile_complete`, `created_at`, `updated_at`

### Useful SQL Commands

```sql
-- Reset draft for a new session
UPDATE draft_state
SET status = 'not_started',
    seconds_remaining = 1800,
    clock_started_at = null,
    pick_submitted = false,
    pick_announced_at = null,
    current_pick_index = 0,
    starts_at = '2026-04-25T16:00:00Z'
WHERE league_id = '1328902558617473024';

DELETE FROM draft_log WHERE pick_index >= 0;

-- Check most recent pick (even before announced)
SELECT pick_index, player_name, team_name, is_announced, is_skip
FROM draft_log ORDER BY pick_index DESC LIMIT 1;

-- Reset all profiles for fresh onboarding
UPDATE team_email_map SET profile_complete = false;

-- Delete all auth users (forces password re-creation)
-- Must be done in Supabase Dashboard → Authentication → Users → Delete
```

---

## Completed Work (April 2026 Sessions)

### Onboarding Flow (4 Screens)
1. **Welcome** — Dark background, animated envelope tears open to reveal membership card with team name, "Member since 2019", "Tap to activate" CTA. CFC logo on envelope via `<image href="/cfc-logo.png">`.
2. **Player Attachment** — "If someone called — who's available?" Position-by-position flow (QBs → RBs → Pass Catchers). 2×2 grid tap targets per player. Values: untouchable, core_piece, listening, moveable. Red = selected.
3. **Wants More** — "If a trade landed on your desk — what do you want back?" Topps-style cards in 2×2 grid, corner icons (1st, ★, ↑, ≡), "Elite Producers" labels at 12px. `100dvh` no scroll. Select all that apply.
4. **Team Needs** — "Where are the holes on your roster?" Black-fill sliding bars for Low/Med/High. 4 rows (QB/RB/WR/TE). Position labels with colored underlines. `100dvh` no scroll. CTA: "Enter the Club →". Saves strategy profile, marks complete, flips cookie.

### Auth/Middleware
- `middleware.ts` checks `cfc_profile_complete` cookie, redirects to `/onboarding` if `false`
- `/api/auth/finalize` sets cookie on login based on `profile_complete` field
- `/api/onboarding/complete` flips cookie to `true`

### Homepage
- Responsive: 2-column mobile, 4-column desktop via CSS media query
- Card names: War Room, GM Office, Owner's Box, Historian
- Dynamic draft subtext with 2026 date
- Accent dots replace old card numbers

### Draft Room — Mobile
- `useIsMobile` returns `null` initially (not `false`) to prevent desktop layout flash
- Page.tsx guards with blank dark screen while determining device

### Draft Room — Clock & Auto-Start
- `DraftCountdownModal.tsx` — CFC logo, big countdown, "Saturday · Apr 25 · Noon ET", auto-starts at zero
- `/api/draft-tick` — Auto-start: if `not_started` and `starts_at` has passed, kicks off draft server-side
- Draft configured: `starts_at = '2026-04-25T16:00:00Z'`, `INITIAL_PICK_SECONDS = 1800`

### Draft Room — Auto-Completion
- `draftState.ts` added `"completed"` status, `TOTAL_DRAFT_PICKS = 12`
- `draftAutoAdvance.ts` checks `nextIndex >= TOTAL_DRAFT_PICKS`, sets status to `"completed"`

### Draft Room — Pick Announcement Timing
- Picks announce on :00/:30 wall-clock boundaries (not relative to submission time)
- `submit_pick` action calculates: `Math.ceil(Date.now() / (30*60*1000)) * (30*60*1000)`
- Submit at 12:22 → announces at 12:30. Submit at 12:31 → announces at 1:00.

### Draft Room — Reveal Animation
- 3-phase animation on ClockBar when `is_announced` flips true
- Phase 1: "THE PICK IS IN" slides down (0.85s)
- Phase 2: Chime plays (gated by mute toggle)
- Phase 3: Player name/position/school flies in from above with bounce (0.9s)
- Hold for 8s, then revert to normal clock bar

### Draft Room — Controls
- Start/Pause/Resume visible to all users (removed commissioner-only gate)
- Mute toggle for draft chime in top-right corner

### ClockBar → Trade Builder Integration
- "Trade up" / "Shop this pick" buttons in ClockBar
- Buttons hidden until `context?.onClockRosterId` loaded (prevents empty params)
- Passes query params: mode, action, pickOwner, pickRound, pickSlot, pickSeason, myTeam

### Trade Builder — Three-Panel Two-Tone Layout
- **Left:** Light drawer (your roster) + blue "My Team" vertical handle (18px)
- **Center:** Two-tone deal card — light "You Send" / dark "You Receive" with running value totals
- **Right:** Dark drawer (partner's roster) + red "Their Team" vertical handle (18px)
- Team header bar at top: light left (your name) / dark right (their name) / yellow "Trading With" badge centered
- Grade chip in topbar (Steal/Good Deal/Fair/Overpay/Big Overpay), updates live
- Big red "Send Trade Offer" button pinned at bottom
- "← Back to Draft" button alongside
- No page scroll — roster panels scroll individually
- Drawers collapse via handle click, center expands to fill
- Toggle add/remove: tap roster row to add, tap again to remove. ✕ in deal card also removes.
- Draft prefill: "Trade up" pre-selects partner team + their pick in "You Receive"
- Counter prefill: loads existing offer for counter-offer flow
- String comparison fix for pick matching (Sleeper stores as strings)
- `myTeam` query param fallback when sessionStorage is empty

### Component Refactoring
- Old monolith `trade-builder/page.tsx` (1200+ lines) split into:
  - `TradeHandle.tsx` (~50 lines)
  - `TradeDrawerPanel.tsx` (~250 lines)
  - `TradeBuilderView.tsx` (~500 lines)
  - `page.tsx` (~10 lines, slim Suspense wrapper)

---

## Backlog / Next Up

### 1. GM Office (Trade Center) — Full Redesign ⭐ NEXT
The main trade management hub. Currently basic. Needs:
- Trade inbox with offer cards
- Active/pending/completed trade views
- Integration with the new trade builder
- Mobile-responsive layout

### 2. Trade Builder — Mobile Layout
Current three-panel layout is desktop-only. Mobile needs:
- Stacked layout or tab-based drawer switching
- Touch-friendly asset toggle
- Condensed deal card

### 3. Owner's Box Enhancements
- Depth Chart tab — wire to real Sleeper roster data
- Season record display on homepage
- Strategy profile editing (post-onboarding)

### 4. Trade Studio Cleanup
- Check for redundancy with new trade builder
- May consolidate or remove

### 5. Historian Section
- Historical trade data
- Draft history
- League records

### 6. Infrastructure
- Vercel cron job for belt-and-suspenders draft auto-start
- Error monitoring / logging
- Performance optimization for Sleeper API calls (caching)

---

## League Configuration

- **League ID:** `1328902558617473024`
- **Teams:** 12
- **Draft:** 1-round rookie draft, slow draft format (30-min pick windows)
- **Pick announcement:** Snaps to :00/:30 wall-clock boundaries
- **Scoring:** Dynasty/SuperFlex (QB, 2×RB, 2×WR, TE, FLEX, SUPERFLEX)
- **Roster slots:** QB, RB, RB, WR, WR, TE, FLEX, SUPERFLEX + bench

---

## Key Files Quick Reference

| File | Purpose |
|------|---------|
| `src/app/page.tsx` | Root page (HomeScreen + Draft Room, ~650 lines) |
| `src/components/ClockBar.tsx` | Global draft bar (~600 lines) |
| `src/components/trade-builder/TradeBuilderView.tsx` | Trade builder main (~500 lines) |
| `src/lib/draftAutoAdvance.ts` | Draft advancement logic |
| `src/lib/draftState.ts` | Draft state types/constants |
| `src/lib/picks.ts` | Pick utilities |
| `src/app/api/draft-state/route.ts` | Draft state API |
| `src/app/api/draft-tick/route.ts` | Draft heartbeat API |
| `middleware.ts` | Auth/onboarding redirect |
