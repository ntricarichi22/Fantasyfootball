# CFC Front Office — Pro Personnel Design Spec

**Version:** 1.0
**Date:** May 8, 2026
**Status:** Design locked — ready for mockup → code

---

## Purpose of This Document

This document captures every design decision for the **Pro Personnel door** — the briefing room landing, the manual trade-building surface, and the manual shopping surface. It is the handoff spec for implementation. A new chat or developer should be able to read this document and execute the build without referring to prior conversation.

This document is **forward-looking**. It describes what Pro Personnel becomes, not what it currently is. The current implementation in `src/components/trade/LandingPage.tsx` and the surrounding "GM's Office" door are being replaced.

This spec must be read alongside:
- `/docs/CFC-APP-STATUS.md` (project-wide design system and non-negotiables)
- `CFC-HOME-SCREEN-SPEC.md` v2.0 (locked home screen — Pro Personnel is one of three director doors)
- `CFC-GM-OFFICE-SPEC.md` (locked GM Office — its Propose and Shop buttons route into Pro Personnel surfaces)

The Pro Personnel door is one of three directors reporting to the GM. Its lens is **looking outward** — other teams' rosters, trade activity, and who's a fit for our build.

---

## Section 1: Concept & Metaphor

The Pro Personnel door is the **director's briefing room**. The user walks in and the Director of Pro Personnel is already there, leaning on his desk, three folders fanned out:

> *"Boss, I've worked the phones. Here's what I've got."*

Three folders, three sections of the landing:

1. **The hero offer** — *"Of the five deals I've worked up, here's the one I'd start with."*
2. **Players we're tracking** — *"These are the guys around the league who fit our build."*
3. **Teams worth a call** — *"And these are the franchises worth a phone call."*

The user is the GM. The GM doesn't scout from scratch. The GM **reacts** to what the director has prepared — accept it, modify it, or take matters into their own hands.

The two manual entry points (trade machine, manual shop) live as escape hatches on this same page. The director did the work; if the GM wants to drive, they can.

---

## Section 2: Architecture & Routing

### Routes

| Route | Surface | Entry points |
|---|---|---|
| `/pro-personnel` | Briefing landing (this spec, primary surface) | Home screen Pro Personnel director box |
| `/trade-builder` | Trade machine (manual deal building) | GM Office "Propose" button **AND** the briefing landing's "Build a trade" header button **AND** tap on a player or team card from the briefing landing |
| `/trade-studio` | Manual Shop (existing Studio's roster-grid → generate-offers flow) | GM Office "Shop" button **AND** the briefing landing's "Shop my guys" header button |

### Mental model

Pro Personnel has **one screen**: the briefing landing. There is no internal navigation — no sidebar, no tabs, no sub-pages. Everything else is an outbound action that routes to a working surface (`/trade-builder` or `/trade-studio`). The user returns via the topbar's back affordance.

This is intentional and mirrors the pattern locked on the home screen: department doors house briefings; sidebars are reserved for the GM Office.

### What this replaces

The old "GM's Office" door (different from the new GM Office spec) housed `LandingPage.tsx` — a combined "top 10 player matches + ranked franchises + search" page that was the only way to start a manual trade. That door and that landing page are gone. The trade machine is now reachable directly from the GM Office's Propose button (no intermediate scouting page) or by tapping a recommendation card on the new Pro Personnel landing.

---

## Section 3: The Briefing Landing — Layout (Desktop, ≥768px)

```
┌──────────────────────────────────────────────────────────────────────┐
│  [Topbar: ← back · league logo · settings]                            │
│  [Title: "Pro Personnel"]            [+ Build a trade] [$ Shop guys]  │
├──────────────────────────────────────────────────────────────────────┤
│                                                                       │
│  ───── DIRECTOR'S PICK ────────────────────────────────────────       │
│                                                                       │
│  "Boss, of the five deals I've worked up, here's the one I'd start    │
│   with."                                                              │
│                                                                       │
│  ┌──────────────────────────────────────────────────────────────┐     │
│  │                                                                │     │
│  │   [Studio OfferCard — full carbon copy of existing component]  │     │
│  │   - Persona toggle, prev/next, 1/5 counter                     │     │
│  │   - Send/receive grid (dark blue panel)                        │     │
│  │   - AI advisor prose + balance chip                            │     │
│  │   - Pass / Edit / Make this offer                              │     │
│  │                                                                │     │
│  └──────────────────────────────────────────────────────────────┘     │
│                                                                       │
│  ───── PLAYERS WE'RE TRACKING ─────────────────────────────────       │
│                                                                       │
│  ┌──────┐  ┌──────┐  ┌──────┐  ┌──────┐  ┌──────┐  ┌──────⌐         │
│  │player│  │player│  │player│  │player│  │player│  │ peek →             │
│  │ card │  │ card │  │ card │  │ card │  │ card │                       │
│  └──────┘  └──────┘  └──────┘  └──────┘  └──────┘                       │
│  ← horizontal scroll, ~10 cards →                                     │
│                                                                       │
│  ───── TEAMS WORTH A CALL ─────────────────────────────────────       │
│                                                                       │
│  ┌────────┐  ┌────────┐  ┌────────┐  ┌────────⌐                      │
│  │ team   │  │ team   │  │ team   │  │ peek →                          │
│  │ card   │  │ card   │  │ card   │                                    │
│  └────────┘  └────────┘  └────────┘                                    │
│  ← horizontal scroll, ~11 cards →                                     │
│                                                                       │
└──────────────────────────────────────────────────────────────────────┘
```

- **Topbar** inherits from GM Office spec (back arrow / league logo / settings on desktop)
- **Header bar** below topbar carries the page title on the left and two persistent buttons on the right (`+ Build a trade`, `$ Shop my guys`)
- **Three sections** vertically stacked, separated by section dividers in the existing `SectionBar` style (black rectangle bookend + horizontal rule)
- **Section 1 (Director's Pick):** centered intro line in the director's voice (Syne 700, ~14px, Ink) followed by the full Studio OfferCard
- **Sections 2 & 3:** horizontal-scroll rails with subtle "peek" of the next card on the right edge as the scroll affordance (iOS App Store / Spotify pattern)
- **No vertical snap on desktop** — desktop scrolls naturally. Snap is mobile-only (Section 8).

---

## Section 4: Mobile Layout (<768px)

Mobile is a **snap-scrolling briefing**, not a free-scroll page. Each section is one full-viewport "panel." Vertical swipe locks to the next section. Horizontal swipe within a section cycles cards.

### Vertical structure

```
┌─────────────────────────────────┐
│  [topbar: hamburger / logo / ⚙] │  ← inherits GM Office mobile pattern
├─────────────────────────────────┤
│  [section title (dynamic)]       │  ← updates as user snaps between sections
├─────────────────────────────────┤
│                                  │
│                                  │
│                                  │
│      FULL-VIEWPORT CARD          │  ← horizontal-snap: cycles 1/N
│      (offer / player / team)     │
│                                  │
│                                  │
│                                  │
├─────────────────────────────────┤
│              ⌄                   │  ← pulsing chevron ("swipe up for next")
│          • • • • •               │  ← horizontal pagination dots (current section)
├─────────────────────────────────┤
│  [+ Build a trade]  [$ Shop]     │  ← bottom-pinned nav bar (always visible)
└─────────────────────────────────┘
```

### Snap behavior

- **Vertical snap:** `scroll-snap-type: y mandatory` on the outer scroll container. Each section is `scroll-snap-align: start`. Swiping past a threshold locks to the next section. No half-states — the user is always fully on one section.
- **Horizontal snap within each section:** the cards inside are arranged in a `scroll-snap-type: x mandatory` flex row, each card `scroll-snap-align: center`. Swiping locks to one card at a time.
- **Both axes are set on the outer container** via `scroll-snap-type: both mandatory` for the cleanest behavior. iOS Safari and modern Android handle this well; gesture direction is detected early and committed gracefully.

### The dynamic section title in the topbar

The topbar's center label updates as the user snaps between sections:

| Section | Topbar label |
|---|---|
| Section 1 (offers) | `Director's Pick` |
| Section 2 (players) | `Players We're Tracking` |
| Section 3 (teams) | `Teams Worth a Call` |

This replaces the league logo's center position **on Pro Personnel mobile only**. Other inner-page mobile topbars keep the league logo centered. This is a Pro Personnel-specific affordance because the directorial voice in the topbar reinforces the briefing metaphor.

The user is never lost — the topbar tells them what they're looking at.

### The bottom indicator cluster

A unified cluster sits ~12px above the bottom nav, centered, vertically stacked:

```
              ⌄
        • • • • •
```

- **Chevron:** SVG, ~14×14, Muted color (#8C7E6A), pulsing softly (1.5s ease-in-out, opacity 0.4 → 1.0). Indicates "swipe up for the next section." Disappears on Section 3 (the last section — its absence signals "you've reached the end").
- **Dots:** small filled squares (matching neobrutalist aesthetic — no rounded dots), Muted (#8C7E6A) for inactive, Ink (#1A1A1A) for active. JetBrains Mono adjacency. Indicates current card position within the active section's horizontal rail.

The chevron is vertical motion — reinforces "swipe up." The dots are horizontal arrangement — reinforces "swipe sideways." The shape language does the cognitive work.

### What disappears on mobile

- The header bar's "Build a trade" / "Shop my guys" buttons collapse into the **bottom-pinned nav bar** (mirroring GM Office mobile pattern). Always visible during all three snap sections.
- The OfferCard's prev/next arrows are killed on mobile — swipe gesture replaces them. The "1/5" counter survives but is positioned discreetly (top-right of the card, not flanked by arrows).

### Card sizing on mobile

- **Offer card:** full viewport width minus 16-20px gutter. Vertical layout matches existing `OfferCard.tsx`. Persona toggle, send/receive grid, AI prose, three buttons all stack natively.
- **Player card:** scales up to fill ~80% of viewport width (so the next card peeks ~10% on either side, signaling more cards available). Aspect ratio preserves the Topps-portrait feel (~roughly 4:5).
- **Team card:** scales up to fill ~85% of viewport width (peek of next card on right). Aspect ratio is wider/shorter than player cards (~roughly 2:1).

The peek of adjacent cards on either side reinforces "more here, swipe."

---

## Section 5: Section 1 — Director's Pick (Hero Offer)

### Composition (desktop)

Above the offer card, a single director's-voice intro line:

> *"Boss, of the five deals I've worked up, here's the one I'd start with."*

The line **changes per offer** as the user cycles through 1/5, 2/5, etc. Each offer gets its own director's-voice quip:

- Offer 1: *"Boss, of the five deals I've worked up, here's the one I'd start with."*
- Offer 2: *"Second-best fit. Founders are buying at WR — Lamb's value is peaking right now."*
- Offer 3: *"Long shot but the math works. Thought you should see it."*
- Offer 4-5: similar pattern — director-voiced one-liners per deal

The quip is what transforms the existing Studio offer card from a *transaction surface* into a *recommendation surface*. Same UI; different voice.

### The OfferCard itself

**Carbon copy of `src/components/trade-studio/OfferCard.tsx`.** Zero changes to the component. Wrapping consumer passes the same props it gets today from `TradeStudioView.tsx`:

- `offer` (StudioOffer)
- `index` / `total`
- `advisorProse` / `advisorLoading`
- `onPrev` / `onNext` / `onPersonaChange`
- `onPass` / `onEdit` / `onMakeOffer` / `sendingOffer`

The Pro Personnel landing fetches the slate from `/api/trade-studio/generate` (existing endpoint), exactly the same way `TradeStudioView` does today. No new business logic.

### Director's-voice quip — content engine (DEFERRED)

Generating the per-offer quip is a content question deferred to the build phase. Two viable approaches:

1. **LLM-generated** — call the existing `/api/trades/advisor` flavor with a prompt variant that returns a one-line "director's framing" alongside the existing prose. Cleanest, most varied.
2. **Templated** — rule-based string generation from the offer's verdict + asset types ("Second-best fit. Going for $POSITION." / "Long shot — wanted you to see it." etc.). Predictable, no new LLM cost.

Pick at build. Either way, the quip surfaces directly above the OfferCard and refreshes when the user taps prev/next.

### Section 1 button behavior

The OfferCard's three actions stay wired to their existing handlers:

- **Pass** — `/api/trade-studio/feedback` posts a pass; offer is removed from the slate; cycler advances
- **Edit** — seeds `sessionStorage.cfc_studio_seed_deal` and routes to `/trade-builder?seed=studio` (existing behavior preserved)
- **Make this offer** — `/api/trades/create` and route to `/trades` inbox

No changes to any of these.

---

## Section 6: Section 2 — Players We're Tracking

### Section header

Section divider (existing `SectionBar` pattern):

> **PLAYERS WE'RE TRACKING**

### Card composition

Topps-style portrait cards, ~180w × ~220h on desktop. Up to 10 cards in a horizontal-scroll row.

Each card displays:

- **Player name** — Syne 800, prominent, top of card
- **Position + current team** — JetBrains Mono 700, small, muted (e.g., `WR · Founders`)
- **Availability chip** — filled chip in existing styling (Moveable / Listening / Core / Untouchable). Same chip widths and colors as defined in `CFC-APP-STATUS.md`.
- **Director's quip** — one-line director-voiced fit assessment beneath:
  > *"Fits our buy at WR. Listening — gettable."*
  > *"Stud-level talent at our weakest spot. Worth a real swing."*
  > *"Buy-low candidate. Their owner's been quiet on him."*

### Card aesthetic

- Border: 2.5px solid Ink (#1A1A1A)
- Box shadow: 4px offset, Ink
- Background: Paper (#FEFCF9)
- No rounded corners
- The Topps-trading-card vibe is the design intent — vertical portrait orientation, dense info packed into a card-shaped surface, vintage sports feel

### Tap behavior

Tapping a player card fires the **confirm modal** (Section 9). Once the user dismisses the modal via "Start negotiating," routes to `/trade-builder` with the player + any added suggestions pre-populated on the receive side, partner team loaded as the active tab in the trade machine's right panel.

### Data source

Existing `/api/trades/targets` endpoint already returns the top 10 player matches with everything needed except the director quip:

- `name`, `meta`, `position`, `posGroup`, `tier`, `tierLabel`, `teamId`, `teamName`, `value`, `fitScore`, `type`

The director quip is **new content**. Same content-engine question as the Section 1 hero quip — LLM at request time, or rule-based templating from `tier` + position-market match. Defer to build.

---

## Section 7: Section 3 — Teams Worth a Call

### Section header

> **TEAMS WORTH A CALL**

### Card composition

Wider scouting-report cards, ~280w × ~140h on desktop. Up to 11 cards in a horizontal-scroll row (one per other team in the league).

Each card displays:

- **Team name** — Syne 800, prominent, top of card
- **Badges row** — persona icon + championship rings *(deferred per home-screen spec — placeholder until reusable badge component is built)*
- **Wants chips** — labels from existing `wantsLabels` array on the ranked team (e.g., `BUYING WR`, `SHOPPING RB`). Existing chip styling: blue border, JetBrains Mono 700 7px, uppercase.
- **Headline** — pulled directly from the existing `headline` field that `/api/trades/targets` already returns. Examples: *"Buying at WR, has a stud RB to move"* / *"Shopping their QB, looking for picks"*.

### Card aesthetic

- Same neobrutalist treatment as player cards (2.5px Ink border, 4px offset shadow, Paper background, no rounded corners)
- Wider/shorter shape so the eye reads them as a different category from player cards

### Tap behavior

Tapping a team card routes **directly** to `/trade-builder` with that team loaded as the active partner tab in the right panel. Both sides of the deal card empty. The user picks assets from the existing right-panel roster.

**No confirm modal here.** The director's recommendation was *the team is a good fit*; there's no specific player to suggest follow-ups around. The user lands in the trade machine and starts building.

### Data source

`/api/trades/targets` endpoint's `rankings` array already returns everything needed:

- `teamId`, `teamName`, `score`, `wantsLabels`, `headline`

Plus persona/championship badges from the (deferred) reusable badge component once it exists.

---

## Section 8: Section Dividers & Pagination Indicators

### Desktop section dividers

Uses the existing `SectionBar` component (already in `LandingPage.tsx`):

```
┌──────────────────┐
│ DIRECTOR'S PICK  │ ───────────────────────────────────────
└──────────────────┘
```

- Black rectangle bookend on the left, Syne 800 13px label inside, Paper text
- 3px solid Ink horizontal rule extending right
- Existing pattern, preserved as-is

### Mobile pagination dots

Per-section, sits in the bottom indicator cluster (Section 4). Number of dots equals the number of cards in that section's horizontal rail:

| Section | Dot count |
|---|---|
| Director's Pick | 5 (one per offer in slate; fewer if slate is shorter) |
| Players | 10 (or however many `/api/trades/targets` returns) |
| Teams | 11 (one per other team in the league) |

If a section's count exceeds ~12 dots, compress to a max of 8 visible with a sliding window centered on the active dot (standard iOS pattern). Defer the threshold tuning to build.

### Mobile chevron (the "swipe up" cue)

- ~14×14 SVG
- Muted color (#8C7E6A)
- Animation: `pulse` keyframe, 1.5s ease-in-out infinite, opacity 0.4 → 1.0
- Positioned ~16px above the dots, centered horizontally
- **Hidden on Section 3** — its absence on the last section signals "you've reached the end"

### Pulse keyframe

```css
@keyframes proPersonnelChevronPulse {
  0%, 100% { opacity: 0.4; }
  50% { opacity: 1.0; }
}
```

Reuses the same naming convention as the existing `studioPulse` keyframe in `RosterPanel.tsx` for consistency.

---

## Section 9: Confirm Modal (Player Card Tap)

When the user taps a player card from Section 2, the confirm modal fires. This is a **repurposing** of the existing `src/components/trade/ConfirmModal.tsx` with new copy.

### Modal composition

```
┌────────────────────────────────────────────────────┐
│                                                     │
│  "While we have them on the phone, we may want      │
│   to ask about..."                                  │
│                                                     │
│  ┌────────┐  ┌────────┐  ┌────────┐  ┌────────┐    │
│  │suggest1│  │suggest2│  │suggest3│  │suggest4│    │
│  └────────┘  └────────┘  └────────┘  └────────┘    │
│                                                     │
│              [ Start negotiating → ]                │
│                                                     │
└────────────────────────────────────────────────────┘
```

- **Headline:** kill the existing generic title. Lead with the director's voice, in quotes:
  > *"While we have them on the phone, we may want to ask about..."*
- **Suggestions:** up to 4 cards showing other assets from the same partner team, filtered by tier (`moveable` / `listening`) or asset type (pick). Existing logic in `ConfirmModal.tsx` already handles this.
- **Tap a suggestion** → adds that asset to the deal. Existing logic.
- **Single CTA:** *"Start negotiating →"* — closes modal, routes to `/trade-builder` with the original target + any added suggestions pre-populated on the receive side, partner team loaded as the active tab.

### What's killed

- The existing modal's "see entire roster" / "see more" affordance — gone. The user wants more from this team beyond the 4 suggestions, they hit "Start negotiating," land in the trade machine, and use the right-panel roster from there. No modal-on-modal pattern.
- The existing modal's "Keep shopping" / "Checkout" buttons — gone. Only one CTA: Start negotiating.

### What's preserved

- The suggestion filtering logic
- The tap-to-add behavior
- The visual treatment of suggestion cards (existing styling)

### Where this modal lives

The confirm modal **only appears on the Pro Personnel landing**, when the user taps a player card. It does **not** fire from inside the trade machine. Inside the trade machine, all asset selection is direct via the right-panel roster — no modals.

---

## Section 10: Header Bar — Manual Tool Buttons

The Pro Personnel landing has a persistent header bar between the topbar and the first section. **Desktop only** — on mobile, these buttons live in the bottom-pinned nav bar.

### Composition (desktop)

```
[Pro Personnel]                          [+ Build a trade]  [$ Shop my guys]
```

- **Left:** page title in Syne 800, ~18px
- **Right:** two buttons in neobrutalist black-bordered button style

### Button styling

- Background: Paper (#FEFCF9)
- Border: 2.5px solid Ink
- Box shadow: 3px offset, Ink
- Font: Syne 800, ~12px, uppercase, letter-spacing 0.04em
- Padding: ~10px 16px
- No rounded corners

### Behavior

- **`+ Build a trade`** → `window.location.href = "/trade-builder"`. Lands in the trade machine empty (no cart, no team selected). The trade machine's "+Add" buttons handle partner selection from there (Section 13).
- **`$ Shop my guys`** → `window.location.href = "/trade-studio"`. Lands in the manual Shop's existing roster-grid layout.

These are **co-equal entry points** to the room, not escape hatches. The director's briefing is the default surface, but the manual tools aren't a downgrade. The header bar treats them as peers.

### First-visit affordance (DEFERRED)

A subtle yellow-pulse on the buttons during the user's first visit to Pro Personnel ("hey, these are here") then quiet on subsequent visits. Defer to build — needs a session/local-storage flag and a small animation. Not blocking.

### Mobile equivalent

On mobile, the header bar is removed. The two buttons live in the **bottom-pinned nav bar**, mirroring the GM Office mobile tab bar. Same destinations, same handlers, just relocated.

---

## Section 11: Topbar (Inner Page Pattern)

Inherits from `CFC-GM-OFFICE-SPEC.md` — same component (`InnerTopbar.tsx`).

### Desktop

| Slot | Content | Behavior |
|---|---|---|
| Left | ← back arrow | Returns to home (org chart) |
| Center | CFC league logo (clickable) | Returns to home (org chart) |
| Right | Settings icon | Opens settings menu |

### Mobile

| Slot | Content | Behavior |
|---|---|---|
| Left | Hamburger menu | Opens global navigation drawer |
| Center | **Dynamic section title** (see Section 4) | Updates per snap section: "Director's Pick" / "Players We're Tracking" / "Teams Worth a Call" |
| Right | Settings icon | Opens settings menu |

The dynamic section title is a Pro Personnel-specific affordance on mobile. Other inner-page mobile topbars (GM Office, future Scouting, Research & Strategy) keep the league logo centered. This is reasonable — Pro Personnel's mobile pattern is uniquely a snap-scrolling briefing, and the title needs a place to live.

---

## Section 12: Working Surface — Manual Trade Machine (`/trade-builder`)

The trade machine is **`src/components/trade/TradeBuilder.tsx`**, preserved with no internal changes. This section documents how it's reached and what its empty entry state looks like.

### Entry points

1. GM Office's "Propose" button → direct to `/trade-builder` (no cart, no partner)
2. Pro Personnel landing's "Build a trade" header button → same as above
3. Pro Personnel landing's player card tap → confirm modal → "Start negotiating" → `/trade-builder` with seeded receive-side assets + partner team active
4. Pro Personnel landing's team card tap → direct to `/trade-builder` with partner team active, both sides empty
5. Studio OfferCard's "Edit" button → `/trade-builder?seed=studio` (existing flow, preserved)

### Empty state composition (entry points 1 & 2)

When the user lands with no cart and no partner:

- Right panel shows **only your roster** as the active tab. No partner tabs yet.
- Deal card on the left shows two empty sides:
  - "You send" with a `+ Add from your roster` dashed button
  - "You receive" with a `+ Add from their roster` dashed button
- Topbar shows your team name only (no partner name to concatenate yet)
- "Send offer" CTA is disabled (canSend is false)

### "+ Add from their roster" tap behavior — the partner-picker modal

Tapping `+ Add from their roster` on the empty state opens the **partner-picker modal**. New, lightweight modal that's a slight evolution of the existing `TeamPickerModal.tsx`:

```
┌────────────────────────────────────────────┐
│  Pick a trade partner                       │
│                                             │
│  ┌─────────────────────────────────────┐    │
│  │ 🔍 Search for a player or team…      │    │
│  └─────────────────────────────────────┘    │
│                                             │
│  ── or pick a team ──                       │
│                                             │
│  → Bay Area Founders                        │
│  → Cleveland Football Club                  │
│  → Dallas Outlaws                           │
│  → ... (all 11 other teams)                 │
│                                             │
└────────────────────────────────────────────┘
```

**Behaviors:**

- **Search path:** typing filters across all 11 other teams' rosters by player name. Tapping a player result adds them to the receive side AND loads their team into the right panel as the active tab.
- **Team path:** tapping a team loads that team into the right panel as the active tab. Modal closes. User picks assets from the right panel.
- **One team at a time.** No multi-select, no "Done" button. If the user wants a third team, they tap "+Add team" again later (existing 3-team-mode flow handles the rest).

### "+ Add from your roster" tap behavior

If the right panel is currently showing a partner team's roster, the existing `handleAddFromTeam(myTeamId)` already flips the active tab back to your roster — no change needed.

### What this replaces

The old `LandingPage.tsx` was the only way to start a manual trade. It forced the user through "scout players + scout teams + search" before reaching the trade machine. **Killed entirely** — its functions are split between the new Pro Personnel landing (where scouting recommendations live) and the trade machine's partner-picker modal (where direct partner selection happens).

### What's preserved in `TradeBuilder.tsx`

Everything. No changes to the component. Existing props (`initialCart`, `initialTeams`, `initialDealAssets`) all support the empty-entry case (`initialCart={[]}`, `initialTeams={[]}`). The new entry routes pass these and the component renders the empty state cleanly.

The only NEW work in the trade-machine area is the partner-picker modal — a small new component (or a refactor of `TeamPickerModal.tsx` to add a search bar). Either approach is fine.

---

## Section 13: Working Surface — Manual Shop (`/trade-studio`)

The manual Shop is **`src/components/trade-studio/TradeStudioView.tsx`**, preserved with no internal changes. Documented here for completeness.

### Entry points

1. GM Office's "Shop" button → direct to `/trade-studio`
2. Pro Personnel landing's "Shop my guys" header button → same as above

### Behavior

The existing Studio flow:

- Lands on the 2×2 roster grid (QB / RB / Pass Catchers / Picks)
- User toggles Y/N on assets to put on the block
- Click "Generate offers" → drawer opens with offer cards (1/5 cycler, persona toggle, Pass/Edit/Make this offer)

No changes. The page just gains two new entry points that route to it directly.

---

## Section 14: Items That Get Killed in This Redesign

These exist in the current codebase and are removed:

1. **`src/components/trade/LandingPage.tsx`** — the old Trade Builder landing. Retired entirely. Its top-10-players and ranked-teams sections are reborn as Sections 2 and 3 of the Pro Personnel landing. Its search bar is reborn inside the new partner-picker modal.
2. **`src/components/trade/CartSidebar.tsx`** — retired. The cart was a staging area before the trade machine; the trade machine now handles all asset selection inline. No more cart.
3. **`src/components/trade/RosterModal.tsx`** — retired. The trade machine's right-side roster panel is always-visible and replaces this modal entirely. Tapping a team on the new Pro Personnel landing routes directly to the trade machine — no intermediate modal.
4. **The "GM's Office" door concept (old)** — gone. Its functions split between the new GM Office (inbox/persona/feed), the new Pro Personnel (scouting/recommendations), and direct routes from GM Office to manual tools.
5. **The Propose popover** referenced in `CFC-GM-OFFICE-SPEC.md` — implicitly killed. Per that spec, "Propose" was to open a popover asking "Scout Players or Scout Teams?" Now that Pro Personnel surfaces both as Sections 2 and 3 directly, no popover is needed. **The GM Office's Propose button now routes directly to `/trade-builder`** (the trade machine), not to a chooser. Update `CFC-GM-OFFICE-SPEC.md` Section 8 accordingly when implementing.
6. **The old `LandingPage.tsx` `ConfirmModal` integration** — the modal itself survives but its buttons change. Old: "Add to cart" / "See more" / "Checkout" / "Keep shopping". New: just "Start negotiating →". Headline is killed; lead with the director's quote instead.

---

## Section 15: Files Affected

### Replace / Retire

- `src/components/trade/LandingPage.tsx` — retire entirely. Pro Personnel landing replaces it.
- `src/components/trade/CartSidebar.tsx` — retire.
- `src/components/trade/RosterModal.tsx` — retire.

### Update copy / behavior only

- `src/components/trade/ConfirmModal.tsx` — kill the title, lead with director's quote, single CTA "Start negotiating →", remove "see more" / "keep shopping" buttons. Suggestion logic and tap-to-add behavior preserved.

### New components

- `src/components/pro-personnel/ProPersonnelLanding.tsx` — top-level page composing topbar + header bar + 3 sections + (mobile) bottom nav. Mounts at `/pro-personnel`.
- `src/components/pro-personnel/DirectorPickSection.tsx` — Section 1 wrapper. Composes the director's-voice quip + existing `OfferCard.tsx`. Handles slate fetching from `/api/trade-studio/generate`.
- `src/components/pro-personnel/PlayerCard.tsx` — Topps-style portrait card for Section 2 (~180×220 desktop).
- `src/components/pro-personnel/TeamCard.tsx` — wider scouting-report card for Section 3 (~280×140 desktop).
- `src/components/pro-personnel/HorizontalRail.tsx` — reusable horizontal-scroll container with snap behavior. Used by both player and team rails. On mobile, includes the bottom indicator cluster (chevron + dots).
- `src/components/pro-personnel/HeaderBar.tsx` — desktop header bar with title + Build/Shop buttons.
- `src/components/pro-personnel/MobileBottomNav.tsx` — mobile bottom-pinned nav with Build/Shop buttons. (Or extend `MobileTabBar.tsx` from the GM Office spec.)
- `src/components/pro-personnel/IndicatorCluster.tsx` — the unified mobile bottom indicator (chevron + dots).
- `src/components/trade/PartnerPickerModal.tsx` — new modal for the trade machine empty state. Search bar + team list. Routes to active-tab loading. Replaces `LandingPage`'s old role of partner selection. (Could also be a refactor of `TeamPickerModal.tsx` rather than a brand-new file — call at build time.)

### Reuse untouched

- `src/components/trade-studio/OfferCard.tsx` — full carbon copy in Section 1
- `src/components/trade-studio/PersonaPopover.tsx` — used by OfferCard
- `src/components/trade-studio/TradeStudioView.tsx` — manual Shop, untouched
- `src/components/trade-studio/RosterPanel.tsx` — used by Studio
- `src/components/trade-studio/PassConfirmModal.tsx` — used by Studio
- `src/components/trade/TradeBuilder.tsx` — manual trade machine, untouched
- `src/components/trade/DealCard.tsx` — used by TradeBuilder
- `src/components/trade/AIAdvisor.tsx` — used by TradeBuilder
- `src/components/trade/PlayerRow.tsx` — used by TradeBuilder
- `src/components/trade/TierDivider.tsx` — used by TradeBuilder + new player/team cards if helpful
- `src/components/trade/RoutingPopup.tsx` — used by TradeBuilder
- `src/components/trade/shared/TradeBalanceChip.tsx` — used by OfferCard

### APIs (untouched)

- `/api/trades/targets` — feeds the Pro Personnel landing's player and team sections
- `/api/trade-studio/generate` — feeds Section 1's offer slate
- `/api/trade-studio/feedback` — Pass action
- `/api/trades/advisor` — AI advisor prose for the OfferCard
- `/api/trades/create` — Make this offer

### Data wiring

- The Pro Personnel landing makes **the same API calls the old `LandingPage.tsx` made** (`/api/trades/targets`) **plus** the call `TradeStudioView.tsx` makes (`/api/trade-studio/generate`). Both endpoints exist; no new business logic.
- Director's-voice quips for Section 1 (per offer) and Section 2 (per player) are new content. Choose between LLM-at-request and templated rules at build time.

---

## Section 16: Build Order Recommendation

Suggested sequence to ship cleanly without broken intermediate states. Each step should produce a buildable commit (Nick uses GitHub web editor, one file at a time).

1. **`PartnerPickerModal.tsx`** — new modal for trade machine empty state. Standalone component. Built first because it unblocks the trade machine's empty-entry path, which is needed for both Propose and the new Pro Personnel landing's tap behaviors.
2. **`ConfirmModal.tsx` copy update** — kill title, lead with director's quote, single CTA, remove old buttons. Small surgical edit.
3. **`PlayerCard.tsx`** — Topps-style portrait card. Standalone. Stub data initially.
4. **`TeamCard.tsx`** — wider scouting card. Standalone. Stub data initially.
5. **`HorizontalRail.tsx`** — reusable horizontal-scroll container. Stub with placeholder cards. Verify desktop scroll affordance + mobile snap behavior.
6. **`IndicatorCluster.tsx`** — chevron + dots indicator. Mobile-only. Standalone.
7. **`HeaderBar.tsx`** — desktop header bar with Build/Shop buttons. Standalone.
8. **`MobileBottomNav.tsx`** — mobile bottom-pinned nav. Or extend the GM Office's `MobileTabBar.tsx`.
9. **`DirectorPickSection.tsx`** — Section 1 wrapper. Composes the existing OfferCard + the director's-voice quip. Wires to `/api/trade-studio/generate`.
10. **`ProPersonnelLanding.tsx`** — top-level page. Composes everything. Mount at `/pro-personnel`.
11. **Wire mobile snap-scroll behavior** — vertical and horizontal. Test gesture handling on iOS Safari and Chrome.
12. **Wire dynamic section title in mobile topbar** — IntersectionObserver on the three sections; update the topbar's center label as the active section changes.
13. **Update GM Office's Propose button** — change from popover to direct route to `/trade-builder`. Update `CFC-GM-OFFICE-SPEC.md` Section 8 accordingly.
14. **Retire `LandingPage.tsx`, `CartSidebar.tsx`, `RosterModal.tsx`** — final cleanup. Remove the route. Remove imports.
15. **First-visit pulse on header buttons (DEFERRED)** — yellow-pulse on Build/Shop on first visit. Punt to a later polish pass.

Note: Director's-voice quip content for Sections 1 and 2 can ship with templated rules first, then upgrade to LLM-generated in a later pass. Don't block on the content engine.

---

## Section 17: Open Items / Deferred Decisions

These are NOT blockers for the Pro Personnel build. They are flagged for later work:

1. **Director's-voice quip content engine** — per-offer (Section 1) and per-player (Section 2). Choose LLM vs. templated at build. Either can ship.
2. **Persona icon mapping for team cards** — same deferral as the home screen spec (Section 16, item 4 there). Nick provides at build.
3. **Championship rings on team cards** — same deferral as home screen. Defaults to 0 / no icon until data exists.
4. **First-visit yellow-pulse on header buttons** — punt to a polish pass.
5. **Player card empty state when no targets** — when `/api/trades/targets` returns zero or fewer than ~3 players, what does Section 2 show? Probably an empty-state card with director's-voice copy ("Wire's quiet. Nothing fits our build right now."). Defer copy to build.
6. **Slate empty state for Section 1** — when `/api/trade-studio/generate` returns zero offers, what does the hero show? Same kind of director's-voice empty card ("Nothing's clicking with the persona today. Try Build a trade or Shop my guys."). Defer.
7. **Mobile dot compression for sections with >12 cards** — sliding window pattern. Threshold and animation defer to build.
8. **Confirm modal headline as cycler** — once we have multiple director-voiced openings, could rotate them ("While we have them on the phone..." / "If they're picking up, might as well ask..." / etc.). Punt for now; one fixed headline ships.
9. **Animation tuning** — chevron pulse timing, snap-scroll velocity thresholds, card-flip transitions. Defer to mockup polish pass.
10. **Accessibility** — keyboard navigation, screen reader labels, focus states on cards. Punted.
11. **Session/localStorage flag for first-visit detection** — needed for the yellow-pulse polish item. Defer.
12. **3-team trade flow from Pro Personnel landing** — Section 2's confirm modal and Section 3's direct route both land in 2-team mode. Adding a third team uses the existing `TradeBuilder`'s "+Add team" header affordance. No special Pro Personnel flow needed — existing UX handles it.

---

## Section 18: Behavioral Notes

- **Default landing:** `/pro-personnel` — desktop renders all 3 sections vertically; mobile snaps to Section 1.
- **Logo click on topbar:** always returns to home (org chart).
- **Back arrow click (desktop):** returns to home.
- **Hamburger menu (mobile):** opens global nav with all four doors + settings.
- **Header bar buttons:** persistent on desktop; relocated to bottom nav on mobile.
- **Mobile section snap:** vertical swipe past threshold locks to next/previous section. Horizontal swipe within section cycles cards.
- **Mobile topbar title:** dynamic per section.
- **Mobile chevron:** pulsing on sections 1 and 2; absent on section 3.
- **Mobile dots:** active dot is Ink; inactive dots are Muted; current card position within the active section.
- **Player card tap:** confirm modal fires.
- **Team card tap:** direct route to trade machine.
- **Confirm modal "Start negotiating":** routes to trade machine with seeded assets + active partner tab.
- **Trade machine empty +Add tap:** partner-picker modal fires.
- **Search inside partner-picker modal:** matches across all 11 other rosters by player name; tap a result loads team + adds player.
- **Toast:** existing pattern preserved (top-center, 3s auto-dismiss). Used for trade-machine and Studio confirmations.

---

## Section 19: Color Palette (Excerpt from Design System)

| Name | Hex | Usage on Pro Personnel |
|---|---|---|
| Ink | #1A1A1A | Borders, primary text, active dot, section dividers, button borders |
| Paper | #FEFCF9 | Card backgrounds, button backgrounds, modal backgrounds |
| Cream | #F5F0E6 | Page background, hover states |
| Blue | #3366CC | Wants chips on team cards, OfferCard balance chip (existing usage) |
| Yellow | #F5C230 | AI-element accent (existing OfferCard usage), first-visit pulse |
| Red | #E8503A | Untouchable chip on player cards (existing styling), Pass button (existing OfferCard) |
| Green | #007370 | Moveable chip on player cards (existing styling), "In the range" grade |
| Muted | #8C7E6A | Secondary text on cards (position, team), inactive dots, chevron, timestamps |

Full palette in `/docs/CFC-APP-STATUS.md`.

---

## Section 20: Typography (Excerpt from Design System)

| Font | Weight | Usage on Pro Personnel |
|---|---|---|
| Syne | 800–900 | Page title, section divider labels, player/team card names, button labels, director's-voice quip headline |
| DM Sans | 400–700 | Director's-voice quip body text, card subtitles, modal body text |
| JetBrains Mono | 700 | Position/team metadata on cards, wants chip labels, "1/5" counter, dot indicators |

Full system in `/docs/CFC-APP-STATUS.md`.

---

## Section 21: Summary — At-a-Glance

| Element | Decision |
|---|---|
| **Routing** | `/pro-personnel` (briefing) · `/trade-builder` (manual machine) · `/trade-studio` (manual shop) |
| **Concept** | Director's briefing room — three folders fanned on the desk |
| **Section 1** | Director's Pick — full Studio OfferCard with director's-voice intro line per offer |
| **Section 2** | Players We're Tracking — horizontal-scroll Topps-style cards (~180×220) with director's quip per card |
| **Section 3** | Teams Worth a Call — horizontal-scroll scouting-report cards (~280×140) with existing headline + wants chips |
| **Header bar (desktop)** | Page title + persistent "Build a trade" / "Shop my guys" buttons |
| **Bottom nav (mobile)** | Same two buttons, pinned to bottom |
| **Sidebar / inner nav** | None — director doors don't have sidebars (reserved for GM Office) |
| **Topbar** | Inherits GM Office spec; mobile center label is dynamic per snap section |
| **Mobile scroll** | Snap on both axes — vertical between sections, horizontal within sections |
| **Mobile indicator** | Unified cluster — chevron above dots, both centered above bottom nav |
| **Player card tap** | Confirm modal → "Start negotiating" → trade machine with seeded assets |
| **Team card tap** | Direct route → trade machine with partner team active |
| **Build a trade tap** | Direct route → empty trade machine; "+Add" triggers partner-picker modal |
| **Shop my guys tap** | Direct route → existing Studio's manual roster-grid flow |
| **Confirm modal** | Director's-voice headline only ("While we have them on the phone..."), single CTA "Start negotiating →" |
| **Killed** | `LandingPage.tsx` · `CartSidebar.tsx` · `RosterModal.tsx` · GM Office Propose popover · old "GM's Office" door concept |
| **Preserved untouched** | `TradeBuilder.tsx` · `TradeStudioView.tsx` · `OfferCard.tsx` · `RosterPanel.tsx` · `DealCard.tsx` · all APIs |

---

## End of Spec — Ready for Build

The Pro Personnel design is fully locked. The only items intentionally deferred are content-engine choices (director's-voice quip generation), badge/icon assets (persona + championship rings, deferred at the home screen level), and adjacent polish (first-visit pulse, animation tuning, accessibility). All locked items are buildable today against existing APIs and existing components.

Pick this up in a new build chat by attaching this document along with `/docs/CFC-APP-STATUS.md`, `CFC-HOME-SCREEN-SPEC.md`, and `CFC-GM-OFFICE-SPEC.md`. The new chat should not need any conversation history beyond these four files to execute the build cleanly.
