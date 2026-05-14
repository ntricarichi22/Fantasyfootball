# CFC Front Office — Scouting Design Spec

**Version:** 1.0
**Date:** May 13, 2026
**Status:** Design locked — ready for mockup → code

---

## Purpose of This Document

This document captures every design decision for the **Scouting door** — the College Scout's briefing room landing, the live draft War Room, and the surfaces that connect them. It is the handoff spec for implementation. A new chat or developer should be able to read this document and execute the build without referring to prior conversation.

This document is **forward-looking**. The current implementation has no Scouting landing (the home screen's Scouting box routes directly into the War Room). This spec describes what the Scouting door becomes once it has a proper landing.

This spec must be read alongside:
- `/docs/CFC-APP-STATUS.md` (project-wide design system and non-negotiables)
- `CFC-HOME-SCREEN-SPEC.md` v2.1 (locked home screen — Scouting is one of three director doors)
- `CFC-GM-OFFICE-SPEC.md` (locked GM Office)
- `CFC-PRO-PERSONNEL-SPEC.md` (locked Pro Personnel — Scouting shares the binder-grid landing pattern with it)
- `CFC-RESEARCH-STRATEGY-SPEC.md` (locked R&S — Scouting reads R&S wants_more for trade-intel relevance)

The Scouting door is one of three directors reporting to the GM. Its lens is **looking forward** — the draft, the board, the rookies. The Scouting director's job is seasonal: quiet most of the year, busiest during draft prep and the live draft itself.

---

## Section 1: Concept & Metaphor

The Scouting door IS the **Director of Scouting's briefing room**. The user walks in and the director is already at the whiteboard with the board up. There are two voices in the room:

- **The Director of Scouting** — speaks on the cards. Has watched film, run the mocks, knows where the value sits in this class. *"Mendoza's sliding in the mocks — worth dropping him a few spots on our board."* The director prepared the board before you walked in.
- **The College Scout** — staff, not the director. Lives in the chat. Pulls scouting reports, runs comparisons, answers prospect questions. *"Compare two prospects for me"* / *"Who's rising on draft boards?"* The scout is at the keyboard while the director is at the whiteboard.

When the draft is live, the metaphor compresses — the door routes directly into the War Room and the briefing room collapses to the home screen's red-tier *"Boss, we're on the clock"* signal. The landing is for prep work; the War Room is for execution.

The metaphor governs everything that follows: card design (player-anchored cards visually anchored to real prospects), voice rules (director on the board, scout in the chat), the persistent chat panel, and the door's seasonal rhythm (mostly quiet, then suddenly the busiest department in the building).

---

## Section 2: Architecture & Routing

### Routes

| Route | Surface | Entry points |
|---|---|---|
| `/scouting` | Scouting landing (primary surface, this spec) | Home screen Scouting director box |
| `/scouting/war-room` | War Room (draft prep, draft live, draft results) | Scouting landing's "Set rankings" or "Enter draft" header actions; home screen Scouting box's contextual action button when draft is live |

### Mental model

Scouting has **two surfaces** inside the door:

1. **The Landing** — the binder grid of director-prepared findings (cards). Default when the user enters the door (outside of live draft).
2. **The War Room** — where draft work happens: setting rankings, the live draft itself, post-draft results. The landing routes here for any deeper draft work; the home screen's contextual action button skips the landing entirely when draft is live.

The chat panel (College Scout) is **only present on the landing**. The War Room is full-width execution mode; the scout is not visible there.

### What this replaces

The current Scouting implementation has no landing — `/scouting` either doesn't exist or routes straight to the War Room. This spec adds the landing as a proper surface and codifies the relationship between landing and War Room.

The War Room itself (`src/components/draft/`) is preserved with minor refinements (see Section 12). The big architectural change is adding the landing in front of it.

---

## Section 3: The Landing — Layout (Desktop, ≥768px)

```
┌──────────────────────────────────────────────────────────────────────┐
│  [InnerTopbar: ← back · league logo · settings]                       │
│  [Header bar: "Scouting" · Set rankings · Enter draft room]           │
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
│  ← scroll for more if any ─               │  └──────────────────────┘ │
│                                           │                            │
│                                           │  [Ask the College Scout…] │
└──────────────────────────────────────────┴───────────────────────────┘
   ← ~70% binder grid →                       ← ~30% chat panel →
```

- **InnerTopbar:** standard inner-page topbar (back arrow / league logo / settings). Inherits from GM Office spec.
- **Header bar:** page title left (*"Scouting"*); two action buttons right (*"Set rankings"*, *"Enter draft room"*).
- **Main content area (~70%):** trading card binder grid, 3 columns, multiple rows visible. Each card ~280×392 (5:7 playing card ratio). 6–9 cards visible at a glance. Cards sort by tier (red → yellow → green) and within tier by recency.
- **Right rail (~30%):** persistent chat panel. Two tabs (Active / History) at the top. Empty Active state shows the 3 locked opener chips (see Section 8). Input pinned at the bottom with placeholder *"Ask the College Scout…"* in muted italic DM Sans (#8C7E6A).
- **Click a card** → flips in place to reveal options / back content. No reflow, no modal.

### Tap-to-view affordance
Every Scouting card carries a universal action label at the bottom — *"Tap to view"* / *"Tap to update"* / similar — signaling the flip.

---

## Section 4: The Landing — Mobile Layout (<768px)

```
┌─────────────────────────────────┐
│  [topbar: hamburger / logo / ⚙] │
├─────────────────────────────────┤
│  [Set rankings] [Enter draft]   │  ← pinned action buttons
├─────────────────────────────────┤
│                                  │
│                                  │
│   ┌──────────────────────┐      │
│   │                       │      │
│   │ [single card front]   │      │  ← horizontal swipe deck
│   │                       │      │
│   │ "Tap to update"       │      │
│   └──────────────────────┘      │
│                                  │
│           • • • • •              │  ← dots indicator (peek killed)
│                                  │
├─────────────────────────────────┤
│  [Ask the College Scout…]       │  ← pinned chat input
└─────────────────────────────────┘
```

- **Top bar:** InnerTopbar mobile pattern (hamburger / logo / settings).
- **Pinned action buttons** below the topbar: *"Set rankings"* and *"Enter draft room"*. Always visible during card swiping.
- **Main content:** swipeable card deck. One card visible at a time. Horizontal swipe cycles through cards. **Peek of next card is killed.** Dots are the only swipe signal.
- **Pinned chat input** (bottom): single-line *"Ask the College Scout…"*. Tap or start typing → expands to full-screen chat takeover with the 3 opener chips in the empty Active state. Close → returns to the landing.
- **Scroll lock:** while a card is flipped, page-level scroll locks.

When the landing has zero cards, the swipeable deck is replaced by the empty state copy (Section 7), centered, no card.

---

## Section 5: Lenses

The Scouting director runs **3 lenses** against the user's board + draft state + R&S signals. Each lens can produce cards if its trigger fires. The director-prepared queue surfaces 3–9 cards at any given time, ordered by tier (red → yellow → green) then recency.

### 5.1 Rankings reminders (Memo Card)

Surfaces when the user's board needs attention. Two sub-types differentiated by urgency:

- **Initial** (yellow): *"Boss, time to set our board for this year. Let's get started."*
- **Urgency** (red, when ≤7 days to draft and board < 80% locked): *"Draft's a week out. Let's finalize the board."*

**Action:** Memo Card with universal action button (*"Tap to view"*) → flip → confirmation → route to Set Rankings inside the War Room. (Or: tap to view shows a brief preview of board completion state; primary action button routes.)

### 5.2 Rankings drift (Player Card)

Surfaces when the user's ranking on a player diverges meaningfully from consensus, in either direction:

- *"We have Mendoza in our top 10, but consensus has him outside the top 20. Are we missing something?"*
- *"Consensus has Bowers top 5; we have him at 18. Worth a re-look?"*

**Action:** Player Card with universal action button (*"Tap to update"*) → flip → inline rank adjuster. Make the change → DONE stamp → card slides off the landing.

This is the only Scouting lens that produces multiple cards at once (one per drifted player). Caps at ~5 simultaneous drift cards to keep the binder grid from overflowing on quiet draft-prep weeks; a "show more" affordance (or scroll into more rows) handles overflow.

### 5.3 Trade up/down intel (Player or Memo Card)

Surfaces when the director sees a draft-related trade opportunity. Two sub-types:

- **Trade up** (Player Card, anchored to a target prospect): *"Bowers is our top target but won't be there at our pick. Worth seeing what a trade up would cost?"*
- **Trade down** (Memo Card, when not anchored to one specific player): *"We're at #4. Three teams need a QB and would have to move up to get one. Worth seeing what they'd pay?"*

**Action:** Player Card or Memo Card with universal action button (*"Tap to view"*) → flip → 3 pre-built deal options → pick one → routes to Trade Builder with the deal pre-populated. Same pattern as Pro Personnel Acquire/Shop cards.

### 5.4 Class strength as input (NOT a standalone lens)

Class strength is a **signal input** to the Trade up/down intel lens, not its own card type. It feeds the trade intel director's decision of whether to fire a trade-up or trade-down card, and shapes the director's quip on those cards.

Example trade-up card with class strength baked in: *"Two studs in this class and they'll be gone by pick 4. We're at 7 and we said we want studs — worth seeing what a trade up costs?"*

Example trade-down card: *"Studs go in the top 2, then it's a flat class. We're at 6 — multiple teams behind us are in our tier. Worth shopping our pick for extra capital?"*

### 5.5 What was killed
- **Class recap (post-draft).** Not insightful enough to be its own card. Class recap if needed lives in War Room post-draft results.
- **On-the-clock card on the landing.** Once the draft is live, the home screen's Scouting box surfaces the *"Boss, we're on the clock. Let's go."* briefing with a contextual action button that routes directly to the War Room. The landing's role during live draft is moot — the user shouldn't be on the landing during live draft, they should be in the room. Old "On the clock" landing card concept killed.

### 5.6 Future draft classes (DEFERRED)
Surfacing rising prospects for next year's class is a great idea but requires a college football data layer we don't have today. **Deferred** as a future enhancement. Off-season Scouting will run quiet — door says *"Class is locked, settle in"*, landing has few or no cards.

### 5.7 Cross-director signals

Scouting reads from R&S's `wants_more` signal to shape its Trade up/down intel lens. *"We said we want studs"* → trade intel weighted toward grabbing studs early. This is one of the cross-director signal flows codified in `CFC-APP-STATUS.md` (Cross-Director Signal Flow section). Scouting → Pro Personnel has no direct flow — Scouting's draft trade intel stays in Scouting; its actions route to Trade Builder, but the surfacing happens here.

### 5.8 Urgency triggers per lens

| Lens | Yellow trigger | Red trigger |
|------|----------------|-------------|
| Rankings reminders | Initial sub-type when board < 80% set | Draft ≤ 7 days out + board < 80% set |
| Rankings drift | Drift detected (per-card tier) | Severe drift on a top-30 board player |
| Trade up/down intel | Opportunity detected | None — trade intel caps at yellow (not time-pressed enough for red) |

Door's overall tier = highest tier of any card on the landing (per master urgency rules).

---

## Section 6: Card Structure

Cards on the Scouting landing follow the universal card system locked in `CFC-APP-STATUS.md`. Two templates used here:

### Player Card (Rankings drift, Trade up/down intel when player-anchored)
- **Front:** photo, name, position chip, prospect class chip (e.g., *2026*), Rookie Card chip (signals it's a draft prospect not a veteran), director's quip, universal action button (*"Tap to update"* / *"Tap to view"*).
- **Back:** inline rank adjuster (drift) or 3 pre-built deal options (trade intel).
- **Memo corner:** optional, present when director has a longer note attached.

### Memo Card (Rankings reminders, Trade up/down intel when not player-anchored)
- **Front:** subject chrome (*"Re: Board prep"* / *"Re: Trading our 1.04"* / etc.), director's headline in quotes, optional supporting line, universal action button.
- **Back:** confirmation + route action (rankings reminders) or 3 pre-built deal options (trade down intel).
- **Memo corner:** N/A — the whole card IS a memo.

### Universal flip mechanic
Per master card system: tap action button → 3D rotateY flip ~300ms. Make change or pick option on the back → DONE stamp → card slides off. Route-out actions navigate after the flip (no need to stay on the back).

### Mobile flip state
Small X top-right of the back closes the flip without committing. Scroll locks while flipped.

---

## Section 7: Refresh, Empty State, Behavior

### Refresh mechanics
Landing computes **on page entry only**. User opens Scouting → engine runs the 3 lenses → picks cards by urgency and recency → renders. User acts on cards / dismisses them, deck shrinks. User leaves and returns later → fresh recompute.

**No manual refresh button.** Curated insights, not an endlessly-scrollable feed.

### Empty state
When the landing has 0 cards (off-season, board is locked, no drift, no trade intel), show the director's-voice empty state centered:

> *"Class is locked. We're ready."*

Optional sub-line if appropriate to the state (e.g., post-draft: *"Draft's wrapped. Board's on your desk."*). No empty-state card, no illustrations — just copy + the chat input as the obvious next move.

### Card priority sort
Cards sort top-to-bottom (desktop grid reading order, mobile deck order):
1. Red cards first
2. Yellow cards next
3. Green cards last
4. Within each tier, sort by recency / freshness

The home screen briefing previews the **top card on the landing** (Pattern A from the home screen spec).

---

## Section 8: Chat Panel — The College Scout

### Desktop (persistent right rail, ~30%)
Always visible while on the landing.

```
┌──────────────────────────┐
│ ┌────────┬─────────────┐ │  ← tabs at the very top (no header label)
│ │ Active │  History    │ │
│ └────────┴─────────────┘ │
├──────────────────────────┤
│ ┌──────────────────────┐ │  ← 3 opener chips when conversation empty
│ │ Compare two prospects│ │     fade out when conversation starts
│ │ for me               │ │
│ └──────────────────────┘ │
│ ┌──────────────────────┐ │
│ │ Who'll likely be     │ │
│ │ there at my pick?    │ │
│ └──────────────────────┘ │
│ ┌──────────────────────┐ │
│ │ Who's rising on      │ │
│ │ draft boards?        │ │
│ └──────────────────────┘ │
│                           │
│   [conversation thread]   │
│                           │
├──────────────────────────┤
│ [Ask the College Scout…] │  ← pinned input, muted italic placeholder
└──────────────────────────┘
```

- **No header label** — the input placeholder carries the role identity.
- **Tabs (Active / History) at the very top.**
- **Opener chips (3 locked):**
  - *"Compare two prospects for me"* (note: "prospects" not "players")
  - *"Who'll likely be there at my pick?"*
  - *"Who's rising on draft boards?"*
- **Chip behavior:** tap a chip → autofills the input (does not auto-send). User can edit before submitting.
- **Chip visibility:** shown in the empty Active state. Fade out when a conversation starts. Return when the user clears or starts a new conversation. History tab never shows chips.
- **Input placeholder:** *"Ask the College Scout…"* — muted italic DM Sans (#8C7E6A). Same treatment in both desktop and mobile.

### Mobile (pinned input → full-screen takeover)
Tap or start typing in the pinned input → full-screen chat takeover. Same Active / History tabs, same opener chips in the empty Active state. Close affordance (top-right) returns to the landing.

### Default state (no conversation yet)
Active tab shows the 3 opener chips + the input. No welcome screen, no fun fact, no extra copy.

### Conversation persistence
V1: localStorage. Move to backend deferred — not blocking.

---

## Section 9: Header Bar — Action Buttons

The Scouting landing has a persistent header bar between the topbar and the binder grid. **Desktop only** — on mobile, these buttons live in the pinned-top action row beneath the topbar.

### Composition (desktop)
```
[Scouting]                        [Set rankings]  [Enter draft room]
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
- **`Set rankings`** → routes to War Room's Set Rankings sub-surface
- **`Enter draft room`** → routes to War Room's live draft surface (or pre-draft staging when draft hasn't started yet)

These are co-equal entry points to the room, not escape hatches. The director's curated landing is the default surface, but the manual tools aren't a downgrade — power users skip the cards and go straight to the work.

### Mobile equivalent
The header bar is removed on mobile. The two buttons live in the **pinned action row** beneath the topbar, mirroring the R&S mobile pattern.

---

## Section 10: Topbar

Inherits from `CFC-GM-OFFICE-SPEC.md` — same `InnerTopbar` component on the Scouting landing.

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

Scouting does NOT use Pro Personnel's old dynamic-section-title topbar pattern (which is also being killed in the PP redesign). Center stays the league logo.

---

## Section 11: The War Room

The War Room is the existing draft surface (`src/components/draft/`). This spec doesn't redesign it — it codifies the relationship between the landing and the room, and locks one exception to the universal card system.

### Sub-surfaces inside the War Room
- **Set Rankings** — the board prep view. User ranks rookies, builds redshirt list, sets QB strategy, etc.
- **Live Draft** — the active draft room, with current pick on the clock, ticker, scout's-take modals, etc.
- **Draft Results** — post-draft summary, picks-made, grades.

These already exist in the codebase (see `src/components/draft/`). The Scouting landing's action buttons route into them.

### Scout's Take Card — exception to the universal flip pattern

The Scout's Take Card (`ScoutingCardModal.tsx`) appears during live draft when the user taps a player on the board. It's a Player Card variant:

- **Front:** photo + name + position chip + Rookie Card chip + *"Open scouting"* button
- **Back:** bio bar (age / height / weight / position), school + position line, *"Scout's Take"* header, 3 grade rows (Capital / Situation / Opportunity), Value/Fit meters, *"Draft Player"* button (only enabled when on the clock)

**Exception to universal flip:** during live draft, every second matters. Adding a flip animation costs the user a beat. The existing two-card desktop layout for Scout's Take stays as-is; single-card flip on mobile (the existing implementation already handles this). This is the one place in the app where we break the universal flip pattern, and we do it for a real reason.

If at build time the desktop two-card layout feels off against the rest of the system, revisit — but speed beats consistency here.

### Mobile bottom sheets
War Room mobile uses the existing bottom-sheet pattern for tab content (Roster / Asst GM / Trade). These are existing implementations and fit the new system; no changes needed. (See `MobileBottomSheet.tsx` and `MobileTabBar.tsx`.)

### Asst GM naming
The existing draft room references an "Asst. GM" panel (`AssistantGmPanel.tsx`). Under the new cast-of-voices rules, the staff voice for Scouting is the **College Scout**, not the Asst. GM. The Asst. GM concept is a pre-cast-of-voices artifact. At build time:
- Rename the AssistantGmPanel surface in the War Room to align with College Scout, OR
- Keep the panel as an in-draft assistant (different role: real-time pick advisor during the live draft) but rename so it's distinct from the College Scout on the landing.

Defer the naming call to build. The landing is the College Scout; the War Room's real-time draft assistant can be renamed if needed.

---

## Section 12: Behavioral Notes

- **Default landing within the door:** the Scouting landing (`/scouting`). Outside of live draft, this is what the user sees on entering the door.
- **Live draft routing:** home screen Scouting box's red-tier contextual action button (*"Enter the draft room"*) routes directly to `/scouting/war-room` — skipping the landing entirely. Click the door body instead → lands on the Scouting landing as normal.
- **Logo click on topbar (any Scouting surface):** returns to home (org chart).
- **Back arrow on landing:** returns to home.
- **Back arrow inside War Room sub-surfaces:** returns to either the Scouting landing or directly home, depending on entry point and War Room's existing back-stack behavior. Defer routing detail to build.
- **Hamburger (mobile):** opens global navigation drawer with all four doors + settings.
- **Header buttons on landing** (*Set rankings* / *Enter draft room*): direct route to the respective sub-surface. Always visible (desktop header bar; mobile pinned-top action row).
- **Landing card primary action:**
  - Rankings drift → flip + inline rank adjuster + DONE stamp + slide-off (no route-out)
  - Rankings reminders → flip + confirmation + route to Set Rankings inside the War Room
  - Trade up/down intel → flip + pick a deal option + route to Trade Builder pre-populated
- **Chat panel (desktop):** persistent right rail. Always visible while on the landing.
- **Chat panel (mobile):** pinned single-line input. Tap → full-screen chat takeover.

---

## Section 13: Items Killed in This Design Pass

These are concepts that surfaced during design and got cut:

1. **On-the-clock card on the landing.** Handled by the home screen door's red-tier briefing instead. User shouldn't be on the landing during live draft.
2. **Class recap card.** Not insightful. If post-draft summary is needed, it lives in War Room results.
3. **Standalone class strength card.** Class strength is plumbing — a signal input to the Trade up/down intel lens, not its own surface.
4. **Targets / target toggle lens.** During earlier design rounds, a "Target candidate" lens was proposed (mark players as targets via a toggle on the card). Killed: the board IS the target list. Top of the board = de facto targets. No separate target tag.
5. **Sleeper find lens.** Folded into Rankings drift (same action, different reasons).
6. **Pre-draft / time-sensitive / post-draft lens groupings.** Earlier drafts grouped lenses by season; the final 3 lenses span the full lifecycle and don't need explicit grouping in the spec.

---

## Section 14: Files Affected

### New components
- `src/components/scouting/ScoutingLanding.tsx` — top-level page composing topbar + header bar + binder grid + chat panel (desktop) / pinned-input (mobile). Mounts at `/scouting`.
- `src/components/scouting/CardGrid.tsx` — binder grid for desktop (3 columns); swipe deck for mobile. May be a shared component with R&S and Pro Personnel landings (see PP and R&S specs for cross-pollination opportunities).
- `src/components/scouting/RankingDriftCard.tsx` — Player Card variant for the Rankings drift lens. Front + back, inline rank adjuster on back.
- `src/components/scouting/RankingReminderCard.tsx` — Memo Card variant for the Rankings reminders lens.
- `src/components/scouting/TradeIntelCard.tsx` — Player or Memo Card variant for the Trade up/down intel lens. Front + back, 3 deal options on back.
- `src/components/scouting/ScoutingChatPanel.tsx` — persistent right-rail chat (desktop) / pinned-input + takeover (mobile). Wraps the historian-style chat with College Scout identity + 3 opener chips.
- `src/components/scouting/ScoutingHeaderBar.tsx` — landing's header bar (page title + Set rankings / Enter draft room buttons on desktop; mobile pinned-top action row).
- `src/components/scouting/EmptyLanding.tsx` — empty-state copy in director's voice.

### Reuse / adapt
- `src/components/draft/*` — War Room components, preserved with minor refinements:
  - `AssistantGmPanel.tsx` — rename to align with College Scout naming, or keep as War Room real-time advisor with a different name. Defer to build.
  - `ScoutingCardModal.tsx` — Scout's Take Card, preserved as the universal-flip-pattern exception during live draft.
  - `WelcomeScreen.tsx` — review against new system; may need updates for the new cast-of-voices voice rules.
- `src/components/draft/mobile/MobileDraftRoom.tsx` — War Room mobile entry, preserved.
- `src/components/draft/mobile/MobileFlipCardModal.tsx` — preserved.
- `src/components/draft/mobile/MobileHamburgerMenu.tsx` — preserved.
- `src/components/draft/mobile/MobileTabBar.tsx` — preserved.
- `src/components/draft/mobile/MobileTopBar.tsx` — preserved (matches InnerTopbar mobile pattern).
- `src/components/draft/mobile/MobileBottomSheet.tsx` — preserved (existing tab content sheets).

### New / extended APIs
- `/api/scouting/landing` — generates the landing cards (runs the 3 lenses, returns sorted card list)
- `/api/scouting/dismiss` — records dismissal (if dismiss is supported on Scouting cards; defer to build)
- `/api/scouting/act` — records that a card's action was taken (for cooldown / no resurfacing)
- Extension to existing rankings endpoints for the inline rank adjuster

### Data wiring
- User's draft board state (rankings, set-status, drift signals vs. consensus boards)
- Days-to-draft countdown
- R&S `wants_more` signal (for Trade up/down intel relevance)
- Mock draft signals (which players likely fall to user's pick) for Trade intel
- Class strength data (per-position depth / stud count for the year) for Trade intel signals

---

## Section 15: Build Order Recommendation

Suggested sequence to ship cleanly without broken intermediate states. Each step should produce a buildable commit.

### Phase 1 — Card primitives
1. **`RankingDriftCard.tsx`** — Player Card variant. Front + back, inline rank adjuster. Stub data initially.
2. **`RankingReminderCard.tsx`** — Memo Card variant. Subject chrome + headline + action.
3. **`TradeIntelCard.tsx`** — Player or Memo Card variant. Front + back, 3 deal options on back.

### Phase 2 — Landing surface
4. **`EmptyLanding.tsx`** — director's-voice empty state.
5. **`CardGrid.tsx`** — binder grid / swipe deck. May be shared with PP and R&S — check cross-pollination at build.
6. **`/api/scouting/landing`** — endpoint generating cards. Implement lenses one at a time:
   - 6a. Rankings reminders (state-driven, simplest)
   - 6b. Rankings drift (needs consensus board comparison data)
   - 6c. Trade up/down intel (needs mock draft data + R&S signal integration)

### Phase 3 — Chat panel
7. **`ScoutingChatPanel.tsx`** — persistent right-rail (desktop) / pinned-input + takeover (mobile). Wire opener chips + College Scout placeholder.

### Phase 4 — Composition
8. **`ScoutingHeaderBar.tsx`** — page title + action buttons.
9. **`ScoutingLanding.tsx`** — composes topbar + header bar + binder grid + chat panel. Mount at `/scouting`.

### Phase 5 — War Room refinements
10. **`AssistantGmPanel.tsx` rename / refactor** — align with College Scout naming or distinguish as live-draft real-time advisor.
11. **`WelcomeScreen.tsx` voice pass** — update copy against the new cast-of-voices rules if needed.
12. **Scout's Take Card review** — confirm the universal-flip-pattern exception is right; tune at mockup.

### Phase 6 — Polish
13. **Wire home screen Scouting door's contextual action button** — *"Enter the draft room"* skips the landing on red-tier (draft live).
14. **Animation tuning** — flip timing, slide-off easing, stamp landing on Rankings drift inline edits.

---

## Section 16: Open Items / Deferred Decisions

These are NOT blockers for the Scouting build. They are flagged for build phase or later work:

1. **Future draft classes lens.** Surfacing rising prospects for next year's class. Requires college football data infrastructure we don't have. Deferred.
2. **Rankings drift card volume management.** When does drift cross the threshold from "interesting" to "surface a card"? How many simultaneous drift cards is too many? Tune at build.
3. **Asst. GM panel naming.** Rename to College Scout, or keep distinct as a live-draft real-time advisor. Decide at build.
4. **Class strength data wiring.** Needs per-class per-position depth signals. Defer to build if data layer needs work.
5. **Mock draft signal source.** "Who's likely to fall to our pick" needs a data source — internal mock simulator, external aggregated mocks, or both. Defer to build.
6. **R&S signal integration.** Reading `wants_more` from R&S into Trade up/down intel scoring. Build-time wiring against existing R&S strategy profile data.
7. **Director's voice content engine.** Per-card quip generation — LLM at request time vs. templated rules. Same decision as PP and R&S, applied to Scouting.
8. **Dismiss mechanic.** Does dismissal exist on Scouting cards the way it does on R&S Wall cards? Defer — likely yes with a cooldown but not blocking.
9. **Inline rank adjuster animation.** The +/– adjuster on Rankings drift card backs. Tune at mockup.
10. **Backend persistence for chat conversations.** V1: localStorage. V2: backend.

---

## Section 17: Color Palette (Excerpt from Design System)

| Name | Hex | Usage on Scouting |
|---|---|---|
| Ink | #1A1A1A | Borders, primary text, chrome backgrounds, action buttons (filled state) |
| Paper | #FEFCF9 | Card backgrounds, chat panel content bg |
| Cream | #F5F0E6 | Page background |
| Blue | #3366CC | Primary action buttons, Rookie Card chip accent (TBD at mockup) |
| Green | #019942 | Green urgency states (card-level + door-level chip) |
| Yellow | #F5C230 | Yellow urgency chip on cards, Rankings reminders attention sub-type |
| Red | #E8503A | Red urgency chip on cards, Rankings reminders urgency sub-type, draft-live state |
| Muted | #8C7E6A | Secondary text, timestamps, subject line text in Memo Card chrome, dot indicators, chat placeholder italic |

Full palette in `/docs/CFC-APP-STATUS.md`.

---

## Section 18: Typography (Excerpt from Design System)

| Font | Weight | Usage on Scouting |
|---|---|---|
| Syne | 800–900 | Page title, card chrome (player name, round name), section headers, action button labels, *"DONE"* stamp |
| DM Sans | 400–700 | Director's-voice headlines (in quotes on cards), body prose, meta line text, chat input placeholder (italic) |
| JetBrains Mono | 700 | Subject lines (*Re: ...*) on Memo Cards, position / class / Rookie chips, tab labels, *"Tap to view"* / *"Tap to update"* labels |

Full system in `/docs/CFC-APP-STATUS.md`.

---

## Section 19: Summary — At-a-Glance

| Element | Decision |
|---|---|
| **Routing** | `/scouting` (landing) · `/scouting/war-room` (live draft + sub-surfaces) |
| **Concept** | College Scout's briefing room. Director on the cards + College Scout in the chat |
| **Landing layout (desktop)** | 70% trading card binder grid (3 columns, 6–9 cards) + 30% persistent chat panel right rail |
| **Landing layout (mobile)** | Pinned-top action buttons + swipeable card deck (peek killed, dots only) + pinned-bottom chat input |
| **Card lens types (3)** | Rankings reminders (Memo) · Rankings drift (Player) · Trade up/down intel (Player or Memo) |
| **Class strength** | Signal INPUT to Trade intel lens, not its own card |
| **Card capacity** | 3–9 cards dynamic, sorted red → yellow → green. Empty state shows director's voice copy |
| **Universal flip pattern** | Every landing card flips. Front = identity + *"Tap to view"* / *"Tap to update"*. Back = action / editor / 3 deal options |
| **Memo corner** | Optional on player-anchored cards when director has a longer note |
| **Director urgency** | 3 tiers (green/yellow/red). Door tier = highest card tier on the landing |
| **Empty state** | *"Class is locked. We're ready."* (director voice) |
| **Chat surface** | Persistent right rail (~30%) on desktop · Pinned-input + takeover on mobile · 3 opener chips (locked) · *"Ask the College Scout…"* placeholder |
| **Opener chips (locked)** | *"Compare two prospects for me"* · *"Who'll likely be there at my pick?"* · *"Who's rising on draft boards?"* |
| **Header actions** | *Set rankings* · *Enter draft room* (always visible, desktop top / mobile pinned) |
| **War Room** | Existing surface preserved (Set Rankings + Live Draft + Results). Scouting landing routes into it |
| **Scout's Take Card** | Exception to universal flip pattern. Existing two-card desktop layout preserved; mobile flip already implemented |
| **Live draft routing** | Home screen Scouting box red-tier action button routes directly to War Room, skipping landing |
| **Asst. GM panel** | Rename / refactor at build to align with College Scout naming or distinguish as live-draft real-time advisor |
| **Cross-director signals** | Reads R&S `wants_more` for Trade intel relevance. Scouting → PP no direct flow |
| **Killed** | On-the-clock landing card · Class recap card · Standalone class strength card · Target toggle / Targets lens · Sleeper find lens (folded into drift) |

---

## End of Spec — Ready for Build

The Scouting design is fully locked. Items intentionally deferred are content-engine choices (director's-voice generation), data-wiring (class strength, mock signals, R&S integration), and naming polish (Asst. GM panel). All locked items are buildable today against existing draft components and naturally-extended APIs.

Pick this up in a build chat by attaching this document along with `/docs/CFC-APP-STATUS.md`, `CFC-HOME-SCREEN-SPEC.md`, `CFC-GM-OFFICE-SPEC.md`, `CFC-PRO-PERSONNEL-SPEC.md`, and `CFC-RESEARCH-STRATEGY-SPEC.md`. The build chat should not need any conversation history beyond these six files to execute the build cleanly.
