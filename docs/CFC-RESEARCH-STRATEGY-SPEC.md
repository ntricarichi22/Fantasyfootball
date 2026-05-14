# CFC Front Office — Research & Strategy Design Spec

**Version:** 2.0 (revised)
**Date:** May 13, 2026
**Status:** Design locked — ready for mockup → code

> **Revision note (v2.0, May 13, 2026):** Major redesign from v1.0 following the May 12, 2026 master design session. The landing is now a **trading card binder grid** of individual cards (matching Pro Personnel and Scouting) instead of the prior 2-up wall queue. **Lens set updated to 6 lenses** with **Settings staleness killed as a standalone lens** (staleness = the buildup of other unaddressed cards) and **Wants More suggestion added as a new lens**. R&S is now **purely settings** — no trade cards. Aging signals flow to Pro Personnel Shop cards, not R&S. **4 update types** on flip-backs: availability tier, value (price), position market, wants more. **Set Strategy cards become Selector Cards** with the universal flip + confirmation stamp pattern. **Set Availability availability popover is killed** — tier picker now lives on the back of the Player Card. **Set Availability Pick Card preserved as a List Card** (the only management surface still using the List Card template). **Research Analyst chat panel** locked with 3 opener chips, no header label, identity in placeholder. Universal green color #019942 (replaces prior #007370).

---

## Purpose of This Document

This document captures every design decision for the **Research & Strategy door** — the strategist's war room landing, its Set Strategy and Set Availability sub-pages, and the card system that lives within. It is the handoff spec for implementation. A new chat or developer should be able to read this document and execute the build without referring to prior conversation.

This document is **forward-looking**. It describes what Research & Strategy becomes, not what it currently is.

This spec must be read alongside:
- `/docs/CFC-APP-STATUS.md` (project-wide design system and non-negotiables)
- `CFC-HOME-SCREEN-SPEC.md` v2.1 (locked home screen — R&S is one of three director doors)
- `CFC-GM-OFFICE-SPEC.md` (locked GM Office)
- `CFC-PRO-PERSONNEL-SPEC.md` v2.0 (locked PP — Pro Personnel consumes R&S signals; aging, value drift, position market, wants more)
- `CFC-SCOUTING-SPEC.md` (locked Scouting — Scouting reads R&S wants_more for trade-intel relevance)

Research & Strategy is the third of three director doors reporting to the GM. Its lens is **looking inward** — our team, our preferences, the data that informs our plan.

---

## Section 1: Concept & Metaphor

The R&S door IS the **strategist's war room**. The user walks in and the work is already on the wall — settings updates the strategist has prepared, stacked as cards in a binder. Each card is one specific tweak to how the team is configured: a tier change for a player, a price update, a position market shift, a wants-more toggle. The user works through them — taps to update, picks the right setting, the card slides off the wall — until the binder is clear.

Two voices in the room:

- **The Director of Research & Strategy** — speaks on the cards. Strategic, curated, sees-the-big-picture. *"We have Mahomes marked moveable but he's critical to us. Worth a look."* The director prepared the wall before you walked in.
- **The Research Analyst** — staff, not the director. Lives in the chat. Pulls data, answers questions, runs league lookups. *"How does my roster compare to last year's title teams?"* / *"What's my biggest roster weakness?"* The analyst is at the keyboard while the director is at the whiteboard.

R&S is **purely settings**. The director surfaces cards that fix settings (tier, value, market, wants); those settings then ripple out to the rest of the app as signals (Pro Personnel reads aging + value drift + position market → produces Shop cards; Scouting reads wants_more → weighs trade-up/down intel). R&S is the source of strategic truth; the other doors consume from it.

This is different from v1.0, which considered surfacing trade cards on the wall. Trade cards live in Pro Personnel. R&S stays focused — settings updates only.

---

## Section 2: Architecture & Routing

### Routes

| Route | Surface | Entry points |
|---|---|---|
| `/research-strategy` | The Wall (door landing — primary surface) | Home screen R&S director box |
| `/research-strategy/set-strategy` | Set Strategy sub-page | *"Set Strategy"* button in the wall's header |
| `/research-strategy/set-availability` | Set Availability sub-page | *"Set Availability"* button in the wall's header |

### Mental model

Three surfaces inside one door:

1. **The Wall (binder grid)** — door's landing. Trading card binder grid of settings-update cards (the strategist's findings) + persistent right-rail chat (the Research Analyst). Default surface — what the user lands on when they walk into the door.
2. **Set Strategy** — sub-page for editing wants_more + position markets. Selector Cards for both card sets.
3. **Set Availability** — sub-page for editing per-player attachment + per-asset values. Position-grouped layout with Player Cards (per player) and Pick Cards (per round).

The chat panel is **only present on the Wall**. Sub-pages are full-width work surfaces; the analyst is not visible there.

Sub-pages are full-screen takeovers reached via header buttons on the Wall. Back arrow on the InnerTopbar returns to the Wall.

### Why the door has sub-pages (when other doors don't)

GM Office, Pro Personnel, and Scouting don't use sub-pages — they have a single landing surface with peripheral elements (drawers, popovers, the binder grid). R&S earns sub-pages because the Wall is *briefing mode* (the strategist surfaces specific findings) while the editing of all strategy and availability across the whole roster is *work mode* (the user makes every call per option or per player). Trying to do all three jobs on one surface would compromise each one. Sub-pages keep each surface honest about its purpose.

### What this replaces

- The old "Owner's Box" door (`OwnersBoxView.tsx`) and its three tabs — Strategy / Depth Chart / Trade Chart. Depth Chart was already killed pre-spec. Strategy + Trade Chart are reborn as Set Strategy + Set Availability sub-pages.
- The old standalone Historian (`HistorianChat.tsx`) is folded into the Wall as the persistent chat panel; standalone route to the Historian is killed.
- The v1.0 R&S 2-up wall queue layout is **replaced by the binder grid pattern** (matches PP and Scouting).
- The v1.0 settings staleness lens is **killed** (staleness is now an emergent property of unaddressed cards, not a card itself).
- The v1.0 Set Availability availability popover is **killed** (tier picker moves to the back of the Player Card).

---

## Section 3: The Wall — Layout (Desktop, ≥768px)

```
┌──────────────────────────────────────────────────────────────────────┐
│  [InnerTopbar: ← back · league logo · settings]                       │
│  [Header bar: "Research & Strategy" · Set Strategy · Set Availability]│
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
│  ← scroll for more ──                     │  │ [opener chip 2]      │ │
│                                           │  └──────────────────────┘ │
│                                           │  ┌──────────────────────┐ │
│                                           │  │ [opener chip 3]      │ │
│                                           │  └──────────────────────┘ │
│                                           │                            │
│                                           │  [Ask the Research Analyst…]│
└──────────────────────────────────────────┴───────────────────────────┘
   ← ~70% binder grid →                       ← ~30% chat panel →
```

- **InnerTopbar:** standard inner-page topbar (back arrow / league logo / settings). Inherits from GM Office spec.
- **Header bar:** page title left (*"Research & Strategy"*); two action buttons right (*"Set Strategy"*, *"Set Availability"*).
- **Main content area (~70%):** trading card binder grid, 3 columns, multiple rows visible. Each card ~280×392 (5:7 playing card ratio). 6–9 cards visible at a glance. Cards sort by tier (red → yellow → green) and within tier by recency.
- **Right rail (~30%):** persistent chat panel. Two tabs (Active / History) at the top. Empty Active state shows the 3 locked opener chips (see Section 8). Input pinned at the bottom with placeholder *"Ask the Research Analyst…"* in muted italic DM Sans (#8C7E6A).
- **Click a card** → flips in place to reveal the settings update mechanism. No reflow, no modal.

### Tap-to-update affordance
Every R&S wall card carries a universal action label at the bottom — *"Tap to update"* — signaling the flip into the update mechanism. This is consistent across all 6 lens types because R&S is purely settings updates.

---

## Section 4: The Wall — Mobile Layout (<768px)

```
┌─────────────────────────────────┐
│  [topbar: hamburger / logo / ⚙] │
├─────────────────────────────────┤
│  [Set Strategy] [Set Availability]│  ← pinned action buttons
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
│  [Ask the Research Analyst…]    │  ← pinned chat input
└─────────────────────────────────┘
```

- **Top bar:** InnerTopbar mobile pattern (hamburger / logo / settings).
- **Pinned action buttons** (immediately below topbar): *"Set Strategy"* and *"Set Availability"*. Always visible during card swiping.
- **Main content:** swipeable card deck. One card visible at a time. Horizontal swipe cycles through the cards. **Peek of next card is killed.** Dots are the only swipe signal.
- **Pinned chat input** (bottom): single-line *"Ask the Research Analyst…"*. Tap or start typing → expands to full-screen chat takeover. Close → returns to the Wall.
- **Scroll lock:** while a card is flipped, page-level scroll locks.

When the wall has zero cards, the swipeable deck is replaced by the empty state copy (Section 7), centered, no card.

---

## Section 5: The Wall — Lens Set & Update Types

The strategist runs **6 lenses** against the user's roster + strategy + league data. Each lens can produce a card if its trigger fires. Cards live on the Wall until the user taps to update (slides off after confirmation) or dismisses them (28-day cooldown). All cards funnel into one of **4 update types** on the flip-back.

### 5.1 Lenses (6)

1. **Aging player** (Player Card) — *"Mahomes hit aging at QB. His curve's headed down."*
   → **Flip-back:** availability tier picker (the recommended setting is the next tier down — e.g., from Core to Listening)

2. **Value drift** (Player Card) — *"Lamb's CFC value moved 15% in two weeks."*
   → **Flip-back:** price adjuster (manual override editor)

3. **Attachment mismatch** (Player Card) — *"We've got him moveable, but his value puts him top-3 on our roster."*
   → **Flip-back:** availability tier picker

4. **Position misalignment** (Memo Card) — *"Our WR room ranks bottom-3 — should we be buying?"*
   → **Flip-back:** position market editor (Buying / Holding / Selling)

5. **Wants More suggestion** (Memo Card, NEW) — *"We're light on picks — let's signal that we want more."*
   → **Flip-back:** wants more toggle (on/off)

6. **Championship comparison** (Player or Memo Card) — *"Title teams stack WRs — we should mark Lamb untouchable."*
   → **Flip-back:** whichever update fits (tier picker, market editor, or wants toggle depending on the specific comparison)

### 5.2 Update Types (4) on flip-backs

Every card front routes to one of these 4 update mechanisms:

| Update type | UI | Effect |
|-------------|----|----|
| **Availability tier** | 4-button tier picker (Untouchable / Core / Listening / Moveable) | Writes to `cfc_team_player_attachment.tier` |
| **Value (price)** | Inline price editor with +/− buttons or text input | Writes to `cfc_team_player_value_overrides.value_override` |
| **Position market** | 3-button picker (Buying / Holding / Selling) | Writes to position market field on `cfc_team_strategy_profiles` |
| **Wants More** | On/off toggle for the suggested wants_more category (picks / studs / youth / depth) | Adds or removes the category from `wants_more` array |

### 5.3 Settings staleness — killed as a standalone lens

The v1.0 spec included Settings staleness as a 7th lens (firing when strategy hadn't been refreshed in 28+ days). **Killed in v2.0.** Staleness is now an emergent property of unaddressed cards — if the user ignores the binder for weeks, the buildup of lens-fired cards becomes the staleness signal. Fix the cards, staleness solves itself.

### 5.4 R&S is purely settings — no trade cards

The v1.0 spec briefly considered surfacing trade-related cards on the Wall (e.g., aging player → shop suggestion routing to Trade Studio). **Killed in v2.0.** R&S stays focused on settings updates only.

When a signal could imply both a settings update AND a trade action (e.g., Mahomes hit aging), R&S surfaces the settings update card (*"Drop him to Listening?"*); Pro Personnel separately surfaces a Shop opportunity card on its own landing (*"Mahomes' value is peaking — sell high while we can"*). Two cards on two surfaces, each in the right domain. Build-time consideration: cooldown logic to avoid both firing redundantly is logged in `CFC-APP-STATUS.md` cross-director signal concerns.

### 5.5 Urgency triggers per lens

| Lens | Yellow trigger | Red trigger |
|---|---|---|
| Aging player | Aging asset detected with attachment ≠ Listening / Moveable | Top-3 roster player aging + attachment Untouchable / Core |
| Value drift | Drift ≥10% from CFC consensus | Drift ≥20% AND override stale 60+ days |
| Attachment mismatch | Tag/value mismatch | Top-3 player tagged Moveable for 28+ days |
| Position misalignment | Position ranks bottom-half league | Bottom-3 league rank AND market not adjusted in 28+ days |
| Wants More suggestion | Suggestion detected (matching roster condition + unset wants_more) | Never red — wants_more is aspirational, not time-pressed |
| Championship comparison | Always informational | Never red — strategic, no urgent action |

Door's overall tier on the home screen = highest tier of any wall card (per master urgency rules from `CFC-APP-STATUS.md`).

---

## Section 6: Card Structure & Mechanics

Cards on the Wall follow the universal card system locked in `CFC-APP-STATUS.md` (Card System section). Two templates used:

### Player Card (Aging, Value drift, Attachment mismatch, Championship when player-anchored)
- **Front:** Topps-style identity (photo, name, position/team/age chrome) + marker chips (STUD / YOUTH / AGING) + optional memo corner + director's quip in quotes + universal action button (*"Tap to update"*).
- **Back:** the appropriate update mechanism (tier picker / price adjuster).
- **Memo corner:** optional, present when director has a longer note attached. Travels with the player across surfaces (same memo corner appears on the player's Set Availability Player Card).

### Memo Card (Position misalignment, Wants More suggestion, Championship when not player-anchored)
- **Front:** subject chrome (*"Re: WR alignment"* / *"Re: Wants more — picks"* / *"Re: Title teams at WR"*) + director's headline in quotes + optional supporting line + universal action button.
- **Back:** the appropriate update mechanism (market editor / wants toggle / whichever update fits the championship comparison).
- **Memo corner:** N/A — the whole card IS a memo.

### Universal flip mechanic
Per master card system:
- Tap *"Tap to update"* → 3D rotateY flip, ~300ms ease-out
- Make the update on the back → DONE stamp lands (~200ms), brief pause, card slides off the wall (~300ms)
- Next card promotes up
- **Mobile:** small X top-right of the back closes the flip without committing; page-level scroll locks while flipped

### Dismiss mechanic
Each card has a *"Not now"* dismiss action on the front (or as a secondary back option, TBD at mockup — lean front for visibility).
- Tap *"Not now"* → card slides off without flipping, no stamp
- **28-day cooldown.** The lens won't re-surface that card for 28 days. After cooldown, if the underlying condition still holds, the card can return.

### Acted-on cards
No cooldown. The card only resurfaces if the underlying condition recurs naturally later (e.g., the user moves Lamb back to Listening after marking him Untouchable, and the championship lens fires again).

### Card priority sort
Cards sort top-to-bottom on desktop (grid reading order) and through the mobile deck:
1. Red cards first
2. Yellow cards next
3. Green cards last
4. Within each tier, sort by recency / freshness

The home screen briefing previews the **top card on the wall** (Pattern A from the home screen spec).

---

## Section 7: Refresh, Empty State, Behavior

### Refresh mechanics
Wall computes **on page entry only**. User opens R&S → engine runs all 6 lenses → picks cards by urgency and recency → renders. User acts on cards / dismisses them, wall shrinks. User leaves and returns later → fresh recompute.

**No manual refresh button.** Wall is curated settings updates, not an endlessly-scrollable feed.

### Empty state
When the Wall has 0 cards, show the director's-voice empty state centered:

> *"Roster's set, signals are clean. I'll flag anything that shifts."*

No empty-state card, no illustrations — just copy + the visible chat input as the obvious next move. The director's-voice empty state is the locked pattern across all three director landings (per APP-STATUS Empty State Voice Rules).

---

## Section 8: Chat Panel — The Research Analyst

### Desktop (persistent right rail, ~30%)
Always visible while on the Wall.

```
┌──────────────────────────┐
│ ┌────────┬─────────────┐ │  ← tabs at the very top (no header label)
│ │ Active │  History    │ │
│ └────────┴─────────────┘ │
├──────────────────────────┤
│ ┌──────────────────────┐ │  ← 3 opener chips when conversation empty
│ │ How does my roster   │ │     fade out when conversation starts
│ │ compare to last      │ │
│ │ year's title teams?  │ │
│ └──────────────────────┘ │
│ ┌──────────────────────┐ │
│ │ What's my biggest    │ │
│ │ roster weakness?     │ │
│ └──────────────────────┘ │
│ ┌──────────────────────┐ │
│ │ Who's won the most   │ │
│ │ CFC championships?   │ │
│ └──────────────────────┘ │
│                           │
│   [conversation thread]   │
│                           │
├──────────────────────────┤
│ [Ask the Research Analyst…]│  ← pinned input, muted italic placeholder
└──────────────────────────┘
```

- **No header label** (the v1.0 *"RESEARCH ANALYST"* label is killed). The input placeholder carries the role identity.
- **Tabs (Active / History) at the very top.**
- **Opener chips (3 locked):**
  - *"How does my roster compare to last year's title teams?"*
  - *"What's my biggest roster weakness?"*
  - *"Who's won the most CFC championships?"*
- **Chip behavior:** tap a chip → autofills the input (does not auto-send). User can edit before submitting.
- **Chip visibility:** shown in the empty Active state. Fade out when a conversation starts. Return when the user clears or starts a new conversation. History tab never shows chips.
- **Input placeholder:** *"Ask the Research Analyst…"* — muted italic DM Sans (#8C7E6A). Same treatment in both desktop and mobile.

### Mobile (pinned input → full-screen takeover)
Tap or start typing in the pinned input → full-screen chat takeover. Same Active / History tabs, same opener chips in the empty Active state. Close affordance (top-right) returns to the Wall.

### Default state (no conversation yet)
Active tab shows the 3 opener chips + the input. No welcome screen, no fun facts, no extra copy.

### Conversation persistence
V1: localStorage (existing pattern from `HistorianChat`). Move to backend deferred — not blocking.

### Reuse vs. rebuild
The existing `HistorianChat` component handles conversation logic, message rendering, markdown parsing, and the API call. Adapt:
- Strip the existing left-side conversation sidebar (won't fit at 360px wide)
- Add the two-tab structure (Active / History)
- Kill the existing header label
- Kill the welcome screen and suggested prompt cards (replaced by 3 locked opener chips with autofill behavior)
- Plug into the wall's right rail or mobile pinned-input pattern

---

## Section 9: Set Strategy Sub-Surface

Sub-page for editing wants_more (Wants More) and position markets (Position Markets). Reached via *"Set Strategy"* button in the Wall's header. **All cards are now Selector Cards** with the universal flip + confirmation stamp pattern from the master card system.

### Layout (Desktop, ≥768px)

```
┌──────────────────────────────────────────────┐
│  [InnerTopbar: ← / logo / settings]           │
│  [Set Strategy]                                │
├──────────────────────────────────────────────┤
│                                                │
│  ───── WHERE WE'RE GOING ─────────────         │
│                                                │
│  ┌──────┐  ┌──────┐  ┌──────┐  ┌──────┐       │
│  │PICKS │  │STUDS │  │YOUTH │  │DEPTH │       │  ← 4 Selector Cards
│  └──────┘  └──────┘  └──────┘  └──────┘       │
│                                                │
│  ───── WHERE WE STAND ─────────────            │
│                                                │
│  ┌──────┐  ┌──────┐  ┌──────────┐  ┌──────┐   │
│  │ QB   │  │ RB   │  │PASS CATCH│  │PICKS │   │  ← 4 Selector Cards
│  └──────┘  └──────┘  └──────────┘  └──────┘   │
│                                                │
└──────────────────────────────────────────────┘
```

- **InnerTopbar:** back / logo / settings. Page title *"Set Strategy"* in the content area below the topbar (not in the topbar itself).
- **No header action buttons** — already on a sub-page; button repetition would be redundant.
- **No chat panel.** Sub-pages are full-width work mode. Director's quip baked into the per-card prose (where applicable).
- **Two horizontal-rail sections:** *Where we're going* (Wants More) + *Where we stand* (Position Markets). Both rails fit the viewport simultaneously without page scroll on a typical 800px+ viewport.
- **Section bars:** existing SectionBar pattern (black rectangle bookend + horizontal rule). Section dividers KEEP on management screens per `CFC-APP-STATUS.md`.

### Section copy (locked)
- Wants More section header: ***"Where we're going"***
- Position Markets section header: ***"Where we stand"***

### Wants More cards (4) — Selector Card template
Cards: **Picks**, **Studs**, **Youth**, **Depth**.

Per master card system:
- **Front:** identity stamp (*"PICKS"* / *"STUDS"* / *"YOUTH"* / *"DEPTH"*), current on/off state, optional director quip referencing the user's roster reality (*"Our roster is averaging 27.5 at WR. Worth prioritizing youth."*), universal action button (*"Toggle"*).
- **Back:** the toggle mechanism — single on/off selector. Tap to confirm.
- After confirmation: DONE stamp lands (variant: *"Selected"* or *"Deselected"*), auto-flips back to front showing the new state.

### Position Market cards (4) — Selector Card template
Cards: **QB**, **RB**, **Pass Catchers**, **Picks**.

Pass Catchers consolidates WR + TE into a single bucket (see Section 17 for data-model implications).

Per master card system:
- **Front:** position label (*"QB"* / *"RB"* / *"PASS CATCHERS"* / *"PICKS"*), roster preview (top 3 QB / top 3 RB / top 5 pass catchers / pick round breakdown), current state stamp (*"BUYING"* / *"HOLDING"* / *"SELLING"*), optional director quip, universal action button (*"Edit"*).
- **Back:** 3 buttons (*Buying* / *Holding* / *Selling*). Tap one → flip back showing the new state with a DONE stamp.

### Vocabulary
**"Buying / Holding / Selling"** — gerund form, matches Pro Personnel's existing chip language ("BUYING WR"). Replaces the implementation-leaking "High / Med / Low" vocabulary in the old StrategyTab.

### Mobile pattern
Snap-snap:
- Vertical snap between the two sections (swipe up to move from *Where we're going* to *Where we stand*)
- Horizontal snap within each section (one card at a time, peek of next on the right)

Section bars stay at the top of each snapped section.

### Autosave
Confirmation on the back of each Selector Card is the save event. DONE stamp = save confirmation. No save button. Consistent with how trade chart and attachment already work.

---

## Section 10: Set Availability Sub-Surface

Sub-page for per-player attachment + per-asset value editing. Each player IS a Topps card. Reached via *"Set Availability"* button in the Wall's header.

### Concept

Each player IS a Topps card. The user is the GM holding their team's collection. Pro Personnel cards = other teams' players (scouting); Set Availability cards = your team's players (managing). Same visual language, opposite ownership.

### Layout (Desktop, ≥768px)

```
┌──────────────────────────────────────────────┐
│  [InnerTopbar]                                 │
│  [Set Availability]                            │
├──────────────────────────────────────────────┤
│  ───── QB ───────────────────────────         │
│  ┌───┐ ┌───┐ ┌───┐                            │  ← Player Cards
│  │ ▒ │ │ ▒ │ │ ▒ │                             │     sorted by value desc
│  └───┘ └───┘ └───┘                             │
│                                                │
│  ───── RB ───────────────────────────         │
│  ┌───┐ ┌───┐ ┌───┐ ┌───┐ ┌───┐                │
│  │ ▒ │ │ ▒ │ │ ▒ │ │ ▒ │ │ ▒ │                │
│  └───┘ └───┘ └───┘ └───┘ └───┘                │
│                                                │
│  ───── PASS CATCHERS ────────────────         │
│  [horizontal scroll rail of Player Cards]      │
│                                                │
│  ───── PICKS ────────────────────────         │
│  ┌────┐ ┌────┐ ┌────┐                         │
│  │1RDR│ │2RDR│ │3RDR│                          │  ← Pick Cards (List Card template)
│  └────┘ └────┘ └────┘                          │
└──────────────────────────────────────────────┘
```

- **Four position-grouped rails:** QB / RB / Pass Catchers / Picks. Section dividers KEEP (management screen).
- **Position rails contain Player Cards** (Player Card template). Cards sorted by value descending (top = top guy).
- **Picks rail contains per-round Pick Cards** (List Card template — the only management surface still using List Card after the master design pass).
- **2 rails fully visible** at once on a typical 800px+ desktop viewport. User scrolls vertically to see Pass Catchers and Picks.
- **No director's voice** on this surface. The wall already carries strategic commentary; this is the work surface where the user makes the calls. Cards' visual design (marker chips, color treatments) communicates state.

### Mobile pattern
Snap-snap:
- Vertical snap between rails (swipe up to move from QB to RB to Pass Catchers to Picks)
- Horizontal snap within each rail (one card at a time, peek of next on the right)

**Build note:** revisit the peek pattern at mockup time — confirm it lands right with the larger Pick Cards.

### Why position-grouped (not tier-grouped)
- **Depth chart absorbs.** The old Depth Chart tab was killed; position-grouped rails functionally replace it (top of each rail = your starters, bottom = depth).
- **Tier decisions need position context.** Deciding if a guy is "core" or "listening" requires comparing him to your other players at that position.
- **Mirrors Set Strategy.** Position Markets uses QB / RB / Pass Catchers / Picks — same four buckets.

Tier still surfaces per-card via the availability chip — just not the organizing axis.

---

## Section 11: Player Card Anatomy (Set Availability)

Used in Set Availability's QB / RB / Pass Catchers rails. ~200px wide × ~280-300px tall. Universal Player Card template per the master card system, with the master flip pattern (front → back via universal action button).

### Front

```
┌────────────────────────────┐
│ [pic]  LAMAR JACKSON  [📎] │  ← chrome: portrait + name + memo corner
├────────────────────────────┤
│ QB · BAL · 27               │  ← meta line
│ [STUD] [YOUTH]              │  ← marker chips
│                              │  ← breathing space
│ Availability: [Moveable]    │  ← current tier (display, not interactive)
│ Price: $300 (green/red)     │  ← current price (display, not interactive)
│                              │
│         [Edit]              │  ← universal action button
└────────────────────────────┘
```

### Card body
- Background: Paper (#FEFCF9)
- Border: 2.5px solid Ink (#1A1A1A)
- Box shadow: 4px offset Ink
- No rounded corners

### Chrome (top band)
- Background: Ink (#1A1A1A)
- Height: ~50-56px to fit portrait + name + memo corner
- 2px Ink divider below it
- Layout: portrait left, name right of portrait, memo corner top-right (when present)

**Portrait:** ~36-40px square cut (no rounded corners). Sourced from Sleeper's public CDN. Fallback when portrait unavailable: position-color block with player initials in Syne 800 Paper.

**Name:** Syne 800, ~16-18px, Paper (#FEFCF9), one line, autoshrinks for long names.

**Memo corner:** small folded-paper icon (no *"Re:"* text inside). Present only when the director has an attached note on this player. Tap → popover with the full note. Travels with the player across the Wall and this surface.

### Body
**Meta line:** *"QB · BAL · 27"* — plain DM Sans, Ink, ~10-11px.

**Marker chips:** outlined chips (1.5px Ink border, Paper bg, Ink text), JetBrains Mono 700, ~9-10px, uppercase. Examples: *STUD*, *YOUTH*, *AGING*. Show all that apply. Info-only — not interactive.

**Availability display:** plain text + filled chip showing current tier (Moveable / Listening / Core / Untouchable). Chip uses the locked color treatment from `CFC-APP-STATUS.md` Availability Chips section (green Moveable = #019942, yellow Listening, ink Core, red Untouchable). Display-only on the front.

**Price display:** plain text + price value. Color cue (green at-or-above CFC, red below CFC). Display-only on the front.

**Universal action button:** *"Edit"* at the bottom center. Tap → flips to back.

### Back

```
┌────────────────────────────┐
│ [pic]  LAMAR JACKSON       │  ← chrome (same as front, no memo corner)
├────────────────────────────┤
│ Availability                │  ← section label
│ [Untouch.][Core][List.][Mov.]│  ← 4-button tier picker
├────────────────────────────┤
│ Price: $300 [−][+]          │  ← price adjuster
│ vs CFC: ▲8% │ vs last wk: ▲2%│
├────────────────────────────┤
│ Pick Anchors                │
│  −   1sts   +              │
│  −   2nds   +              │
│  −   3rds   +              │
└────────────────────────────┘
```

- **Chrome:** identical to front (portrait + name). Identity continuity.
- **Availability section:** 4-button picker (Untouchable / Core / Listening / Moveable). Active button: filled with the tier's color, Paper text. Inactive buttons: outlined, Ink text. **Tap a button → that becomes the new tier, DONE stamp lands, card flips back to front showing the new state.** Single tap = commit (no separate save).
  - **v1.0 availability popover is killed.** The popover concept (4 tier options floating from the front-of-card chip tap) is replaced by this back-of-card picker. Cleaner: editing state lives behind the flip.
- **Price section:** current price with +/− buttons. Tap to adjust. Live updates: comparison row (vs CFC, vs last week) recomputes as user adjusts. Updates auto-save.
  - **vs CFC** updates live as user adjusts (delta moves with their override)
  - **vs last week** is **CFC-vs-CFC** — independent of user's manual override, captures league-wide value movement
- **Pick Anchors section:** 1sts / 2nds / 3rds toggles with +/− buttons. JetBrains Mono numerals between the buttons. Existing TradeChartTab pattern. Auto-save.

### Flip mechanics
- Tap *"Edit"* (front) → flips to back (~300ms)
- Tap any tier button → commits, DONE stamp lands, auto-flips back to front
- Tap +/− on price or pick anchors → auto-saves silently (no flip, no stamp — these are continuous adjustments)
- Mobile: small X top-right of the back closes the flip without committing the tier picker

If the new tier changes the player's overall ranking within the rail, card animates to its new position after the flip-back.

---

## Section 12: Pick Card Anatomy (Set Availability)

Used in Set Availability's Picks rail. **List Card template** per the master card system — the only management surface still using List Card. ~280-300px wide × ~300-320px tall.

### Front

```
┌─────────────────────────────┐
│   First Rounders            │  ← chrome: round name (List Card identity)
├─────────────────────────────┤
│ '26 1.04 [Moveable] [$325] ✏│ ← row per pick
│ '27 1st  [Moveable] [$300] ✏│
│ '28 1st  [Untouch.] [$280] ✏│
└─────────────────────────────┘
```

### Card body
Same neobrutalist treatment as Player Cards (2.5px Ink border, 4px offset shadow, Paper bg, no rounded corners).

### Chrome
- Background: Ink (#1A1A1A)
- Content: round name centered (*"First Rounders"* / *"Second Rounders"* / *"Third Rounders"*). Syne 800, Paper, prominent.
- No portrait (no player to portray). No additional meta — just the round name.

### Body — pick rows
Each pick owned in this round renders as a row:
- Pick label: year + slot, abbreviated (e.g., *"'26 1.04"*, *"'27 1st"*, *"'28 1st"*). DM Sans or JetBrains Mono, Ink.
- Availability chip (filled, using locked color treatment per `CFC-APP-STATUS.md`)
- Price chip (filled, green at-or-above CFC, red below CFC)
- Edit affordance (small pencil icon on the right of each row)

### Row tap behavior — universal flip
**Tap any pick row** (not just the chips — the whole row is the tap target) → card flips to the back, showing the editor for **that specific pick**.

### Back (per-pick editor)

```
┌─────────────────────────────┐
│   2026 1.04                 │  ← chrome: pick id (replaces round name)
├─────────────────────────────┤
│ Availability                │
│ [Untouch.][Core][List.][Mov.]│  ← 4-button tier picker
├─────────────────────────────┤
│ Price: $325 [−][+]          │
│ vs CFC: ▲8% │ vs last wk: ▲2%│
├─────────────────────────────┤
│ Pick Anchors                │
│  −   1sts   +              │
│  −   2nds   +              │
│  −   3rds   +              │
└─────────────────────────────┘
```

- **Chrome:** the specific pick's identifier (*"2026 1.04"*) replaces the round name. User knows which pick they're editing.
- **Body:** essentially identical to Player Card back — Availability tier picker + Price adjuster + Pick anchor toggles.
- **Per-pick availability uses the 4-tier system** (Untouchable / Core / Listening / Moveable). Same as players.

### Flip back
- Tap a tier button → commits, DONE stamp, flips back to round-card front
- Tap price +/− or pick anchor +/− → auto-saves silently
- Mobile: small X top-right closes the flip without committing

### Internal scroll for overflow
When a user has 5+ picks in a round (rare — typical is 3-4), the body engages **internal vertical scroll**.
- Hard-line + chevron + *"X more"* pattern inside the card body
- Vertical scroll inside the card; horizontal swipe still navigates the rail. Different axes, no gesture conflict.

### Pick value flexibility (system-level note)
Pick values become flexible (parallel to player values):
1. **Layer 1 (team strategy modifier, auto):** picks_market and wants_more drive team-specific multipliers on pick values. Rebuilders see picks higher; all-in teams see them lower. Parallel to studs/youth modifiers on players.
2. **Layer 2 (per-pick manual override, user):** the back-of-card pick anchor adjuster sets manual values per pick.

The auction anchor (e.g., 1.01 = $300) stays as the league-level CFC reference. Team-level modifiers don't break the anchor.

---

## Section 13: Topbar

Inherits from `CFC-GM-OFFICE-SPEC.md` — same `InnerTopbar` component on all R&S surfaces.

### Desktop
| Slot | Content | Behavior |
|---|---|---|
| Left | ← back arrow | Returns to home (org chart) from Wall. From sub-pages, returns to Wall. |
| Center | CFC league logo (clickable) | Returns to home (org chart) |
| Right | Settings icon | Opens settings menu |

### Mobile
| Slot | Content | Behavior |
|---|---|---|
| Left | Hamburger menu | Opens global navigation drawer |
| Center | CFC league logo (clickable) | Returns to home (org chart) |
| Right | Settings icon | Opens settings menu |

R&S does **not** use Pro Personnel's old dynamic-section-title topbar pattern (which is also being killed in the PP redesign). Center stays the league logo.

---

## Section 14: Cross-Director Signal Flow (R&S as Source)

R&S generates settings signals; the other doors consume them. Recap from `CFC-APP-STATUS.md`:

- **R&S → Pro Personnel:**
  - Aging signal → PP Shop opportunity cards (*"Mahomes' value is peaking — sell high"*)
  - Value drift signal → PP Shop opportunity cards (when the drift implies it's time to move)
  - Position market (selling) → PP Shop cards
  - Wants more + position market (buying) → PP Acquire opportunity cards (*"Founders have a WR2 who fits our hole"*)
- **R&S → Scouting:**
  - Wants more (especially studs / picks) → Scouting Trade up/down intel relevance (*"We said we want studs — worth seeing what a trade up costs"*)
  - Position market influences the directionality of trade intel
- **PP and Scouting** do NOT feed signals back into R&S. R&S is the source, not a consumer.

Build-time concerns (deferred to build):
1. **Signal volume** — aging fires on many players continuously. Need prioritization so R&S doesn't flood the wall.
2. **Cooldowns / thresholds** per signal — when does a signal cross from "interesting" to "surface a card"?
3. **Multi-card from one signal** — aging Mahomes might trigger an R&S tier-update card AND a PP Shop card. Decide if both fire or only one, and which takes priority.

---

## Section 15: Items Killed in This Redesign

### Already killed in v1.0 (remain killed in v2.0)
1. `src/components/owners-box/OwnersBoxView.tsx` and the "Owner's Box" door concept
2. `src/components/owners-box/StrategyTab.tsx`
3. `src/components/owners-box/TradeChartTab.tsx`
4. `src/components/owners-box/DepthChartTab.tsx`
5. `src/components/owners-box/PersonaPicker.tsx` and `PersonaCard.tsx` (persona migrated to GM Office nameplate)
6. `src/components/historian/HistorianChat.tsx` standalone usage / route
7. `src/components/historian/WelcomeScreen.tsx`
8. `src/components/historian/ConversationSidebar.tsx`
9. The "Save Profile" button (replaced by autosave)
10. High / Med / Low vocabulary (replaced by Buying / Holding / Selling)
11. Per-position WR and TE markets in the UI (consolidated into Pass Catchers)
12. The 4-color availability chip pattern on Set Availability cards (the v1.0 bicolor blue-only treatment) — **but reversed in v2.0** (see new kill below)

### Newly killed in v2.0
13. **v1.0 R&S 2-up wall queue layout.** Replaced by trading card binder grid (3 columns desktop, single-card swipe deck mobile) — matches PP and Scouting landing pattern.
14. **v1.0 settings staleness lens** (was lens #1 in v1.0). Killed — staleness = buildup of other unaddressed cards. Fix the cards, staleness solves itself.
15. **v1.0 Set Availability availability popover** (the floating 4-tier picker that appeared when tapping the front-of-card availability chip). Killed — tier picker now lives on the back of the Player Card, accessed via the universal flip pattern.
16. **v1.0 bicolor blue/green-red availability+price row pattern on Set Availability Player Cards.** Replaced by the standard 4-color availability chips (per `CFC-APP-STATUS.md` Availability Chips section) on the front (display only) and a 4-button tier picker on the back. Price chip still uses green/red dynamic for at-or-above-CFC vs below-CFC.
17. **v1.0 trade-related action types on the Wall** (the "shop suggestion" route-out for aging players). R&S is purely settings; aging signal flows to PP Shop instead.
18. **v1.0 *"RESEARCH ANALYST"* header label on the chat panel.** Killed — the input placeholder *"Ask the Research Analyst…"* carries the identity. Tabs go directly to the top.
19. **v1.0 *"DONE"* vs *"FILED"* stamp variants** depending on action type (inline edit vs route-out). Since R&S is now purely settings (all inline edits), only the *"DONE"* stamp is needed. (The *"FILED"* variant is logged as a future possibility for other surfaces if needed.)
20. **v1.0 wall scroll affordance** (the hard-line + chevron + *"X more below"* indicator). Replaced by native vertical scroll on the binder grid (no custom indicator — per `CFC-APP-STATUS.md` Scroll & Swipe Indicator Pattern).

---

## Section 16: Files Affected

### Retire (already deleted or to be deleted)
- `src/components/owners-box/OwnersBoxView.tsx`
- `src/components/owners-box/StrategyTab.tsx`
- `src/components/owners-box/TradeChartTab.tsx`
- `src/components/owners-box/DepthChartTab.tsx`
- `src/components/owners-box/PersonaPicker.tsx`
- `src/components/owners-box/PersonaCard.tsx`
- `src/components/owners-box/Card.tsx`
- `src/components/historian/WelcomeScreen.tsx`
- `src/components/historian/ConversationSidebar.tsx`

### Replace / update if v1.0 already built
If any v1.0 R&S landing files were built, refactor or replace per v2.0:
- `src/components/research-strategy/Wall.tsx` — restructure from 2-up vertical queue to binder grid
- `src/components/research-strategy/InsightCard.tsx` — confirm Player Card / Memo Card variants per master template
- `src/components/research-strategy/AvailabilityPopover.tsx` — **delete** (popover killed; tier picker moves to card back)

### Adapt / update
- `src/components/historian/HistorianChat.tsx` — adapt for the persistent right-rail chat. Strip sidebar, add two-tab pattern, kill header label, kill welcome screen + suggestion cards, wire 3 locked opener chips with autofill behavior.
- `src/components/historian/ChatInput.tsx` — likely reusable; may need styling tweaks for the new placeholder pattern.
- `src/components/historian/ChatMessage.tsx` — reusable.
- `src/components/historian/markdown.tsx` — reusable.

### New components (v2.0)
- `src/components/research-strategy/RSLanding.tsx` — top-level page composing topbar + header bar + binder grid + chat panel (desktop) / pinned-input (mobile). Mounts at `/research-strategy`.
- `src/components/research-strategy/CardGrid.tsx` — binder grid / swipe deck. May be shared with PP and Scouting — coordinate at build.
- `src/components/research-strategy/AgingPlayerCard.tsx` — Player Card variant for the Aging lens.
- `src/components/research-strategy/ValueDriftCard.tsx` — Player Card variant for the Value drift lens.
- `src/components/research-strategy/AttachmentMismatchCard.tsx` — Player Card variant for the Attachment mismatch lens.
- `src/components/research-strategy/PositionMisalignmentCard.tsx` — Memo Card variant for the Position misalignment lens.
- `src/components/research-strategy/WantsMoreSuggestionCard.tsx` — Memo Card variant for the Wants More suggestion lens.
- `src/components/research-strategy/ChampionshipComparisonCard.tsx` — Player or Memo Card variant for the Championship comparison lens.
- `src/components/research-strategy/TierPicker.tsx` — 4-button tier picker for card backs (Untouchable / Core / Listening / Moveable). Reusable on Player Card back (Set Availability + Wall cards) and Pick Card back.
- `src/components/research-strategy/PriceAdjuster.tsx` — +/− price editor for card backs.
- `src/components/research-strategy/MarketEditor.tsx` — 3-button Buying / Holding / Selling editor for Memo Card backs (Wall) and Position Market Selector Card backs (Set Strategy).
- `src/components/research-strategy/WantsToggle.tsx` — on/off toggle for Memo Card backs (Wall) and Wants More Selector Card backs (Set Strategy).
- `src/components/research-strategy/PickAnchorAdjuster.tsx` — +/− toggles for 1sts/2nds/3rds. Used on the back of Player Cards and Pick Card per-pick editors.
- `src/components/research-strategy/DoneStamp.tsx` — the rubber-stamp confirmation overlay.
- `src/components/research-strategy/RSChatPanel.tsx` — persistent right-rail chat (desktop) / pinned-input + takeover (mobile). Wraps adapted HistorianChat with Research Analyst identity + 3 opener chips.
- `src/components/research-strategy/RSHeaderBar.tsx` — wall's header bar (page title + Set Strategy / Set Availability buttons).
- `src/components/research-strategy/EmptyWall.tsx` — director's-voice empty state.
- `src/components/research-strategy/SetStrategyPage.tsx` — top-level Set Strategy page. Mounts at `/research-strategy/set-strategy`.
- `src/components/research-strategy/WantsMoreSelectorCard.tsx` — Selector Card variant for Set Strategy (Picks / Studs / Youth / Depth).
- `src/components/research-strategy/PositionMarketSelectorCard.tsx` — Selector Card variant for Set Strategy (QB / RB / Pass Catchers / Picks). Roster preview on front.
- `src/components/research-strategy/SetAvailabilityPage.tsx` — top-level Set Availability page. Mounts at `/research-strategy/set-availability`.
- `src/components/research-strategy/RosterPlayerCard.tsx` — Set Availability Player Card (front + back, flip mechanics).
- `src/components/research-strategy/PickCard.tsx` — Set Availability Pick Card (List Card template, front + back, internal scroll for overflow).
- `src/components/research-strategy/MemoCorner.tsx` — reusable memo corner indicator + popover.

### New / extended APIs
- `/api/research-strategy/wall` — generates the wall (runs all 6 lenses, returns cards sorted by urgency)
- `/api/research-strategy/dismiss` — records dismissal for 28-day cooldown
- `/api/research-strategy/act` — records that a card's action was taken (for cooldown / no resurfacing)
- Extension to existing strategy / attachment / trade-chart endpoints for the inline-edit lens actions

### Reuse untouched
- `src/lib/storedTeam.ts`, `src/lib/hooks/useMyRoster.ts` — roster data
- `src/lib/team-hq/types.ts` — strategy profile types

---

## Section 17: Build Order Recommendation

Suggested sequence to ship cleanly. Each step should produce a buildable commit (one file at a time via GitHub web editor).

### Phase 1 — Cleanup
1. **Delete** `AvailabilityPopover.tsx` (if it was built in a v1.0 build).
2. **Confirm retired** Owner's Box files and standalone Historian files.

### Phase 2 — Shared back-of-card components
3. **`TierPicker.tsx`** — 4-button picker. Standalone, used by Wall cards + Set Availability Player Card + Pick Card.
4. **`PriceAdjuster.tsx`** — price editor with vs CFC / vs last week deltas. Standalone.
5. **`MarketEditor.tsx`** — 3-button picker. Standalone.
6. **`WantsToggle.tsx`** — on/off toggle. Standalone.
7. **`PickAnchorAdjuster.tsx`** — +/- toggle component for pick anchors. Standalone.
8. **`MemoCorner.tsx`** — memo corner icon + popover. Standalone.
9. **`DoneStamp.tsx`** — rubber-stamp confirmation overlay. Standalone.

### Phase 3 — Wall card primitives
10. **`AgingPlayerCard.tsx`** — Player Card variant + TierPicker on back. Stub data.
11. **`ValueDriftCard.tsx`** — Player Card variant + PriceAdjuster on back.
12. **`AttachmentMismatchCard.tsx`** — Player Card variant + TierPicker on back.
13. **`PositionMisalignmentCard.tsx`** — Memo Card variant + MarketEditor on back.
14. **`WantsMoreSuggestionCard.tsx`** — Memo Card variant + WantsToggle on back.
15. **`ChampionshipComparisonCard.tsx`** — Player or Memo Card variant + (TierPicker | MarketEditor | WantsToggle) on back.

### Phase 4 — Wall page composition
16. **`EmptyWall.tsx`** — director's-voice empty state.
17. **`CardGrid.tsx`** — binder grid / swipe deck. May be shared with PP and Scouting.
18. **`/api/research-strategy/wall`** — endpoint. Implement lenses one at a time:
    - 18a. Aging player
    - 18b. Value drift
    - 18c. Attachment mismatch
    - 18d. Position misalignment (needs league-wide aggregation — see open items)
    - 18e. Wants More suggestion
    - 18f. Championship comparison (needs structured data wiring — see open items)
19. **`/api/research-strategy/dismiss` and `/api/research-strategy/act`** — cooldown tracking endpoints.

### Phase 5 — Chat panel
20. **Adapt `HistorianChat.tsx`** — strip sidebar, add two-tab structure, kill header label + welcome + suggestions, wire 3 locked opener chips with autofill.
21. **`RSChatPanel.tsx`** — wraps adapted historian for right-rail (desktop) and pinned-input (mobile).

### Phase 6 — Landing composition
22. **`RSHeaderBar.tsx`** — header bar with page title + Set Strategy / Set Availability buttons.
23. **`RSLanding.tsx`** — composes topbar + header bar + binder grid + chat panel. Mount at `/research-strategy`.

### Phase 7 — Set Strategy
24. **`WantsMoreSelectorCard.tsx`** — 4 Selector Cards (Picks / Studs / Youth / Depth) with flip + DONE stamp.
25. **`PositionMarketSelectorCard.tsx`** — 4 Selector Cards (QB / RB / Pass Catchers / Picks) with roster preview front + MarketEditor back + DONE stamp.
26. **`SetStrategyPage.tsx`** — composes the two horizontal-rail sections. Mount at `/research-strategy/set-strategy`.

### Phase 8 — Set Availability
27. **`RosterPlayerCard.tsx`** — Player Card front (display) + back (TierPicker + PriceAdjuster + PickAnchorAdjuster). Flip mechanics.
28. **`PickCard.tsx`** — List Card front (round chrome + rows) + back (per-pick editor with TierPicker + PriceAdjuster + PickAnchorAdjuster). Internal scroll for overflow.
29. **`SetAvailabilityPage.tsx`** — composes the four position-grouped rails. Mount at `/research-strategy/set-availability`.

### Phase 9 — Polish & cleanup
30. **Pick value flexibility** — extend team-modifier pipeline to picks (Layer 1 from Section 12).
31. **Animation tuning** — flip timing, slide-off easing, stamp landing.
32. **Retire** old Owner's Box files. Remove old route.

---

## Section 18: Open Items / Deferred Decisions

These are NOT blockers for the R&S design. They are flagged for build phase or later work:

1. **Championship lens data wiring.** Lens 6 needs structured access to title-team patterns (year-by-year analysis of championship rosters' position composition, age, etc.). Today the historian can answer free-text questions about league history but doesn't expose structured comparison data as a queryable signal. If unwired at build, this lens ships disabled or capped at a simple stat pull.

2. **Position misalignment league-wide aggregation.** Lens 4 needs *"bottom-3 in the league"* style comparisons — every team's position values aggregated and ranked. May need new aggregation queries / views.

3. **Wants More suggestion lens trigger logic.** When should the lens fire? Possible triggers: roster condition (averaged age at position, depth at position) crosses a threshold + the relevant wants_more category is off. Defer specific thresholds to build.

4. **Cross-team activity tracking.** Future signal that would let the Aging-player lens hit red triggers based on outside interest. Today this data isn't tracked. If/when added, the spec already assumes the lens would level up to red.

5. **Pass Catchers data-model migration.** UI consolidates WR + TE into one *"Pass Catchers"* market card. V1 implementation: aggregate display only — same setting writes to both `wr_market` and `te_market`. Long-term: consider migrating to a single `pass_catchers_market` column. Defer to data-migration discussion.

6. **Pick value flexibility build.** Layer 1 (team-modifier on picks) is new logic parallel to existing player modifiers. Moderate add. Layer 2 (manual override) already works.

7. **Director's-voice content engine** for Wall cards + Set Strategy cards. State-aware prose per card. LLM-generated at request time vs. rule-based templating from team data. Defer to build.

8. **Card-flip animation timing and easing.** Specific durations: flip-to-back (~250-300ms), stamp-hold (~200ms), slide-off (~300ms), reflow-up (~250ms). Tune at mockup.

9. **Per-pick availability tag granularity.** Picks use the same 4-tier system as players. Whether all 4 tiers are useful for picks (or mostly Moveable / Listening with rare Core / Untouchable) is a UX question that surfaces in real use.

10. **Mobile peek pattern revisit on Set Availability.** Pick cards larger than typical player cards. Confirm peek lands right at the larger size.

11. **Backend persistence for chat conversations.** V1: localStorage. V2: backend.

12. **Wall card per-tier sort tiebreakers.** Within yellow (multiple yellow cards), what's the secondary sort? By recency of underlying state change? By lens type priority? Defer to build.

13. **Vs-last-week comparison data wiring.** The back-of-card comparison row shows *"vs last week"* — CFC consensus value movement over the past week. Requires historical CFC value snapshots. Confirm whether snapshot data exists or needs new wiring.

14. **Memo corner content engine.** When the director has a longer note attached to a player, the memo corner popover shows the full note. Content engine same as quips — defer.

---

## Section 19: Behavioral Notes

- **Default landing within the door:** the Wall (`/research-strategy`).
- **Logo click on topbar (any R&S surface):** returns to home (org chart).
- **Back arrow on Wall:** returns to home.
- **Back arrow on Set Strategy / Set Availability:** returns to the Wall.
- **Hamburger (mobile):** opens global navigation drawer with all four doors + settings.
- **Header buttons on Wall** (*Set Strategy* / *Set Availability*): direct route to the respective sub-page. Always visible (desktop header bar; mobile pinned top).
- **Wall card primary action:** universal flip → make the update on the back → DONE stamp → slide-off. New card promotes up.
- **Wall card dismiss:** *"Not now"* → card slides off without flipping. 28-day cooldown.
- **Chat panel (desktop):** persistent right rail. Always visible while on the Wall.
- **Chat panel (mobile):** pinned single-line input. Tap → full-screen takeover.
- **Set Strategy autosave:** confirmation on the back of each Selector Card is the save event. DONE stamp = save confirmation.
- **Set Strategy navigation between sections:** desktop scrolls vertically (both rails visible at once typically); mobile snap-snap.
- **Set Availability navigation between rails:** desktop vertical scroll (2 rails visible at once); mobile snap-snap.
- **Set Availability Player Card — Edit tap:** flips to back. Tap tier → commits + DONE stamp + flip back. Tap +/− on price or anchors → auto-saves silently.
- **Set Availability Pick Card — pick row tap:** flips to back showing that specific pick's editor. Same controls as Player Card back.
- **Memo corner tap:** popover with full director note. Travels with player across surfaces.
- **Toast:** existing pattern preserved (top-center, 3s auto-dismiss). Used for save confirmations on Set Availability auto-save events.

---

## Section 20: Color Palette (Excerpt from Design System)

| Name | Hex | Usage on R&S |
|---|---|---|
| Ink | #1A1A1A | Borders, primary text, chrome backgrounds, Core availability chip, action buttons (filled state) |
| Paper | #FEFCF9 | Card backgrounds, chat panel content bg, chrome text on Ink |
| Cream | #F5F0E6 | Page background, hover states |
| Blue | #3366CC | Selector Card filled state, primary action buttons (when not using ink fill) |
| Yellow | #F5C230 | Listening availability chip, yellow-tier card urgency |
| Red | #E8503A | Untouchable availability chip, red-tier card urgency, Price chip when below CFC |
| Green | **#019942** | Moveable availability chip, Price chip when at-or-above CFC, green-tier card urgency, green deltas in comparison rows. Universal green across the app — replaces prior #007370. |
| Muted | #8C7E6A | Secondary text, timestamps, subject line text in Memo Card chrome, chat placeholder italic |

Full palette in `/docs/CFC-APP-STATUS.md`.

---

## Section 21: Typography (Excerpt from Design System)

| Font | Weight | Usage on R&S |
|---|---|---|
| Syne | 800–900 | Page titles, card chrome (player name, round name), section headers, action button labels, *"DONE"* stamp |
| DM Sans | 400–700 | Director's-voice headlines (in quotes on Wall cards and Set Strategy cards), body prose, meta line text, comparison row text, chat input placeholder (italic) |
| JetBrains Mono | 700 | Subject lines (*Re: ...*) on Memo Cards, marker chip text (STUD / YOUTH / AGING), value display ($XXX), pick row metadata, tab labels |

Full system in `/docs/CFC-APP-STATUS.md`.

---

## Section 22: Summary — At-a-Glance

| Element | Decision |
|---|---|
| **Routing** | `/research-strategy` (wall) · `/research-strategy/set-strategy` · `/research-strategy/set-availability` |
| **Concept** | Strategist's war room. Director on the cards + Research Analyst in the chat. R&S is purely settings |
| **Wall layout (desktop)** | 70% trading card binder grid (3 columns) + 30% persistent chat panel right rail |
| **Wall layout (mobile)** | Pinned-top action buttons + swipeable card deck (peek killed, dots only) + pinned-bottom chat input |
| **Card lens types (6)** | Aging player (Player) · Value drift (Player) · Attachment mismatch (Player) · Position misalignment (Memo) · Wants More suggestion (Memo, NEW) · Championship comparison (Player or Memo) |
| **Update types (4)** | Availability tier · Value (price) · Position market · Wants More |
| **Universal flip pattern** | Every Wall card flips. Front = identity + director quip + *"Tap to update"*. Back = appropriate update mechanism. Commit → DONE stamp → slide-off |
| **Card capacity** | Dynamic. Sorted red → yellow → green. Empty state shows director-voice copy *"Roster's set, signals are clean. I'll flag anything that shifts."* |
| **Door urgency** | 3 tiers (green/yellow/red). Door tier = highest card tier on the Wall |
| **Dismiss mechanic** | *"Not now"* → slide-off without flip → 28-day cooldown |
| **Chat surface** | Persistent right rail (~30%) on desktop · Pinned-input + takeover on mobile · 3 opener chips (locked) · *"Ask the Research Analyst…"* placeholder · No header label |
| **Opener chips (locked)** | *"How does my roster compare to last year's title teams?"* · *"What's my biggest roster weakness?"* · *"Who's won the most CFC championships?"* |
| **Set Strategy** | 2 horizontal-rail sections: *Where we're going* (Wants More: 4 Selector Cards) + *Where we stand* (Position Markets: 4 Selector Cards). All cards use universal flip + DONE stamp. Buying/Holding/Selling vocabulary. Pass Catchers consolidates WR+TE |
| **Set Availability** | 4 position-grouped rails: QB / RB / Pass Catchers / Picks. Position rails contain Player Cards; Picks rail contains Pick Cards (List Card — only management surface still using List Card) |
| **Player Card (Set Availability)** | Front = display (chrome + meta + marker chips + availability chip + price chip + Edit button + optional memo corner). Back = TierPicker + PriceAdjuster + PickAnchorAdjuster. Universal flip pattern. Tier picker on back replaces v1.0 popover |
| **Pick Card (Set Availability)** | List Card template. Front = round chrome + pick rows. Back = per-pick editor (TierPicker + PriceAdjuster + PickAnchorAdjuster) |
| **Pick value system** | Becomes flexible — Layer 1 (team modifier on picks) + Layer 2 (manual override). Auction anchor stays as league reference |
| **Director's voice presence** | Wall: yes (per card). Set Strategy: yes (per card). Set Availability: no (work surface; visual state communicates) |
| **Availability chip colors (Set Availability)** | 4-color treatment per `CFC-APP-STATUS.md` — Moveable green #019942 · Listening yellow · Core ink · Untouchable red. Universal across the app, no Set-Availability-specific override |
| **Cross-director signals (R&S → others)** | R&S → PP: aging, value drift, position market (selling), wants more, position market (buying). R&S → Scouting: wants more + position market for trade-intel relevance. R&S is the source — does not consume signals from PP or Scouting |
| **Killed in v2.0** | Settings staleness lens · v1.0 2-up wall queue layout · Set Availability availability popover · v1.0 bicolor blue/green-red row pattern · Trade cards on the Wall (aging → PP) · v1.0 *"RESEARCH ANALYST"* chat header label · v1.0 *"FILED"* stamp variant · v1.0 wall scroll affordance |

---

## End of Spec — Ready for Build

The Research & Strategy v2.0 design is fully locked. Items intentionally deferred are content-engine choices (director's-voice generation, memo notes), data-wiring questions (championship structured data, league-wide aggregations, cross-team activity tracking, vs-last-week historical snapshots), and animation tuning. All locked items are buildable today against existing or naturally-extended APIs and components.

Pick this up in a build chat by attaching this document along with `/docs/CFC-APP-STATUS.md`, `CFC-HOME-SCREEN-SPEC.md`, `CFC-GM-OFFICE-SPEC.md`, `CFC-PRO-PERSONNEL-SPEC.md`, and `CFC-SCOUTING-SPEC.md`. The build chat should not need any conversation history beyond these six files to execute the build cleanly.
