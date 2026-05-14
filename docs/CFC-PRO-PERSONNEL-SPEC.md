# CFC Front Office — Pro Personnel Design Spec

**Version:** 2.0 (revised)
**Date:** May 13, 2026
**Status:** Design locked — ready for mockup → code

> **Revision note (v2.0, May 13, 2026):** Major redesign from v1.0 following the May 12, 2026 master design session. The landing is now a **trading card binder grid** of individual opportunity cards (matching R&S and Scouting) instead of the prior 3-section briefing layout. **2 card types** (down from 3): Acquire opportunity + Shop opportunity. League insights moved to GM Office (pending offers → Inbox aged indicators; completed trades → CFC Insider feed). The "Director's Pick" Hero Card on the PP landing is killed — the Hero Card (Studio cycler) now lives only in Trade Studio Shop Around. The old Confirm Modal is killed — replaced by the universal card flip pattern. A persistent **Pro Scout chat panel** is added (right rail desktop / full-screen takeover mobile). Old `LandingPage.tsx`, `CartSidebar.tsx`, `RosterModal.tsx` remain killed.

---

## Purpose of This Document

This document captures every design decision for the **Pro Personnel door** — the director's briefing room landing, the manual trade-building surface, and the manual shopping surface. It is the handoff spec for implementation. A new chat or developer should be able to read this document and execute the build without referring to prior conversation.

This document is **forward-looking**. It describes what Pro Personnel becomes, not what it currently is.

This spec must be read alongside:
- `/docs/CFC-APP-STATUS.md` (project-wide design system and non-negotiables)
- `CFC-HOME-SCREEN-SPEC.md` v2.1 (locked home screen — Pro Personnel is one of three director doors)
- `CFC-GM-OFFICE-SPEC.md` (locked GM Office — receives league insights moved out of PP)
- `CFC-RESEARCH-STRATEGY-SPEC.md` (locked R&S — Pro Personnel reads R&S signals)
- `CFC-SCOUTING-SPEC.md` (locked Scouting — shares the binder-grid landing pattern with Pro Personnel)

The Pro Personnel door is one of three directors reporting to the GM. Its lens is **looking outward** — other teams' rosters, trade activity, and who's a fit for our build.

---

## Section 1: Concept & Metaphor

The Pro Personnel door IS the **Director of Pro Personnel's briefing room**. The user walks in and the director's been at the desk all morning — opportunity cards laid out, ready to walk through:

> *"Boss, I worked the phones. Here's what I've got."*

Each card on the desk is one of two things:

1. **A target to acquire** — *"Founders' WR1 fits our hole. Here's how to start that conversation."*
2. **One of our guys worth shopping** — *"I think we should move Player X. Three teams might be calling."*

That's it. No team-of-the-day folder, no league wire summary. The director's job is to translate league signals into specific player-level opportunities; the cards on the desk are those opportunities.

Two voices in the room:

- **The Director of Pro Personnel** — speaks on the cards. Has worked the phones, has a point of view about each deal. *"I think we should move Player X — but package him with a 2nd to maximize what comes back."* The director prepared the desk before you walked in.
- **The Pro Scout** — staff, not the director. Lives in the chat. Pulls intel, runs comparisons, answers league questions. *"Which teams might trade a first?"* / *"Who's hot in the trade market?"* The scout is at the keyboard while the director is at the whiteboard.

The metaphor governs everything that follows: card design (each opportunity is a real Topps card of the player), voice rules (director on the cards, scout in the chat), the persistent chat panel, and the role boundary — Pro Personnel **hunts opportunities**; the GM Office handles **correspondence** (the inbox) and **news** (the CFC Insider feed).

---

## Section 2: Architecture & Routing

### Routes

| Route | Surface | Entry points |
|---|---|---|
| `/pro-personnel` | Pro Personnel landing (primary surface, this spec) | Home screen Pro Personnel director box |
| `/trade-builder` | Trade machine (manual deal building) | GM Office "Propose" button **AND** the PP landing's *"Build a trade"* header button **AND** any Acquire opportunity card's flip-back "pick a package" action |
| `/trade-studio` | Trade Studio (Shop Around — Hero Card cycler) | GM Office "Shop" button **AND** the PP landing's *"Shop my guys"* header button **AND** any Shop opportunity card's flip-back "pick a package" action |

### Mental model

Pro Personnel has **one surface** inside the door: the binder-grid landing. There is no internal navigation — no sidebar, no tabs, no sub-pages. The director's chat panel sits on the right (desktop) or as a pinned-input takeover (mobile). Everything else routes out to the working surfaces (`/trade-builder` or `/trade-studio`).

This mirrors the pattern locked across all three director doors (PP, R&S, Scouting): single landing surface with the binder grid + persistent chat panel. Sidebars are reserved for the GM Office.

### What this replaces

- The old "GM's Office" door concept (different from the new GM Office spec) is gone.
- The old `src/components/trade/LandingPage.tsx` (top-10-players + ranked-franchises + search) is **killed**.
- The PP v1.0 three-section layout (Director's Pick / Players We're Tracking / Teams Worth a Call) is **killed**.
- The PP v1.0 Confirm Modal is **killed** — replaced by the universal card flip pattern.

---

## Section 3: The Landing — Layout (Desktop, ≥768px)

```
┌──────────────────────────────────────────────────────────────────────┐
│  [InnerTopbar: ← back · league logo · settings]                       │
│  [Header bar: "Pro Personnel" · Build a trade · Shop my guys]         │
├──────────────────────────────────────────┬───────────────────────────┤
│                                           │                            │
│  ┌─────┐  ┌─────┐  ┌─────┐                │  ┌────────┬─────────────┐ │
│  │card1│  │card2│  │card3│                │  │ Active │  History    │ │
│  └─────┘  └─────┘  └─────┘                │  └────────┴─────────────┘ │
│                                           │                            │
│  ┌─────┐  ┌─────┐  ┌─────┐                │  ┌──────────────────────┐ │
│  │card4│  │card5│  │card6│                │  │ [opener chip 1]      │ │
│  └─────┘  └─────┘  └─────┘                │  └──────────────────────┘ │
│                                           │  ┌──────────────────────┐ │
│  ┌─────┐  ┌─────┐  ┌─────┐                │  │ [opener chip 2]      │ │
│  │card7│  │card8│  │card9│                │  └──────────────────────┘ │
│  └─────┘  └─────┘  └─────┘                │  ┌──────────────────────┐ │
│                                           │  │ [opener chip 3]      │ │
│  ← scroll for more ──                     │  └──────────────────────┘ │
│                                           │                            │
│                                           │  [Ask the Pro Scout…]     │
└──────────────────────────────────────────┴───────────────────────────┘
   ← ~70% binder grid →                       ← ~30% chat panel →
```

- **InnerTopbar:** standard inner-page topbar (back arrow / league logo / settings). Inherits from GM Office spec. **The old PP v1.0 dynamic-section-title mobile topbar pattern is killed** — no more section labels in the topbar, because there are no sections.
- **Header bar:** page title left (*"Pro Personnel"*); two action buttons right (*"Build a trade"*, *"Shop my guys"*).
- **Main content area (~70%):** trading card binder grid, 3 columns, multiple rows visible. Each card ~280×392 (5:7 playing card ratio). 6–9 cards visible at a glance. Cards sort by tier (red → yellow → green) and within tier by recency.
- **Right rail (~30%):** persistent chat panel. Two tabs (Active / History) at the top. Empty Active state shows the 3 locked opener chips (see Section 8). Input pinned at the bottom with placeholder *"Ask the Pro Scout…"* in muted italic DM Sans (#8C7E6A).
- **Click a card** → flips in place to reveal the 3 pre-built package options. No reflow, no modal.

### Tap-to-view affordance
Every Pro Personnel card carries a universal action label at the bottom — *"Tap to view"* — signaling the flip.

---

## Section 4: The Landing — Mobile Layout (<768px)

```
┌─────────────────────────────────┐
│  [topbar: hamburger / logo / ⚙] │
├─────────────────────────────────┤
│  [Build a trade] [Shop my guys] │  ← pinned action buttons
├─────────────────────────────────┤
│                                  │
│                                  │
│   ┌──────────────────────┐      │
│   │                       │      │
│   │ [single card front]   │      │  ← horizontal swipe deck
│   │                       │      │
│   │ "Tap to view"         │      │
│   └──────────────────────┘      │
│                                  │
│           • • • • •              │  ← dots indicator (peek killed)
│                                  │
├─────────────────────────────────┤
│  [Ask the Pro Scout…]           │  ← pinned chat input
└─────────────────────────────────┘
```

- **Top bar:** InnerTopbar mobile pattern (hamburger / logo / settings). **No dynamic section title** — that pattern is killed.
- **Pinned action buttons** below the topbar: *"Build a trade"* and *"Shop my guys"*. Always visible during card swiping.
- **Main content:** swipeable card deck. One card visible at a time. Horizontal swipe cycles through cards. **Peek of next card is killed.** Dots are the only swipe signal.
- **Pinned chat input** (bottom): single-line *"Ask the Pro Scout…"*. Tap or start typing → expands to full-screen chat takeover with the 3 opener chips in the empty Active state. Close → returns to the landing.
- **Scroll lock:** while a card is flipped, page-level scroll locks.

When the landing has zero cards, the swipeable deck is replaced by the empty state copy (Section 7), centered, no card.

---

## Section 5: Card Types

Pro Personnel surfaces **two card types** on the landing. Both are Player Card template (Topps-style for a player), both flip, both have the same flip-back shape (3 pre-built packages). The director's voice on the front identifies which type it is.

### 5.1 Acquire opportunity

A target on another team we should pursue.

**Front (Player Card of the target):**
- Topps-style player portrait of the target (their player)
- Name, position, team chrome
- Marker chips (STUD / YOUTH / AGING) where applicable
- Optional memo corner if the director has a longer note
- Director's quip:
  > *"Founders are selling at WR. Their WR2 fits our hole. Here's how to start the conversation."*
- Universal action label at the bottom: *"Tap to view"*

**Back (3 pre-built send packages):**
- Card-level director headline: *"I've thought up 3 ways to construct this — pick your starting angle."*
- 3 send-side package options stacked vertically. Examples:
  - *"1st-rounder + filler"*
  - *"Mahomes for haul-balance"*
  - *"Picks-only — three 2nds"*
- Each option is tappable.
- Small X top-right to close the flip without committing (mobile).

**Tap an option** → routes to `/trade-builder` with:
- Partner team loaded as the active tab in the right panel
- Target player pre-populated on the receive side
- Selected package's assets pre-populated on the send side
- User can edit or send from there

### 5.2 Shop opportunity

One of our players the director thinks we should move.

**Front (Player Card of YOUR player):**
- Topps-style player portrait of our player
- Name, position, team chrome
- Marker chips (STUD / YOUTH / AGING) where applicable
- Optional memo corner
- Director's quip with optional package recommendation:
  > *"I think we should move Player X — but package him with a 2nd to maximize the return."*
  > Or: *"Mahomes' value is peaking before the age cliff. Sell high while we can."*
- Universal action label at the bottom: *"Tap to view"*

**Back (3 packaging options for our player):**
- Card-level director headline: *"Three ways to package this — pick your angle."*
- 3 packaging options stacked vertically. Examples:
  - *"Move Player X alone"*
  - *"Move Player X + a 2nd"* (sweetener)
  - *"Move Player X + Lamb"* (bundle)
- Each option is tappable.
- Small X top-right to close the flip without committing (mobile).

**Tap an option** → routes to `/trade-studio?seed=shop` with:
- The selected package pre-selected on the block (Trade Studio's existing roster grid is pre-marked Y for those assets)
- Offers automatically generated (Trade Studio's "Generate offers" flow has already run)
- User lands on the Hero Card cycler with offers ready

### 5.3 Signal inputs (cross-director flow)

The director runs lenses that draw from multiple sources to surface these cards. Build-time wiring; spec'd here for completeness.

| Card type | Signal sources |
|-----------|----------------|
| Acquire opportunity | R&S `wants_more` (buying signal) · R&S position market (buying) · league market signals (other teams' availability changes) · partner team fit analysis |
| Shop opportunity | R&S aging signal · R&S value drift signal · R&S position market (selling) · league market signals (where the buyers are) |

R&S generates the settings signals (aging, drift, market direction). Pro Personnel turns them into specific player-level trade cards. Same architecture as Scouting's Trade up/down intel lens — directors talk to each other, cards live in their own domain.

### 5.4 What was killed

- **Hero Card / Director's Pick on PP landing.** The 5-deal cycler (Studio OfferCard) is no longer on the PP landing. It now lives only in Trade Studio Shop Around as the natural drill-in destination for Shop opportunity cards. Same component, different surface.
- **Top Targets List Card** (v1.0 — single card listing 5 player rows). Each tracked player is now its own Acquire opportunity card in the binder.
- **Top Trade Partners List Card** (v1.0 — single card listing 5 team rows). Team-fit analysis still drives Acquire opportunities, but the team itself isn't a card. The director's job is to translate team-level signals into player-level opportunities; team-of-the-day folder is gone.
- **League insights as a card type** (proposed in the redesign discussion). Pending offer reminders → handled by the GM Office Inbox itself (threads ARE the reminders, aged-indicator next to a thread shows urgency). Completed league trades → CFC Insider feed in the GM Office.
- **Confirm Modal** (PP v1.0 *"While we have them on the phone..."* modal). Replaced entirely by the universal card flip pattern.
- **Director's-voice quip cycler concept** that varied per offer on the Hero Card. Moot now that the Hero Card doesn't live here.

---

## Section 6: Card Structure & Mechanics

Cards on the Pro Personnel landing follow the universal card system locked in `CFC-APP-STATUS.md` (Card System section).

### Player Card template (both Acquire and Shop)
- **Front:** Topps-style identity (photo, name, position chip, team chip) + marker chips + director's quip + optional memo corner + universal action button at the bottom (*"Tap to view"*).
- **Back:** 3 pre-built package options stacked vertically. Tap one → route to the destination with the deal pre-populated.

### Memo corner
Optional. Present when the director has a longer note attached to the player that goes beyond the front-of-card quip. Tap the memo corner → popover with the full note. Travels with the player across surfaces (e.g., same memo corner on the same player's R&S Set Availability card).

### Universal flip mechanic
Per master card system:
- Tap *"Tap to view"* → 3D rotateY flip, ~300ms ease-out
- Pick a package on the back → routes out (no DONE stamp needed — the route IS the action)
- Mobile: small X top-right of the back closes the flip without committing; page-level scroll locks while flipped

### Card priority sort
Cards sort top-to-bottom (desktop grid reading order, mobile deck order):
1. Red cards first
2. Yellow cards next
3. Green cards last
4. Within each tier, sort by recency

The home screen briefing previews the **top card on the landing** (Pattern A from the home screen spec).

### Urgency triggers (locked framework)

| Card type | Yellow trigger | Red trigger |
|-----------|----------------|-------------|
| Acquire opportunity | Hot target detected (high-fit player, partner is selling, value math works) | Untouchable being actively shopped (≥2 teams asking) — surfaces as a Shop card with extra urgency |
| Shop opportunity | Aging signal + value peak; or position-market-selling signal with buyer demand | Untouchable target on the other side becomes briefly available |

Pending offer urgency lives in the GM Office Inbox (aged indicators on threads), not on PP cards. PP is for proactive hunting; pending offers are correspondence.

---

## Section 7: Refresh, Empty State, Behavior

### Refresh mechanics
Landing computes **on page entry only**. User opens PP → engine runs lenses → picks Acquire / Shop cards by urgency and recency → renders. User acts on cards (taps a package, routes out) → on next entry, those cards may not return if the action resolved them. User leaves and returns later → fresh recompute.

**No manual refresh button.** Curated opportunities, not an endlessly-scrollable feed.

### Empty state
When the landing has 0 cards, show the director's-voice empty state centered:

> *"Quiet out there. I'll keep watching."*

Optional sub-line if relevant context exists. No empty-state card, no illustrations — just copy + the chat input as the obvious next move. The director's-voice empty state is the locked pattern across all three director landings (per APP-STATUS Empty State Voice Rules).

---

## Section 8: Chat Panel — The Pro Scout

### Desktop (persistent right rail, ~30%)
Always visible while on the landing.

```
┌──────────────────────────┐
│ ┌────────┬─────────────┐ │  ← tabs at the very top (no header label)
│ │ Active │  History    │ │
│ └────────┴─────────────┘ │
├──────────────────────────┤
│ ┌──────────────────────┐ │  ← 3 opener chips when conversation empty
│ │ Which teams might    │ │     fade out when conversation starts
│ │ trade a first?       │ │
│ └──────────────────────┘ │
│ ┌──────────────────────┐ │
│ │ Who's hot in the     │ │
│ │ trade market?        │ │
│ └──────────────────────┘ │
│ ┌──────────────────────┐ │
│ │ Which GMs are        │ │
│ │ easiest to deal with?│ │
│ └──────────────────────┘ │
│                           │
│   [conversation thread]   │
│                           │
├──────────────────────────┤
│ [Ask the Pro Scout…]     │  ← pinned input, muted italic placeholder
└──────────────────────────┘
```

- **No header label** — the input placeholder carries the role identity.
- **Tabs (Active / History) at the very top.**
- **Opener chips (3 locked):**
  - *"Which teams might trade a first?"*
  - *"Who's hot in the trade market?"*
  - *"Which GMs are easiest to deal with?"*
- **Chip behavior:** tap a chip → autofills the input (does not auto-send). User can edit before submitting.
- **Chip visibility:** shown in the empty Active state. Fade out when a conversation starts. Return when the user clears or starts a new conversation. History tab never shows chips.
- **Input placeholder:** *"Ask the Pro Scout…"* — muted italic DM Sans (#8C7E6A). Same treatment in both desktop and mobile.

### Mobile (pinned input → full-screen takeover)
Tap or start typing in the pinned input → full-screen chat takeover. Same Active / History tabs, same opener chips in the empty Active state. Close affordance (top-right) returns to the landing.

### Default state (no conversation yet)
Active tab shows the 3 opener chips + the input. No welcome screen, no fun facts, no extra copy.

### Conversation persistence
V1: localStorage. Move to backend deferred — not blocking.

---

## Section 9: Header Bar — Manual Tool Buttons

The Pro Personnel landing has a persistent header bar between the topbar and the binder grid. **Desktop only** — on mobile, these buttons live in the pinned-top action row beneath the topbar.

### Composition (desktop)
```
[Pro Personnel]                       [Build a trade]  [Shop my guys]
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
- **`Build a trade`** → `window.location.href = "/trade-builder"`. Lands in the trade machine empty (no cart, no partner). The trade machine's "+Add" buttons trigger the partner-picker modal from there (Section 12).
- **`Shop my guys`** → `window.location.href = "/trade-studio"`. Lands in the manual Shop's existing roster-grid layout (Trade Studio's existing entry point).

These are co-equal entry points to the room, not escape hatches. The director's curated binder is the default surface, but the manual tools aren't a downgrade — power users skip the cards and go straight to the work.

### Mobile equivalent
The header bar is removed on mobile. The two buttons live in the **pinned action row** beneath the topbar, mirroring R&S and Scouting mobile patterns.

---

## Section 10: Topbar

Inherits from `CFC-GM-OFFICE-SPEC.md` — same `InnerTopbar` component on the Pro Personnel landing.

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
| Center | CFC league logo (clickable) | Returns to home (org chart) |
| Right | Settings icon | Opens settings menu |

**The old PP v1.0 dynamic-section-title mobile topbar pattern is killed.** There are no sections anymore, so the center stays the league logo on all R&S, Scouting, and PP mobile topbars.

---

## Section 11: Working Surface — Manual Trade Machine (`/trade-builder`)

The trade machine is **`src/components/trade/TradeBuilder.tsx`**, preserved with no internal changes. This section documents how it's reached and what its empty entry state looks like.

### Entry points

1. GM Office's "Propose" button → direct to `/trade-builder` (no cart, no partner). **Note:** the GM Office spec's older Propose-popover proposal is moot now — Propose routes directly to the trade machine. Update GM Office spec Section 8 accordingly when implementing.
2. Pro Personnel landing's *"Build a trade"* header button → same as above
3. Pro Personnel landing's **Acquire opportunity** card flip-back, package selected → `/trade-builder` with partner + target + selected send package pre-populated
4. Trade Studio's existing OfferCard "Edit" button → `/trade-builder?seed=studio` (existing flow, preserved)

### Empty state composition (entry points 1 & 2)

When the user lands with no cart and no partner:
- Right panel shows **only your roster** as the active tab. No partner tabs yet.
- Deal card on the left shows two empty sides:
  - "You send" with a `+ Add from your roster` dashed button
  - "You receive" with a `+ Add from their roster` dashed button
- Topbar shows your team name only (no partner name to concatenate yet)
- "Send offer" CTA is disabled (canSend is false)

### "+ Add from their roster" tap behavior — the partner-picker modal

Tapping `+ Add from their roster` on the empty state opens the **partner-picker modal**. Lightweight modal — a slight evolution of the existing `TeamPickerModal.tsx`:

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

### What's preserved in `TradeBuilder.tsx`
Everything. No changes to the component. Existing props (`initialCart`, `initialTeams`, `initialDealAssets`) all support the empty-entry case (`initialCart={[]}`, `initialTeams={[]}`).

The only NEW work in the trade-machine area is the partner-picker modal — a small new component or a refactor of `TeamPickerModal.tsx` to add a search bar.

---

## Section 12: Working Surface — Trade Studio Shop Around (`/trade-studio`)

The Trade Studio is **`src/components/trade-studio/TradeStudioView.tsx`**, preserved with no internal changes. **This is now the home of the Hero Card cycler** (the 5-deal Studio OfferCard).

### Entry points

1. GM Office's "Shop" button → direct to `/trade-studio` (existing roster-grid entry → user picks players → generates offers → Hero Card cycler drawer opens)
2. Pro Personnel landing's *"Shop my guys"* header button → same as above
3. Pro Personnel landing's **Shop opportunity** card flip-back, package selected → `/trade-studio?seed=shop` with the package pre-marked on the roster grid AND offers automatically generated → Hero Card cycler drawer open with offers ready

### Hero Card lives here

The Hero Card template (single-sided cycler, persona toggle, prev/next, send/receive grid, AI advisor prose, balance chip, *Pass* / *Edit* / *Make this offer*, counter 1/5) lives exclusively in Trade Studio Shop Around. This is the only place in the app that uses the Hero Card template — the universal flip pattern doesn't apply here (Hero Card is single-sided).

No changes to `OfferCard.tsx` or `TradeStudioView.tsx`. The component already handles all the cycler logic; new entry points just route into it.

### Director's-voice quip context (when entered from a PP Shop card)

When entered via a PP Shop opportunity card with a pre-seeded package, the Hero Card cycler can optionally show a small director's-voice context line above the first offer, referencing why we're here:
> *"Here's what the league's offering for [Player X] + [package]."*

Defer to build whether this context line ships in V1 or as polish. The cycler works fine without it.

---

## Section 13: Items Killed in This Redesign

These exist in the codebase and are removed:

1. **`src/components/trade/LandingPage.tsx`** — already killed in v1.0; remains killed. Its top-10-players and ranked-teams sections do NOT return in v2.0; the binder grid of individual opportunity cards replaces them.
2. **`src/components/trade/CartSidebar.tsx`** — already killed in v1.0; remains killed.
3. **`src/components/trade/RosterModal.tsx`** — already killed in v1.0; remains killed.
4. **`src/components/trade/ConfirmModal.tsx`** — the v1.0 spec retained this with new copy. v2.0 **kills it entirely**. The universal card flip pattern replaces it. Delete the file.
5. **Director's Pick Hero Offer Card on the PP landing** (v1.0). The Hero Card cycler is moved exclusively to Trade Studio Shop Around. The PP landing's first section is gone (no Section 1 / Section 2 / Section 3 structure exists in v2.0 — it's one binder grid).
6. **PP v1.0 mobile snap-scroll-between-sections pattern.** Mobile is now one swipeable card deck (single section), not 3 vertically-snapped panels.
7. **PP v1.0 dynamic section title in mobile topbar.** Killed because there are no sections.
8. **The PP v1.0 chevron + dots IndicatorCluster** (chevron above dots for swipe-up cue). With one section only, no vertical swipe needs cueing. Dots survive as the horizontal swipe indicator on mobile single-section deck (matches R&S and Scouting).
9. **GM Office Propose popover** ("Scout Players or Scout Teams?") — already killed in v1.0; remains killed. GM Office Propose routes directly to `/trade-builder`.
10. **The old "GM's Office" door concept (predating v1.0)** — remains killed.

---

## Section 14: Files Affected

### Retire (delete)
- `src/components/trade/LandingPage.tsx` — already retired; confirm removed
- `src/components/trade/CartSidebar.tsx` — already retired; confirm removed
- `src/components/trade/RosterModal.tsx` — already retired; confirm removed
- `src/components/trade/ConfirmModal.tsx` — **delete in this pass** (was retained with new copy in v1.0; now superseded by card flip)

### Replace / update if v1.0 already built
If any v1.0 PP landing files were built, refactor or replace per v2.0:
- `src/components/pro-personnel/ProPersonnelLanding.tsx` — restructure from 3 sections to single binder grid + persistent chat panel
- `src/components/pro-personnel/DirectorPickSection.tsx` — retire (Hero Card moved to Trade Studio)
- `src/components/pro-personnel/HorizontalRail.tsx` — retire (no horizontal rails in v2.0)
- `src/components/pro-personnel/IndicatorCluster.tsx` — retire (chevron + section snapping gone)

### New components (v2.0)
- `src/components/pro-personnel/ProPersonnelLanding.tsx` — top-level page composing topbar + header bar + binder grid + chat panel (desktop) / pinned-input (mobile). Mounts at `/pro-personnel`.
- `src/components/pro-personnel/CardGrid.tsx` — binder grid for desktop (3 columns); swipe deck for mobile. May be a shared component with R&S and Scouting landings — check cross-pollination at build.
- `src/components/pro-personnel/AcquireCard.tsx` — Player Card variant for the Acquire opportunity card. Front + back, 3 send-package options on back.
- `src/components/pro-personnel/ShopCard.tsx` — Player Card variant for the Shop opportunity card. Front + back, 3 packaging options on back.
- `src/components/pro-personnel/ProScoutChatPanel.tsx` — persistent right-rail chat (desktop) / pinned-input + takeover (mobile). Wraps the chat with Pro Scout identity + 3 opener chips.
- `src/components/pro-personnel/PPHeaderBar.tsx` — landing's header bar (page title + Build a trade / Shop my guys buttons on desktop; mobile pinned-top action row).
- `src/components/pro-personnel/EmptyLanding.tsx` — empty-state copy in director's voice.
- `src/components/trade/PartnerPickerModal.tsx` — new modal for the trade machine empty state (search bar + team list). Replaces `TeamPickerModal.tsx` or is a refactor of it.

### Reuse untouched
- `src/components/trade-studio/OfferCard.tsx` — Hero Card. Untouched. Now used only in Trade Studio.
- `src/components/trade-studio/PersonaPopover.tsx` — used by OfferCard
- `src/components/trade-studio/TradeStudioView.tsx` — Trade Studio, untouched (gains a new entry-point query param `?seed=shop` for pre-seeded packages from PP Shop cards)
- `src/components/trade-studio/RosterPanel.tsx` — used by Studio
- `src/components/trade-studio/PassConfirmModal.tsx` — used by Studio
- `src/components/trade/TradeBuilder.tsx` — manual trade machine, untouched
- `src/components/trade/DealCard.tsx` — used by TradeBuilder
- `src/components/trade/AIAdvisor.tsx` — used by TradeBuilder
- `src/components/trade/PlayerRow.tsx` — used by TradeBuilder
- `src/components/trade/TierDivider.tsx` — used by TradeBuilder
- `src/components/trade/RoutingPopup.tsx` — used by TradeBuilder
- `src/components/trade/shared/TradeBalanceChip.tsx` — used by OfferCard

### APIs
- `/api/trades/targets` — feeds the PP landing's lens engine (existing endpoint, may need extension for new lens output shape)
- `/api/trade-studio/generate` — now consumed by Trade Studio only (no longer called from PP landing). Trade Studio's existing flow uses it.
- `/api/trade-studio/feedback` — Pass action (Trade Studio internal)
- `/api/trades/advisor` — AI advisor prose (Trade Studio internal)
- `/api/trades/create` — Make this offer (Trade Studio internal)
- New (or extended): `/api/pro-personnel/landing` — endpoint generating Acquire / Shop cards by running lenses. May extend `/api/trades/targets` rather than create new.

### Data wiring
- R&S signal integration (aging, value drift, position market, wants_more) — pulled from existing R&S strategy profile data
- League market signals (other teams' availability changes, recent trades, partner team fit analysis) — partially exists in `/api/trades/targets`
- Director's-voice quip generation — content engine decision (LLM at request time vs. templated rules). Defer to build.
- Pre-built package generation per Acquire / Shop card — needs partner-aware package construction logic (similar to Trade Studio's candidate generator but inverted for the user's send-side)

---

## Section 15: Build Order Recommendation

Suggested sequence to ship cleanly. Each step should produce a buildable commit.

### Phase 1 — Cleanup
1. **Delete** `ConfirmModal.tsx` and any references to it.
2. **Confirm retired** `LandingPage.tsx`, `CartSidebar.tsx`, `RosterModal.tsx` and any other v1.0 PP files no longer needed.
3. **`PartnerPickerModal.tsx`** — new modal for trade machine empty state. Standalone. Unblocks several entry paths.

### Phase 2 — Card primitives
4. **`AcquireCard.tsx`** — Player Card variant. Front (Topps + director quip + tap-to-view) + back (3 send-package options). Stub data initially.
5. **`ShopCard.tsx`** — Player Card variant. Front + back (3 packaging options). Stub data initially.

### Phase 3 — Landing surface
6. **`EmptyLanding.tsx`** — director's-voice empty state.
7. **`CardGrid.tsx`** — binder grid / swipe deck. May be shared with R&S and Scouting — coordinate at build.
8. **`/api/pro-personnel/landing`** (or extension to `/api/trades/targets`) — endpoint generating cards. Implement signal integrations one at a time:
   - 8a. R&S signal pulls (aging, value drift, position market, wants_more)
   - 8b. Partner team fit analysis (existing `/api/trades/targets` logic)
   - 8c. Pre-built package generation per card

### Phase 4 — Chat panel
9. **`ProScoutChatPanel.tsx`** — persistent right-rail (desktop) / pinned-input + takeover (mobile). Wire opener chips + Pro Scout placeholder.

### Phase 5 — Composition
10. **`PPHeaderBar.tsx`** — page title + action buttons.
11. **`ProPersonnelLanding.tsx`** — composes topbar + header bar + binder grid + chat panel. Mount at `/pro-personnel`.

### Phase 6 — Trade Studio Shop seed
12. **Wire `?seed=shop` into Trade Studio.** When PP Shop card routes to `/trade-studio?seed=shop`, the Trade Studio reads the package from sessionStorage (or query params), pre-marks the assets, and auto-runs Generate offers.

### Phase 7 — GM Office update
13. **Update GM Office Propose button** — confirm direct route to `/trade-builder` (no popover).
14. **Update GM Office Inbox aged indicators** — pending offer reminders previously surfaced on the PP landing now surface in the Inbox as aged-indicator chips next to relevant threads.
15. **Update CFC Insider feed** — completed league trades surface in the Insider drawer (already does this; no spec change needed, just confirming this is where they live now).

### Phase 8 — Polish
16. **Animation tuning** — flip timing, slide-off easing, package option hover.

---

## Section 16: Open Items / Deferred Decisions

These are NOT blockers for the PP build. They are flagged for build phase or later work:

1. **Director's-voice quip content engine.** Per-card quip generation (Acquire and Shop cards both need quips). LLM at request time vs. templated rules. Defer to build.
2. **Pre-built package generation logic.** Acquire send-packages and Shop packaging options need to be intelligent — fair value math, partner persona awareness, asset type fit. Likely extends Trade Studio's candidate generator. Defer to build.
3. **Persona icon mapping for team cards.** Partner team identity on Acquire cards may carry a small persona badge (chess knight for Architect, etc.). Defer to build — same deferral as the home screen spec.
4. **Championship rings on partner team chrome.** Same deferral. Defaults to 0 / no icon until data exists.
5. **Card empty states.** When `/api/pro-personnel/landing` returns zero cards, the empty state copy fires (Section 7). Final copy variants may differ by reason (truly nothing vs. all opportunities recently acted on vs. system data unavailable). Defer to build.
6. **Memo corner content engine.** When the director has a longer note on a player, the memo corner reveals a popover with the full note. Content engine same as quips — defer.
7. **Dismiss mechanic.** Whether cards support dismissal directly on the front (e.g., a small X to send-to-cooldown without flipping). Per master design: probably yes with a cooldown, but defer to build.
8. **Mobile dot compression** for sections with >12 cards (sliding window pattern). Threshold + animation TBD.
9. **Animation tuning** — flip timing, slide-off easing, package option transitions.
10. **Accessibility** — keyboard navigation, screen reader labels, focus states on cards.
11. **3-team trade flow from a PP card.** Acquire and Shop cards both land in 2-team mode. Adding a third team uses existing TradeBuilder "+Add team". No special PP flow needed.

---

## Section 17: Behavioral Notes

- **Default landing within the door:** `/pro-personnel`.
- **Logo click on topbar (any PP surface):** returns to home (org chart).
- **Back arrow on landing:** returns to home.
- **Back arrow inside Trade Builder / Trade Studio:** returns to the surface the user entered from (PP landing or GM Office). Defer routing detail to build.
- **Hamburger (mobile):** opens global nav drawer with all four doors + settings.
- **Header buttons on landing** (*Build a trade* / *Shop my guys*): direct route to the respective working surface.
- **Acquire card tap:** flip → 3 send-package options → tap one → route to Trade Builder pre-populated.
- **Shop card tap:** flip → 3 packaging options → tap one → route to Trade Studio Shop Around pre-seeded with offers generated.
- **Chat panel (desktop):** persistent right rail. Always visible while on the landing.
- **Chat panel (mobile):** pinned single-line input. Tap → full-screen chat takeover.
- **Trade Builder empty +Add from their roster:** partner-picker modal fires.
- **Memo corner tap (when present):** popover with full director note.
- **Toast:** existing pattern preserved (top-center, 3s auto-dismiss). Used for trade-builder and Studio confirmations.

---

## Section 18: Color Palette (Excerpt from Design System)

| Name | Hex | Usage on Pro Personnel |
|---|---|---|
| Ink | #1A1A1A | Borders, primary text, action buttons (filled state), chrome backgrounds |
| Paper | #FEFCF9 | Card backgrounds, button backgrounds, modal backgrounds, chat panel content bg |
| Cream | #F5F0E6 | Page background, hover states |
| Blue | #3366CC | Wants chips, partner team identifiers, balance chip variants (existing usage) |
| Yellow | #F5C230 | AI-element accent (existing usage), yellow-tier card urgency |
| Red | #E8503A | Untouchable chip on player cards (existing styling), red-tier card urgency |
| Green | #019942 | Moveable chip, *"In the range"* grade, green-tier card urgency. Universal green across the app — replaces prior #007370. |
| Muted | #8C7E6A | Secondary text, timestamps, position/team metadata, chat placeholder italic |

Full palette in `/docs/CFC-APP-STATUS.md`.

---

## Section 19: Typography (Excerpt from Design System)

| Font | Weight | Usage on Pro Personnel |
|---|---|---|
| Syne | 800–900 | Page title, card chrome (player name), section headers, button labels, action button labels, *"Tap to view"* label |
| DM Sans | 400–700 | Director's-voice quip text (in quotes on cards), package option labels, body prose, chat input placeholder (italic) |
| JetBrains Mono | 700 | Position / team chips, tab labels, balance chip text, marker chip text (STUD / YOUTH / AGING) |

Full system in `/docs/CFC-APP-STATUS.md`.

---

## Section 20: Summary — At-a-Glance

| Element | Decision |
|---|---|
| **Routing** | `/pro-personnel` (landing) · `/trade-builder` (trade machine) · `/trade-studio` (Trade Studio Shop Around, home of the Hero Card) |
| **Concept** | Director's briefing room. Director on the cards + Pro Scout in the chat |
| **Landing layout (desktop)** | 70% trading card binder grid (3 columns, 6–9 cards) + 30% persistent chat panel right rail |
| **Landing layout (mobile)** | Pinned-top action buttons + swipeable card deck (peek killed, dots only) + pinned-bottom chat input |
| **Card types (2)** | Acquire opportunity (Topps card of the target, flip → 3 send packages → Trade Builder) · Shop opportunity (Topps card of our player, flip → 3 packaging options → Trade Studio Shop Around) |
| **Universal flip pattern** | Every PP card flips. Front = identity + director quip + *"Tap to view"*. Back = 3 pre-built options → route to Trade Builder / Trade Studio with deal pre-populated |
| **Memo corner** | Optional on either card type when director has a longer attached note |
| **Card capacity** | Dynamic. Sorted red → yellow → green. Empty state shows director-voice copy *"Quiet out there. I'll keep watching."* |
| **Director urgency** | 3 tiers (green/yellow/red). Door tier = highest card tier on the landing. Pending offer urgency now lives in GM Office Inbox (aged indicators), not PP cards |
| **Chat surface** | Persistent right rail (~30%) on desktop · Pinned-input + takeover on mobile · 3 opener chips (locked) · *"Ask the Pro Scout…"* placeholder |
| **Opener chips (locked)** | *"Which teams might trade a first?"* · *"Who's hot in the trade market?"* · *"Which GMs are easiest to deal with?"* |
| **Header actions** | *Build a trade* · *Shop my guys* (always visible, desktop top / mobile pinned) |
| **Hero Card** | Lives ONLY in Trade Studio Shop Around. Killed from PP landing. Same `OfferCard.tsx` component, single surface |
| **Confirm Modal** | KILLED. Replaced by universal card flip pattern |
| **League insights** | Moved to GM Office. Pending offer reminders → Inbox aged indicators. Completed league trades → CFC Insider feed |
| **Trade Builder empty state** | + Add from their roster → partner-picker modal (search + team list) |
| **Trade Studio entry from Shop card** | `/trade-studio?seed=shop` → roster pre-marked + offers auto-generated → user lands on Hero Card cycler |
| **GM Office Propose** | Direct route to `/trade-builder` (popover killed) |
| **Killed** | `LandingPage.tsx` · `CartSidebar.tsx` · `RosterModal.tsx` · `ConfirmModal.tsx` · v1.0 3-section layout · v1.0 mobile snap-between-sections + IndicatorCluster · v1.0 dynamic-section-title topbar · Hero Card from PP landing · Top Targets / Top Trade Partners List Cards · League insights as a card type |
| **Cross-director signals** | Acquire cards read R&S wants_more + position market (buying) + league fit. Shop cards read R&S aging + value drift + position market (selling). Scouting → PP no direct flow |

---

## End of Spec — Ready for Build

The Pro Personnel v2.0 design is fully locked. Items intentionally deferred are content-engine choices (director's-voice quip generation, memo notes), pre-built package generation logic, and adjacent polish (animation tuning, accessibility). All locked items are buildable against existing components and naturally-extended APIs.

Pick this up in a build chat by attaching this document along with `/docs/CFC-APP-STATUS.md`, `CFC-HOME-SCREEN-SPEC.md`, `CFC-GM-OFFICE-SPEC.md`, `CFC-RESEARCH-STRATEGY-SPEC.md`, and `CFC-SCOUTING-SPEC.md`. The build chat should not need any conversation history beyond these six files to execute the build cleanly.
