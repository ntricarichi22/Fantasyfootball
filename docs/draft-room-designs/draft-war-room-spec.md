# CFC Draft War Room — Complete Design Specification

> **Purpose:** This document is the definitive design spec for the CFC Draft War Room screen. Hand this to a coding agent along with the reference screenshots in `docs/draft-room-designs/`. Every design decision has been finalized. Do not deviate from this spec without explicit approval.

---

## Table of Contents

1. [Overview](#overview)
2. [Visual Hierarchy](#visual-hierarchy)
3. [Design System Reference](#design-system-reference)
4. [Desktop Layout](#desktop-layout)
5. [Clock Bar](#clock-bar)
6. [Draft Board (Table)](#draft-board-table)
7. [Player Card Modal (Scouting Card)](#player-card-modal)
8. [Roster Panel](#roster-panel)
9. [Assistant GM Panel](#assistant-gm-panel)
10. [Draft Ticker](#draft-ticker)
11. [Trade Integration](#trade-integration)
12. [Global Draft Mode](#global-draft-mode)
13. [Mobile Layout](#mobile-layout)
14. [Data Sources & Logic](#data-sources--logic)
15. [Existing Code & Refactoring](#existing-code--refactoring)

---

## Overview

The Draft War Room is the screen owners use during the CFC's annual rookie draft. The draft is **asynchronous** with a **30-minute pick clock** — owners pop in when it's their turn, make a pick, and leave. The draft can take days. Every design decision optimizes for this async flow: orient the user instantly, surface what changed while they were away, and make it easy to act quickly.

The draft is a **12-pick rookie draft** (one round, 12 teams). The player pool consists of incoming NFL rookies.

---

## Visual Hierarchy

The war room has **three distinct visual layers**:

| Layer | Elements | Background | Role |
|-------|----------|------------|------|
| **Frame** | Clock bar (top), Draft ticker (bottom) | `#1A1A1A` (Ink) | Structural chrome, persistent info |
| **Side panels** | Roster panel (left), Assistant GM (right) | `#FEFCF9` (Card) | Reference tools |
| **Playing field** | Draft board table (center) | `#F5F0E6` (Canvas) | The main event, where the action happens |

This creates clear spatial separation: dark ceiling/floor, white side panels, warm cream center.

---

## Design System Reference

All UI must follow `DESIGN_SYSTEM.md` at the repo root. Key values:

### Colors
- **Blue:** `#3366CC` (RB position color)
- **Red:** `#E8503A` (QB position color)
- **Yellow:** `#F5C230` (WR/TE/Pass Catcher position color)
- **Ink:** `#1A1A1A` (borders, dark backgrounds)
- **Canvas:** `#F5F0E6` (board background)
- **Card:** `#FEFCF9` (card/panel backgrounds)

### Typography
- **Syne** — headlines, player names, labels, buttons (font-weight: 700-800)
- **DM Sans** — body text, descriptions, chat messages (font-weight: 400-500)
- **JetBrains Mono** — stats, numbers, rankings, countdowns, chips (font-weight: 400-700)

### Borders & Shadows
- 2-2.5px solid `#1A1A1A` borders
- Solid offset shadows (e.g., `3px 3px 0 #1A1A1A`), never blurred
- No gradients, no pill shapes, no rounded corners

---

## Desktop Layout

```
┌─────────────────────────────────────────────────────────────────┐
│  CLOCK BAR (dark, 42-58px tall)                         [ACTION]│
├────────────┬──────────────────────────────────┬─────────────────┤
│            │                                  │ ▌ ASSISTANT GM  │
│  MY ROSTER │     DRAFT BOARD TABLE            │ ▌               │
│  (slide-in │     (cream background)           │ ▌ Briefing      │
│   from     │                                  │ ▌ Reco card     │
│   left)    │     [Filter chips]               │ ▌ Chat          │
│            │     [Table rows]                 │ ▌               │
│  ~150px    │                                  │ ▌ ~160px        │
├────────────┴──────────────────────────────────┴─────────────────┤
│  DRAFT TICKER (dark, 34-38px tall, scrolling)                   │
└─────────────────────────────────────────────────────────────────┘
```

- **Roster panel:** ~150px wide, slides in from the left. Toggled via persistent tab on left edge. When opened, the board resizes (does NOT get covered). When closed, the board expands.
- **Assistant GM panel:** ~160px wide, always visible on desktop. Fixed on the right.
- **Draft board:** fills remaining center space. Cream background.

---

## Clock Bar

### Structure
One horizontal bar segmented by **vertical dividers** (2px solid `#333` on dark, `rgba(255,255,255,0.2)` on red). All segments are equal-height cells within the bar.

**Segments (left to right):**
1. **Franchise name** — Syne 800, uppercase. With "On the clock" or "Your pick" chip in JetBrains Mono
2. **Rd** — label on top (JetBrains Mono, 7-9px, muted), large number below (JetBrains Mono 700, 16-22px)
3. **Pk** — same format as Rd
4. **Timer** — "Time" label on top, countdown in `MM:SS` format (JetBrains Mono 700, 18-26px). **Extra horizontal padding** — the timer gets more space than Rd/Pk to emphasize it. Pull Rd/Pk closer to franchise name to create this space.
5. **Action button** — always `#F5C230` (yellow) background, Syne 700 uppercase text in `#1A1A1A`

### Three States

| State | Background | Chip text | Timer color | Action text |
|-------|-----------|-----------|-------------|-------------|
| Your pick, in draft room | `#E8503A` (red) | "Your pick" (white border) | `#fff` | "Shop this pick" |
| Not your pick, in draft room | `#1A1A1A` (dark) | "On the clock" (`#F5C230` border) | `#F5C230` | "Trade up" |
| Any other page, draft active | `#1A1A1A` (dark) | "On the clock" (`#F5C230` border) | `#F5C230` | "Back to draft" |

### Behavior
- The action button navigates: "Shop this pick" and "Trade up" go to the Trade Center with context pre-loaded. "Back to draft" returns to the draft room.
- When it's your pick, the entire bar turns red — this is the primary "you need to act" signal.

---

## Draft Board (Table)

### Filter Chips
Row of filter chips at the top of the board area, above the table.

**Chips:** All (default active), QB, RB, Pass Catchers, Rookie, Vet

**Chip styling:**
- Syne 700, 8px, uppercase
- Default: `#FEFCF9` background, `#1A1A1A` border
- Active "All": `#1A1A1A` background, `#FEFCF9` text
- Active "QB": `#E8503A` background, white text
- Active "RB": `#3366CC` background, white text
- Active "Pass Catchers": `#F5C230` background, `#1A1A1A` text

### Table Columns

| Column | Content | Width | Alignment |
|--------|---------|-------|-----------|
| # | Rank number (JetBrains Mono 600, 9px, `#999`) | ~20px | Left |
| Pos | Position badge (see below) | ~30px | Left |
| Player | Player name (Syne 700, 10px, `#1A1A1A`) | Flex | Left |
| School / Team | School if rookie, NFL team if vet (DM Sans, 9px, `#777`) | Auto | Left |
| Type | Rookie/Vet chip (see below) | ~40px | Center |
| Value | Value progress bar with "V" label | ~70px | Center |
| Fit | Fit progress bar with "F" label | ~70px | Center |

### Position Badge
- Small rectangle, JetBrains Mono 700, 7px, white text, 1px `#1A1A1A` border
- QB: `#E8503A` background
- RB: `#3366CC` background
- WR: `#F5C230` background, `#1A1A1A` text
- TE: `#F5C230` background, `#1A1A1A` text

### Rookie/Vet Chip
- JetBrains Mono 600, 7px, uppercase, 1px `#1A1A1A` border
- Rookie ("RK"): `#F5C230` background, `#1A1A1A` text
- Vet: `#E8503A` background, white text

### Progress Bars
- Two bars per row: Value (blue `#3366CC` fill) and Fit (yellow `#F5C230` fill)
- Each bar has a small label to its left: "V" or "F" (DM Sans 600, 6px, `#1A1A1A`)
- Track: `#eee` background, 0.5px `#ccc` border, 5px tall
- **Value** = ADP/Sleeper ranking (universal, same for all owners)
- **Fit** = personalized to the logged-in owner's team needs (derived from team profile logic)

### Table Row Behavior
- Hover: background shifts to `#FEFCF9` (white)
- Click: triggers the player card modal animation (see next section)
- Rows for drafted players are **removed from the table entirely** (not grayed out)
- Default sort: by value/ADP ranking, all positions mixed
- Filter chips narrow the view (e.g., clicking "RB" shows only RBs)

---

## Player Card Modal (Scouting Card)

### Animation: Row Lift + Flip
When a user clicks a table row:
1. The row visually "lifts" off the table
2. It animates to the center of the screen while growing to full card size (~340px wide, ~480px tall)
3. Simultaneously, it **flips** (CSS 3D rotateY) to reveal the back of the scouting card
4. A dark overlay (`rgba(26,26,26,0.6)`) fades in behind the card
5. Click the overlay to dismiss (card shrinks, flips back, and fades out)

Use `transform-style: preserve-3d`, `backface-visibility: hidden`, and `cubic-bezier(0.4, 0, 0.2, 1)` easing. Total animation duration: ~0.65s.

### Card Front (visible during animation only)
The front face shows the same info as the table row — this face is only visible during the flip transition.

### Card Back (the scouting card) — 1980s Trading Card Aesthetic

**Left edge accent:** Red/yellow/blue vertical stripe (the "80s stripe" from the design system copilot styling). 5-6px wide, three equal sections.

**Header (dark):**
- Background: `#1A1A1A`
- Player avatar (square, 52-56px, `#3366CC` background with `#F5C230` border). Use Sleeper player images if available via API, silhouette placeholder if not.
- Player name: Syne 700, 17-18px, `#FEFCF9`
- Subtitle: DM Sans, 11-12px, `#999` — "RB · Boise State · Rookie" format

**Stat boxes (row of 3):**
- Age, Height, Weight
- Each in a bordered box (`#F5F0E6` background, 2px `#1A1A1A` border)
- Value: JetBrains Mono 700, 15-16px
- Label: DM Sans, 9-10px, uppercase, `#777`

**Three Letter Grade Rows:**
Each grade row is a horizontal block with:
- **Left cell (~52-60px):** The letter grade in large text (Syne 800, 24-28px), centered
  - A+ background: `#d4f5d4`, text: `#1a7a2e`
  - A background: `#d0e0f7`, text: `#3366CC`
  - B+ background: `#F5C230`, text: `#8a6d00`
  - B and below: follow same pattern with progressively muted colors
- **Vertical divider:** 2px solid `#1A1A1A` (the border-right of the grade cell)
- **Right cell (flex):** Grade title (Syne 700, 10-11px, uppercase) + info text (DM Sans, 11-12px, `#444`)

**Grade 1 — Draft Capital:**
- Grading logic: Top 5 pick = A+, Top 10 = A, Rest of Round 1 = A-, Round 2 = B+, Round 3 = B, Round 4+ = C+, Undrafted = C
- Info text: "{NFL Team} · Round {X}, Pick {Y}"

**Grade 2 — Situation:**
- Derived from querying `cfc_team_trade_values_current` for relevant teammates
- For WR/TE: look up the QB's trade value on that NFL team. High-value QB = A+ situation
- For RB: look up offensive context
- Info text: brief description + "QB: {Name} ({tier})"

**Grade 3 — Opportunity:**
- Derived from querying `cfc_team_trade_values_current` for same-position players on that NFL team
- No high-value player at position = A+, established starter = lower grade
- Info text: depth chart context

**Draft This Player Button:**
- Only visible when it is the logged-in user's turn to pick
- Full-width, `#E8503A` background, white text
- Syne 700, uppercase, 2.5px `#1A1A1A` border, `3px 3px 0 #1A1A1A` shadow
- Hover: shadow reduces, button translates to simulate press

### Pre-computation
All three letter grades are computed from database queries on page load — **no API calls on click**. For a 12-pick rookie draft, pre-compute for the top 20 prospects. Cards open instantly.

---

## Roster Panel

### Toggle Behavior
- **Trigger:** Persistent tab on the left edge of the screen
- **Animation:** Slides in from the left; the draft board table resizes (shrinks) to accommodate. Does NOT overlay the board.
- **Close:** Click the tab again or the ✕ in the panel header. Board resizes back.

### Panel Header
- Background: `#F5F0E6` (Canvas) — NOT black (only the clock bar is black)
- "My Roster" in Syne 700, uppercase
- ✕ close button on the right

### Card 1: Team Needs (top)
- Bordered card with `#F5F0E6` header, white body
- Shows position need bars (one per position: RB, WR, QB)
- Each row: position badge (colored) + progress bar (red `#E8503A` fill) + need label ("Critical", "Moderate", "Low")
- Data source: `buildLeagueProfiles` / `computeCoreTeamStrength`

### Card 2: Lineup (bottom, independently scrollable)
- Traditional fantasy lineup format
- Starters stacked by position slot: QB1, RB1, RB2, WR1, WR2, WR3, TE1, FLX (or whatever the league's starting lineup requirements are)
- Each row: slot label (JetBrains Mono 600, muted) + player name (DM Sans 500)
- Empty slots shown in red italic ("— empty")
- **Bench** divider below starters
- Bench players listed below
- This card scrolls independently if the roster is long

---

## Assistant GM Panel

### Always Visible on Desktop
Fixed panel on the right side, ~160px wide. This is the AI-powered draft companion.

### Panel Header
- Background: `#F5F0E6` (Canvas) — matches roster panel header, NOT black
- "Assistant GM" in Syne 800, uppercase, `#1A1A1A`
- Status indicator: green dot + "Live" in JetBrains Mono

### Left Edge Accent
Red/yellow/blue vertical stripe (3-4px wide) running the full height of the panel. Three equal sections:
- Top: `#E8503A`
- Middle: `#F5C230`
- Bottom: `#3366CC`

### Auto-Triggered Briefing Card
When the user loads the draft room, the Assistant GM **automatically generates** a briefing card (no button click required). This card summarizes what happened since the user was last active.

**Briefing card structure:**
- Dark header (`#1A1A1A`): "///" icon in `#F5C230` + "Draft Briefing" label in Syne 700
- **Section 1 — "Since you left":** List of picks that happened, each showing: pick number (JetBrains Mono, muted), position badge (colored), player name (DM Sans 500), team ("→ {Team}")
- **Section 2 — "Trends":** AI-generated trend alerts, e.g., "RB run: 2 of 4 picks were RBs. Johnson & Skattebo still available." Highlight keywords in red bold.

If the user returns later in the draft, they can re-trigger the briefing. The briefing updates on each visit.

### Recommendation Card
Below the briefing, a recommendation card appears when it's contextually relevant (especially when the user's pick is approaching or active).

**Structure:**
- Yellow left accent bar (3-4px, `#F5C230`)
- Header: "My Recommendation" (Syne 700) + confidence percentage (JetBrains Mono, `#888`)
- Player name: Syne 800, 12px
- Meta: DM Sans, 7-8px, `#777` — "RB · Iowa · Rookie · 21"
- Rationale: DM Sans, 7-8px, `#444` — one-line reason
- **"Draft This Player" button:** red (`#E8503A`), full width, Syne 700 uppercase, with neobrutalist border/shadow

### Chat Interface
Below the cards, standard chat:
- **User messages:** Right-aligned, `#3366CC` background, white text
- **AI messages:** Left-aligned, `#F5F0E6` background, `#1A1A1A` text
- Both: DM Sans, 7-8px, 1px `#1A1A1A` border

### Chat Input
- Bottom of panel, `#FEFCF9` input field, `#F5C230` send button (square, `#1A1A1A` border)
- Placeholder: "Ask the Assistant GM..."

### AI Capabilities
The Assistant GM can leverage:
- `buildLeagueProfiles` from `src/lib/trade/profile.ts`
- `computeCoreTeamStrength` from `src/lib/trade/starterLevel.ts`
- `cfc_team_strategy_profiles` table
- `cfc_team_trade_values_current` table
- The AI trade generator's compatibility/matching logic
- Anthropic API with web search tool enabled for current news

---

## Draft Ticker

### Position
Fixed at the bottom of the screen. Replaces the site-wide blue ticker during active drafts.

### Styling
- Background: `#1A1A1A`
- Height: 34-38px
- Auto-scrolls left as picks are made
- Entries separated by `1px solid #333` vertical borders

### Each Entry
- **Pick badge:** Yellow (`#F5C230`) square, pick number in JetBrains Mono 700, `#1A1A1A` text
- **Player name:** Syne 700, 8-9px, `#FEFCF9`
- **Position chip:** Filled, JetBrains Mono 700, 5-7px (QB = red, RB = blue, WR/TE = yellow)
- **Team name:** DM Sans, 6-7px, `#888`

Player name and position chip on the top line, team name below. Two-line stacked layout per entry.

### Newest picks appear on the right, scroll left over time.

---

## Trade Integration

**No trade center is embedded in the draft room.** The existing Trade Center is a separate, fully-built feature. The draft room connects to it via the clock bar's yellow action button.

### Flow
1. **"Shop this pick"** (your turn) — navigates to Trade Center. Your current draft pick is automatically placed on the trade block. AI trade generator produces hypothetical offers from other teams.
2. **"Trade up"** (not your turn) — navigates to Trade Center. AI generates what it would cost to move up, which assets could work, which teams might deal.
3. The Trade Center page displays the global clock bar at the top (with "Back to draft" action), so the user never loses draft awareness.

### Assistant GM can suggest trades in chat
The Assistant GM may suggest trade ideas conversationally. These are informational — the actual trade execution happens in the Trade Center.

---

## Global Draft Mode

When a draft is active, **two elements become global across the entire app:**

1. **Clock bar** — pinned under the top nav on every page. Shows who's on the clock, Rd, Pk, timer, and the contextual action button ("Back to draft" when not on the draft room page).
2. **Draft ticker** — replaces the site-wide blue ticker at the bottom on every page.

When no draft is active, both elements disappear and the normal layout returns.

---

## Mobile Layout

### Structure (top to bottom)
1. **Clock bar** — compressed version. Shows abbreviated team name, Rd, Pk, timer, yellow action button. Same three states as desktop.
2. **Tab bar** — three tabs: **Board** | **Roster** | **Asst GM**. Syne 700, 7px, uppercase. Active tab gets `#F5C230` bottom border and darker text. Tabs sit just below the clock bar.
3. **Content area** — fills remaining vertical space. Shows whichever tab is selected (full-screen for each).
4. **Draft ticker** — fixed at bottom, same as desktop but smaller (26px height).

### Board Tab (default)
- Filter chips at top (horizontally scrollable if needed)
- Slimmed table with three columns only: **Pos** (badge), **Player** (name), **Val/Fit** (stacked bars)
- Rank, school, and rookie/vet chip are omitted (moved to the modal)
- Tap a row → scouting card modal (works great at phone width natively)

### Roster Tab
- Full-screen version of the two stacked cards
- Team needs card on top
- Lineup card below with full player names (more room than desktop sidebar)
- Scrollable

### Assistant GM Tab
- Full-screen chat experience
- Red/yellow/blue stripe on left edge
- Briefing card, recommendation card, chat — identical content to desktop, just full width
- Chat input at bottom

---

## Data Sources & Logic

### Draft Board Rankings
- Source: Sleeper API rankings or ADP (whatever currently powers the board)
- Used for: table sort order and the "Value" progress bar

### Fit Score
- Source: `buildLeagueProfiles` + `computeCoreTeamStrength` from existing codebase
- Personalized per logged-in owner
- Used for: the "Fit" progress bar on each table row

### Letter Grades (pre-computed on page load for top 20 rookies)

**Draft Capital:**
- Pure logic mapping from NFL draft position to letter grade
- No database query needed

**Situation:**
- Query `cfc_team_trade_values_current` for relevant teammates on the rookie's NFL team
- WR/TE: look up QB trade value → map to grade
- RB: look up OL quality or team rushing context if available

**Opportunity:**
- Query `cfc_team_trade_values_current` for same-position players on the rookie's NFL team
- High-value incumbent = low opportunity grade
- No incumbent = high opportunity grade

### Team Needs
- Source: `buildLeagueProfiles` / `computeCoreTeamStrength`
- Displayed in roster panel top card

### Assistant GM Briefing
- "Since you left": query recent draft picks from Supabase
- "Trends": AI-generated analysis of pick patterns
- "Recommendation": combines fit scores, value, and team needs

### Live Draft State
- Synced via **Supabase Realtime** (already working in existing codebase)
- Pick clock countdown
- Draft pick submission

---

## Existing Code & Refactoring

The current draft room exists as a **monolithic component (~80KB single file)**. It needs to be:
1. Broken into discrete components matching this spec
2. Restyled to match the design system and this spec exactly
3. Existing functionality preserved: Supabase realtime sync, pick clock, draft pick submission, basic player board

### Key files to reference
- `DESIGN_SYSTEM.md` (repo root) — the design bible
- `src/lib/llm/schema-context.ts` — documents all database tables
- `src/lib/trade/profile.ts` — team strength/weakness profiles
- `src/lib/trade/starterLevel.ts` — roster quality scoring

---

## Reference Screenshots

Save screenshots from the design session to `docs/draft-room-designs/`:
1. `desktop-full-war-room.png` — the final desktop layout with all panels open
2. `mobile-board-tab.png` — mobile board tab view
3. `mobile-roster-tab.png` — mobile roster tab view
4. `mobile-assistant-gm-tab.png` — mobile Assistant GM tab view
5. `player-card-flip.png` — the scouting card modal (back of card)
6. `player-card-board-row.png` — compact board-level card/row
7. `clock-bar-states.png` — all three clock bar states
8. `ticker-format.png` — draft ticker entry format
9. `assistant-gm-panel.png` — full Assistant GM panel with briefing, reco, and chat
