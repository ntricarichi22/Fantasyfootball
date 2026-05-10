# CFC Front Office — Research & Strategy Design Spec

**Version:** 1.0
**Date:** May 9, 2026
**Status:** Design locked — ready for mockup → code

---

## Purpose of This Document

This document captures every design decision for the **Research & Strategy door** — the strategist's war room, its sub-surfaces, and the card system that lives within. It is the handoff spec for implementation. A new chat or developer should be able to read this document and execute the build without referring to prior conversation.

This document is **forward-looking**. It describes what Research & Strategy becomes, not what it currently is. The current implementation lives in `src/components/owners-box/StrategyTab.tsx`, `src/components/owners-box/TradeChartTab.tsx`, and `src/components/historian/*` and is being replaced.

This spec must be read alongside:
- `/docs/CFC-APP-STATUS.md` (project-wide design system and non-negotiables)
- `CFC-HOME-SCREEN-SPEC.md` v2.0 (locked home screen — R&S is one of three director doors)
- `CFC-GM-OFFICE-SPEC.md` (locked GM Office)
- `CFC-PRO-PERSONNEL-SPEC.md` (locked Pro Personnel)

Research & Strategy is the third of three director doors reporting to the GM. Its lens is **looking inward** — our team, our preferences, the data that informs our plan.

---

## Section 1: Concept & Metaphor

The R&S door IS the **strategist's war room**. The user walks in and the work is already on the wall: data-driven findings the strategist has prepared, stacked as cards. Each card is an insight + an implied action. The user works through them — acts on them or sets them aside — until the wall is clear.

The room has two voices in it:

- **The Director of Research & Strategy** — speaks on the cards. Strategic, curated, sees-the-big-picture. *"Champ teams stack WRs. We have one. Worth bumping our market."* The director prepared the wall before you walked in.
- **The Research Analyst** — staff, not the director. Lives in the chat. Pulls data, answers questions, runs lookups. *"Who has the most championships?"* / *"What's our weak spot at WR?"* The analyst is at the keyboard while the director is at the whiteboard.

The split is honest about how a real front office works: the director presents conclusions; staff pulls the data. Two surfaces in one room, two distinct voices.

The metaphor governs everything that follows: card design (insights as pinned papers), voice rules (each surface speaks in its own register), the chat's permanent presence (the analyst is always there), the door's character (calm strategist, never urgent fire-drill).

---

## Section 2: Architecture & Routing

### Routes

| Route | Surface | Entry points |
|---|---|---|
| `/research-strategy` | The Wall (door landing — primary surface) | Home screen R&S director box |
| `/research-strategy/set-strategy` | Set Strategy sub-page | "Set Strategy" button in the wall's header |
| `/research-strategy/set-availability` | Set Availability sub-page | "Set Availability" button in the wall's header |

### Mental model

Three surfaces inside one door:

1. **The Wall** — door's landing. Two-up queue of insight cards (the strategist's findings) + persistent right-rail chat (the Research Analyst). Default surface — what the user lands on when they walk into the door.
2. **Set Strategy** — sub-page for editing wants_more + position markets. Two horizontal-rail sections of cards.
3. **Set Availability** — sub-page for editing per-player attachment + per-asset values. Four position-grouped rails of cards.

The chat panel is **only present on the Wall**. Sub-pages are full-width work surfaces; the analyst is not visible there.

Sub-pages are full-screen takeovers reached via header buttons on the Wall. Back arrow on the InnerTopbar returns to the Wall.

### What this replaces

The old "Owner's Box" door (`OwnersBoxView.tsx`) housed three tabs — Strategy / Depth Chart / Trade Chart. Depth Chart was already killed. Strategy + Trade Chart are reborn here as Set Strategy + Set Availability with new structure and the war room metaphor wrapping them. The old standalone Historian (`HistorianChat.tsx`) gets folded into the Wall as the persistent chat panel and is no longer its own destination.

### Why the door has sub-pages (when other doors don't)

GM Office and Pro Personnel don't use sub-pages — they have a single landing surface with peripheral elements (drawers, popovers). R&S earns sub-pages because the Wall is *briefing mode* (the strategist surfaces findings) while the editing of strategy and availability is *work mode* (the user makes detailed calls per option or per player). Trying to do all three jobs on one surface would compromise each one. Sub-pages keep each surface honest about its purpose.

---

## Section 3: Architecture — The Wall (Desktop, ≥768px)

```
┌──────────────────────────────────────────────────────────────────────┐
│  [InnerTopbar: ← back · league logo · settings]                       │
│  [Header bar: "Research & Strategy" · Set Strategy · Set Availability]│
├──────────────────────────────────────────┬───────────────────────────┤
│                                           │                           │
│  ┌─────────────────────────────────┐     │  RESEARCH ANALYST          │
│  │ Re: WR alignment                │     │  ┌──────┬──────┐           │
│  │                                  │     │  │Active│Hist. │           │
│  │ "Our WR room is bottom-3 in     │     │  └──────┴──────┘           │
│  │  the league. Worth bumping."    │     │                            │
│  │                                  │     │  [conversation thread]    │
│  │ [Bump WR to buy] [Not now]      │     │                            │
│  └─────────────────────────────────┘     │                            │
│                                           │                            │
│  ┌─────────────────────────────────┐     │                            │
│  │ Re: Aging assets at WR          │     │                            │
│  │                                  │     │                            │
│  │ "Three of our WRs hit aging..."  │     │                            │
│  │                                  │     │                            │
│  │ [Move them] [Not now]            │     │                            │
│  └─────────────────────────────────┘     │  [Ask the Research Analyst…]│
│                                           │                            │
│  ─── 3 more below ─────                   │                            │
│                                           │                            │
└──────────────────────────────────────────┴───────────────────────────┘
   ← ~70% (wall) →                            ← ~30% (chat) →
```

- **InnerTopbar:** standard inner-page topbar (back arrow / league logo / settings). Inherits from GM Office spec.
- **Header bar:** page title left (*"Research & Strategy"*); two action buttons right (*"Set Strategy"*, *"Set Availability"*).
- **Main content area (~70%):** vertical wall of insight cards. Two cards visible at once (top + bottom). Scrollable panel — additional cards below the fold. Hard line + chevron + *"X more below"* indicator at the bottom of the visible area when there are more cards below. Indicator disappears when scrolled to the bottom or when the wall is empty.
- **Right rail (~30%):** persistent chat panel. Header label *"RESEARCH ANALYST"* (JetBrains Mono uppercase), two tabs (*Active chat* / *History*), full chat UI below.

### The queue mechanic

Wall is a queue, not a grid. Cards sort by urgency (red → yellow → default), then by recency within tier. The lead card sits at the top of the visible area. When user acts on a card or dismisses it, the card slides off the top, the next card promotes up, a new card (if any) appears in the bottom slot.

User can scroll vertically to see cards below the fold. Cards above the visible area (scrolled past, not acted on) remain on the wall — natural scroll-up brings them back.

---

## Section 4: Mobile Layout (<768px)

```
┌─────────────────────────────────┐
│  [topbar: hamburger / logo / ⚙] │
├─────────────────────────────────┤
│  [Set Strategy] [Set Availability] │  ← pinned top
├─────────────────────────────────┤
│                                  │
│                                  │
│   ┌──────────────────────┐      │
│   │ Re: WR alignment     │      │  ← swipeable card deck
│   │                       │      │
│   │ "Our WR room is..."   │      │
│   │                       │      │
│   │ [Bump] [Not now]      │      │
│   └──────────────────────┘      │
│                                  │
│           • • • • •              │  ← deck position dots
│                                  │
├─────────────────────────────────┤
│  [Ask the Research Analyst…]    │  ← pinned chat input
└─────────────────────────────────┘
```

- **Top bar:** InnerTopbar mobile pattern (hamburger / logo / settings).
- **Pinned action buttons** (immediately below topbar): *"Set Strategy"* and *"Set Availability"*. Always visible during card swiping.
- **Main content:** swipeable card deck. One card visible at a time. Horizontal swipe cycles through the cards. Position dots below the card show progress through the deck.
- **Pinned chat input** (bottom): single-line *"Ask the Research Analyst…"*. Tap or start typing → expands to full-screen chat takeover. Close → returns to wall.

When the wall has zero cards, the swipeable deck is replaced by the empty state copy (centered, no card).

---

## Section 5: The Wall — Card Lens Types

The strategist runs **6 lenses** against the user's roster + strategy + league data. Each lens can produce a card if its trigger fires. The engine selects the top 3-7 cards by urgency and recency, ordered red → yellow → default.

Six lenses:

1. **Settings staleness** — strategy hasn't been refreshed recently
2. **Aging roster scan** — players in or entering position-specific aging buckets (incorporates the *"shop before value drops"* age curve framing)
3. **Position alignment** — current position market doesn't match roster reality
4. **Championship insights** — comparison against title-team patterns
5. **Value calibration** — team-specific player value drifted significantly from CFC consensus
6. **Attachment drift** — availability tag mismatched with current value

Cap on cards: 3-7 visible. Below 3 = empty state.

### Urgency triggers per lens

| Lens | Yellow trigger | Red trigger |
|---|---|---|
| Settings staleness | 28-59 days since last update | 60+ days |
| Aging roster scan | Aging asset detected | Never red — internal data alone isn't strong enough signal |
| Position alignment | Mismatch detected | Severe mismatch (bottom-3 league rank) AND market not adjusted in 28+ days |
| Championship insights | Always informational | Never red — aspirational, no time pressure |
| Value calibration | Drift detected | Manual override stale 60+ days AND drift ≥20% from auto value |
| Attachment drift | Tag/value mismatch | Top-3 player tagged moveable for 28+ days |

Four lenses can hit red: staleness, position alignment, value calibration, attachment drift. Two cap at yellow: aging scan, championship.

Door's overall status on the home screen = highest tier from any card on the wall. Empty wall + only staleness reminder → status driven by staleness threshold (under 28 days = green, 28-59 = yellow, 60+ = red).

---

## Section 6: The Wall — Card Structure

Every wall card has the same anatomy:

```
┌───────────────────────────────┐
│ Re: WR alignment              │  ← chrome (subject line)
├───────────────────────────────┤
│                                │
│ "Our WR room is bottom-3 in   │  ← headline (director's voice in quotes)
│  the league. Worth bumping."   │
│                                │
│ [supporting data line]         │  ← optional one-line context
│                                │
│ [Primary action]    [Not now] │  ← actions, right-aligned
└───────────────────────────────┘
```

- **Chrome (top band):** thin header band containing *"Re: [topic]"*. JetBrains Mono, uppercase, muted. Hairline divider below it. The chrome serves as the card's label — what kind of finding this is.
- **Headline:** director's voice, in quotes. Syne 700, prominent. The strategist speaking.
- **Supporting data line:** optional one-line context (DM Sans). Some lenses need supporting data; some don't.
- **Actions:** primary action button (filled, blue, the suggested edit) + dismiss button (outlined ink, *"Not now"*). Bottom-right of the card.

### Subject line examples (per lens)

- *Re: WR alignment* (position alignment)
- *Re: Aging assets at WR* (aging scan)
- *Re: Strategy refresh* (settings staleness)
- *Re: Lamb's value drift* (value calibration)
- *Re: Lamb's availability* (attachment drift)
- *Re: Title teams at WR* (championship)

Subject lines are **specific and conversational**, not categorical. Each card's subject identifies the topic of *that finding*, not just the lens type.

### Action mechanics

The primary action varies by lens. Two patterns:

**Inline edit (silent):** primary action fires the underlying setting change directly. Card flips to back, *"DONE"* stamp lands in Syne 900 rotated ~10° (the rubber-stamp moment), card slides off the top of the wall. New card promotes up.

**Route-out:** primary action navigates to another surface. Card flips to back, *"FILED"* stamp lands, slides off, then navigation fires. (Consider whether stamp + nav timing is right at build — could be that route-out cards just flip-and-slide without staying on the back.)

| Lens | Action type | Destination / Effect |
|---|---|---|
| Settings staleness | Route-out | `/research-strategy/set-strategy` |
| Aging roster scan | Route-out | Trade Studio with player pre-selected on the block, drawer pre-generated, roster panel still visible on the left for adding more |
| Position alignment | Inline edit | Bumps the relevant position market |
| Championship insights | Varies | Some inline (e.g., bump market), some route-out (e.g., to Pro Personnel landing for "go acquire" cards) — engine determines per card |
| Value calibration | Route-out | `/research-strategy/set-availability` with that player anchored |
| Attachment drift | Inline edit | Changes the tag (e.g., to Untouchable) |

For "go acquire" cards (championship lens recommending we grab a position type): route to Pro Personnel landing. Optional position filter via deep link (`/pro-personnel?position=WR`) — flagged as build-time consideration.

### Dismiss mechanic

Dismiss button is always present. Tap *"Not now"* → card slides off the top **without flipping or stamping**. Different motion vocabulary than primary action — deferral is not a celebration.

Dismissed cards enter a **28-day cooldown**. The lens won't re-surface that card for 28 days. After cooldown, if the underlying condition still holds, the card can return.

Acted-on cards have **no cooldown** — the action presumably resolved the condition. The card only resurfaces if the condition recurs naturally later.

---

## Section 7: The Wall — Refresh, Empty State, Behavior

### Refresh mechanics

Wall computes **on page entry only**. User opens R&S → engine runs all 6 lenses → picks top 3-7 cards → renders. User acts on cards / dismisses them, wall shrinks. User leaves and returns later → fresh recompute.

**No manual refresh button.** Wall is curated insights, not an endlessly-scrollable feed. Users come back later if they want a fresh take.

### Empty state

When the wall has 0 cards, the wall area shows centered empty-state copy:

> *"Nothing pressing this week, but it's been X days since our strategy was updated."*

The X-days reference is the always-on persistent floor reminder. Even in empty state, the staleness check is the strategist's baseline pulse.

No empty-state card, no illustrations — just copy + the visible chat input as the obvious next move. The wall is genuinely empty because there's nothing to brief; placeholder content would contradict that.

### Card priority sort

Cards on the wall sort top-to-bottom:
1. Red cards first
2. Yellow cards next
3. Default (no urgency tier) cards last
4. Within each tier, sort by recency / freshness

The home screen briefing previews the **top card on the wall** (lead card, slot #1). Pattern A from the home screen briefing decision — home brief = preview of what's on top inside the room.

### Wall scroll affordance

When more cards exist below the visible 2-card area:

- 2.5px hard Ink line at the bottom of the visible panel
- Below the line: small chevron-down (Ink, ~12px) + JetBrains Mono label *"X more below"*
- Indicator only renders when there are cards below the fold
- Disappears when user scrolls to the bottom or empties the wall

When user scrolls past cards (without acting on them), they remain on the wall above the viewport. Natural scroll-up brings them back. No top indicator needed.

---

## Section 8: Chat Surface — The Research Analyst

### Desktop (persistent right rail, ~30%)

Always visible while on the Wall. Rail width: ~360px on a 1200px content area (roughly 30%).

```
┌──────────────────────────┐
│ RESEARCH ANALYST         │  ← header label, JetBrains Mono uppercase
├──────────────────────────┤
│ ┌────────┬─────────────┐ │
│ │ Active │  History    │ │  ← two tabs
│ └────────┴─────────────┘ │
├──────────────────────────┤
│                           │
│  [conversation thread]    │  ← message thread, scrollable
│                           │
│                           │
│                           │
├──────────────────────────┤
│ [Ask anything…       ➤]  │  ← input
└──────────────────────────┘
```

- **Header:** *"RESEARCH ANALYST"* — JetBrains Mono 700, uppercase, small. Light identity, no extra branding.
- **Tabs:** Active chat (default) + History. Active shows current conversation; History shows list of past conversations, click one to load it back into Active.
- **Full chat UI** — message thread visible by default. Persistent panel means user wants to see prior context, not a collapsed input.
- **Input pinned at bottom** of the panel.
- **No suggested prompts.** Killed.

### Mobile (pinned input → full-screen chat)

```
[Ask the Research Analyst…]   ← pinned bottom input on the wall
```

Tap or start typing → full-screen chat takeover. Same Active / History tabs, same content, just full-viewport. Close affordance (top-right) returns to the wall.

### Default state (first-ever visit, no conversations)

Active tab shows just the input + a one-line introduction: *"Ask me anything about the league."* No fun-fact card, no welcome screen, no suggestion chips.

### Conversation persistence

V1: localStorage (existing pattern from `HistorianChat`). Move to backend deferred — not blocking.

### Reuse vs. rebuild

The existing `HistorianChat` component handles conversation logic, message rendering, markdown parsing, and the API call. Rebuild would be wasteful. Adapt:
- Strip the existing left-side conversation sidebar (won't fit at 360px wide)
- Add the two-tab structure (Active / History)
- Update header label to *"RESEARCH ANALYST"*
- Rip out suggested prompts and welcome screen
- Plug into the wall's right rail or mobile pinned-input pattern

---

## Section 9: Set Strategy Sub-Surface

Sub-page for editing wants_more (Wants More) and position markets (Position Markets). Reached via *"Set Strategy"* button in the wall's header.

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
│  │PICKS │  │STUDS │  │YOUTH │  │DEPTH │       │  ← 4 cards
│  └──────┘  └──────┘  └──────┘  └──────┘       │
│                                                │
│  ───── WHERE WE STAND ─────────────            │
│                                                │
│  ┌──────┐  ┌──────┐  ┌──────────┐  ┌──────┐   │
│  │ QB   │  │ RB   │  │PASS CATCH│  │PICKS │   │  ← 4 cards
│  └──────┘  └──────┘  └──────────┘  └──────┘   │
│                                                │
└──────────────────────────────────────────────┘
```

- **InnerTopbar:** back / logo / settings. Page title *"Set Strategy"* in the content area below the topbar (not in the topbar itself).
- **No header action buttons** — already on a sub-page; button repetition would be redundant.
- **No chat panel.** Sub-pages are full-width work mode. Director's advice is baked into the per-card prose.
- **Two horizontal-rail sections:** *Where we're going* (Wants More) + *Where we stand* (Position Markets). Both rails fit the viewport simultaneously without page scroll on a typical 800px+ viewport.
- **Section bars:** existing SectionBar pattern (black rectangle bookend + horizontal rule).

### Section copy (locked)

- Wants More section header: ***"Where we're going"***
- Position Markets section header: ***"Where we stand"***

Parallel construction. Forward-looking + current-state framing.

### Wants More cards (4)

Cards: **Picks**, **Studs**, **Youth**, **Depth**.

Each card:
- Chrome header: category label (*"PICKS"* / *"STUDS"* / *"YOUTH"* / *"DEPTH"*)
- Director prose (state-aware): the strategist makes the case for or describes the option, referencing user's actual roster reality. *"Our roster is averaging 27.5 at WR. Worth prioritizing youth."* (when youth is unselected) → *"Youth's on the agenda. We're targeting young assets."* (when selected).
- Toggle action: tap card → toggles selected/unselected state. Multi-select.
- Selected state: Ink-fill background, Paper text. Unselected: Paper background, Ink text.

### Position Markets cards (4)

Cards: **QB**, **RB**, **Pass Catchers**, **Picks**.

Pass Catchers consolidates WR + TE into a single bucket (see Section 17 for data-model implications).

Each card:
- Chrome header: position label (*"QB"* / *"RB"* / *"PASS CATCHERS"* / *"PICKS"*)
- Director prose (state-aware)
- Roster preview:
  - QB: top 3 players at QB on user's roster
  - RB: top 3 players at RB
  - Pass Catchers: top 5 (WR + TE combined, sorted by value desc)
  - Picks: round breakdown (*"Firsts: 1 in 26, 2 in 27, 1 in 28 / Seconds: ... / Thirds: ..."*)
- Three action buttons inline at the bottom: **Buying** / **Holding** / **Selling**
- Active button: Ink-fill, Paper text. Inactive buttons: outlined Ink, Ink text.

### Vocabulary

**"Buying / Holding / Selling"** — gerund form, matches Pro Personnel's existing chip language ("BUYING WR"). Replaces the implementation-leaking "High / Med / Low" vocabulary in the current StrategyTab.

### Mobile pattern

Snap-snap:
- Vertical snap between the two sections (swipe up to move from *Where we're going* to *Where we stand*)
- Horizontal snap within each section (one card at a time, peek of next on the right)

Section bars stay at the top of each snapped section.

### Autosave

Every tap saves immediately. Toast confirmation top-center (existing pattern). No save button. Consistent with how trade chart and attachment already work.

---

## Section 10: Set Availability Sub-Surface

Sub-page for per-player attachment + per-asset value editing. The card collection — your team's tradeable assets as Topps cards. Reached via *"Set Availability"* button in the wall's header.

### Concept

Each player IS a Topps card. The user is the GM holding their team's collection. Pro Personnel cards = other teams' players (scouting); Set Availability cards = your team's players (managing). Same visual language, opposite ownership.

### Layout (Desktop, ≥768px)

```
┌──────────────────────────────────────────────┐
│  [InnerTopbar]                                 │
│  [Set Availability]                            │
├──────────────────────────────────────────────┤
│  ───── QB ───────────────────────────         │
│  ┌───┐ ┌───┐ ┌───┐                            │  ← cards sorted by value desc
│  │ ▒ │ │ ▒ │ │ ▒ │                             │
│  └───┘ └───┘ └───┘                             │
│                                                │
│  ───── RB ───────────────────────────         │
│  ┌───┐ ┌───┐ ┌───┐ ┌───┐ ┌───┐                │
│  │ ▒ │ │ ▒ │ │ ▒ │ │ ▒ │ │ ▒ │                │
│  └───┘ └───┘ └───┘ └───┘ └───┘                │
│                                                │
│  ───── PASS CATCHERS ────────────────         │
│  [horizontal scroll rail of player cards]      │
│                                                │
│  ───── PICKS ────────────────────────         │
│  ┌────┐ ┌────┐ ┌────┐                         │
│  │1RDR│ │2RDR│ │3RDR│                          │  ← per-round pick cards
│  └────┘ └────┘ └────┘                          │
└──────────────────────────────────────────────┘
```

- **Four position-grouped rails:** QB / RB / Pass Catchers / Picks.
- **Position rails contain player cards.** Cards sorted by value descending (top = top guy).
- **Picks rail contains per-round pick cards** (First Rounders / Second Rounders / Third Rounders).
- **2 rails fully visible** at once on a typical 800px+ desktop viewport. User scrolls vertically to see Pass Catchers and Picks.
- **No director's voice** on this surface. The wall already carries strategic commentary; this is the work surface where the user makes the calls. Cards' visual design (color treatments, marker chips) communicates state.

### Mobile pattern

Snap-snap:
- Vertical snap between rails (swipe up to move from QB to RB to Pass Catchers to Picks)
- Horizontal snap within each rail (one card at a time, peek of next on the right)

**Build note:** revisit the peek pattern at mockup time — confirm it lands right with the larger pick cards.

### Why position-grouped (not tier-grouped)

Tier-grouping (Untouchable / Core / Listening / Moveable) was the alternative. Position-grouping wins for three reasons:

- **Depth chart absorbs.** The old Depth Chart tab was killed; position-grouped rails functionally replace it (top of each rail = your starters, bottom = depth).
- **Tier decisions need position context.** Deciding if a guy is "core" or "listening" requires comparing him to your other players at that position.
- **Mirrors Set Strategy.** Position Markets uses QB / RB / Pass Catchers / Picks — same four buckets. The two sub-pages share structure.

Tier still surfaces per-card via the availability chip — just not the organizing axis.

---

## Section 11: Player Card Anatomy

Used in Set Availability's QB / RB / Pass Catchers rails. ~200px wide × ~280-300px tall. Slightly bigger than Pro Personnel's player cards (which are ~180×220) due to the inline interactive rows.

### Front

```
┌────────────────────────────┐
│ [pic]  LAMAR JACKSON       │  ← chrome: portrait + name
├────────────────────────────┤
│ QB · BAL · 27               │  ← meta line
│ [STUD] [YOUTH]              │  ← marker chips
│                              │  ← breathing space
├────────────────────────────┤
│ Availability: [Moveable ✏️] │  ← bicolor row, blue
├────────────────────────────┤
│ Price: [$300 ✏️]            │  ← bicolor row, green/red dynamic
└────────────────────────────┘
```

### Card body (background frame)

- Background: Paper (#FEFCF9)
- Border: 2.5px solid Ink (#1A1A1A)
- Box shadow: 4px offset Ink
- No rounded corners

### Chrome (top band)

- Background: **Ink (#1A1A1A)**
- Height: ~50-56px to fit portrait + name
- 2px Ink divider below it
- Layout: portrait left, name right of portrait

**Portrait:** ~36-40px square cut (no rounded corners). Sourced from Sleeper's public CDN (`sleepercdn.com/content/nfl/players/thumb/{sleeper_player_id}.jpg`). Fallback when portrait unavailable: position-color block with player initials in Syne 800 Paper. Build-side detail.

**Name:** Syne 800, ~16-18px, Paper (#FEFCF9), one line, autoshrinks for long names (e.g., *"Marquise Brown"* shrinks until it fits).

### Body

**Meta line:** *"QB · BAL · 27"* — plain DM Sans or JetBrains Mono, Ink, ~10-11px. **No position chip** — just plain text. Position color signaling is dropped from this card type.

**Marker chips:** outlined chips (1.5px Ink border, Paper bg, Ink text), JetBrains Mono 700, ~9-10px, uppercase. Examples: *STUD*, *YOUTH*, *AGING*. Show all that apply (a player can have multiple — e.g., young stud). Info-only — not interactive, no edit affordance, visually distinct from the bicolor interactive rows below.

### Bottom interactive rows (bicolor)

Two rows: Availability (blue) and Price (green/red dynamic). Both rows have **equal height**. ~16-20px breathing space between marker chips and these rows. ~12px between availability row and price row.

#### Two-tone bicolor pattern

Each row is a **connected bicolor unit** — two halves sharing an edge, reading as one bicolor pill.

- **Left half (label):** outlined rectangle. Paper bg + colored outline + colored text. The label name (*"Availability"* / *"Price"*).
- **Right half (interactive value):** filled rectangle. Color-filled bg + Paper text + Paper pencil icon. The current value + edit affordance.

**Filled = interactive. Outlined = label.** Standard UX principle: the part you tap is the visually heavier one.

#### Availability row (blue)

- Left: outlined blue (#3366CC) — Paper bg, blue outline, blue text *"Availability"*
- Right: filled blue — blue bg, Paper text (the tier name: *"Moveable"* / *"Untouchable"* / *"Core"* / *"Listening"*) + Paper pencil icon
- Tap → opens **popover** with 4 tier options. Tap one → chip changes, popover closes. If tier changes the player's overall ranking within the rail, card animates to its new position.

**Tier color signaling is dropped on this card type.** All availability rows are blue regardless of which tier the player is in. The tier name text (in the filled rectangle) carries the tier signal. Pro Personnel cards still use the 4-color tier chip pattern — different sets, different visual languages.

#### Price row (green/red dynamic)

- Color is dynamic based on user's value vs CFC consensus:
  - **At or above CFC:** green (#007370)
  - **Below CFC:** red (#E8503A)
- Left: outlined in the dynamic color — Paper bg, colored outline, colored text *"Price"*
- Right: filled in the dynamic color — colored bg, Paper text *"$300"* + Paper pencil icon
- Tap → flips card to the back

Both halves of the price row tint to the same color — strong unified signal that the price is at-or-above (green) or below (red) CFC. Default to green at CFC; binary above/below, no tolerance band.

### Back of card

```
┌────────────────────────────┐
│ [pic]  LAMAR JACKSON       │  ← chrome (same as front)
├────────────────────────────┤
│ Price: $300                │  ← live value, updates as toggles fire
├────────────────────────────┤
│ vs CFC: ▲8% │ vs last wk: ▲2% │  ← comparisons, divider in middle
│                              │
├────────────────────────────┤
│  −   1sts   +              │  ← pick anchor toggles
│  −   2nds   +              │
│  −   3rds   +              │
└────────────────────────────┘
```

- **Chrome:** identical to front (portrait + name). Identity continuity across both sides.
- **Price row:** same two-tone pattern as front. Live value — updates in real-time as user adjusts toggles. Color also updates live (green/red shifts as the user's value crosses CFC).
- **Comparison row:** divider down the middle. Left half *"vs CFC: ▲8%"*. Right half *"vs last wk: ▲2%"*. Triangle + percentage in the existing color treatment (green up, red down).
  - **vs CFC** updates live as user adjusts (delta moves with their override)
  - **vs last week** is **CFC-vs-CFC** — independent of user's manual override, captures league-wide value movement
- **Breathing space** (~16-20px) before the toggles.
- **Toggles:** 1sts / 2nds / 3rds, each with `−` / value / `+`. JetBrains Mono numerals between the +/- buttons. Existing TradeChartTab pattern.

### Flip mechanics

- Tap value (front) → flips to back. ~200-300ms flip animation.
- Tap **anywhere on the back except the toggle buttons** → flips back to front.
- The +/- toggles are the only carved-out tap zone; everything else flips back.

Saves are automatic — no save button. Trade chart's existing override save pattern.

---

## Section 12: Pick Card Anatomy

Used in Set Availability's Picks rail. ~280-300px wide × ~300-320px tall. Bigger than player cards because pick cards are containers (multiple picks per round) with wider inline content.

### Front

```
┌─────────────────────────────┐
│   First Rounders            │  ← chrome: round name, no portrait
├─────────────────────────────┤
│ '26 1.04 [Moveable] [$325]  │  ← row per pick
│ '27 1st  [Moveable] [$300]  │
│ '28 1st  [Untouch.] [$280]  │
└─────────────────────────────┘
```

### Card body

Same neobrutalist treatment as player cards (2.5px Ink border, 4px offset shadow, Paper bg, no rounded corners).

### Chrome

- Background: **Ink (#1A1A1A)**
- Content: round name centered (*"First Rounders"* / *"Second Rounders"* / *"Third Rounders"*). Syne 800, Paper, prominent.
- **No portrait** (no player to portray). No additional meta — just the round name.

### Body — pick rows

Each pick owned in this round renders as a row:
- Pick label: year + slot, abbreviated (e.g., *"'26 1.04"*, *"'27 1st"*, *"'28 1st"*). DM Sans or JetBrains Mono, Ink.
- Availability chip (filled-only treatment — see below)
- Price chip (filled-only treatment)

Inline horizontally — three elements per row.

#### Inline chip treatment (compact bicolor — filled side only)

Pick rows can't fit the full bicolor labeled treatment used on player cards. Compact version drops the outlined "AVAILABILITY:" / "PRICE:" label halves.

- **Availability chip:** filled blue (#3366CC), Paper text *"Moveable"* / *"Untouchable"* / etc. Compact ~70-80px wide.
- **Price chip:** filled green (above-or-at CFC) or red (below CFC), Paper text *"$300"*. Compact ~60-65px wide.

Same color language as player cards (blue for availability, green/red dynamic for price), just stripped of the outlined label half. Different "card sub-type" within the same set.

### Tap behavior

**Tap any pick row** (not just the chips — the whole row is the tap target) → card flips to the back, showing the editor for **that specific pick**.

### Back of card (per-pick editor)

```
┌─────────────────────────────┐
│   2026 1.04                 │  ← chrome: pick id (replaces round name)
├─────────────────────────────┤
│ Price: $325                 │
├─────────────────────────────┤
│ vs CFC: ▲8% │ vs last wk: ▲2% │
├─────────────────────────────┤
│ Availability: [Moveable ✏️] │
├─────────────────────────────┤
│  −   1sts   +              │
│  −   2nds   +              │
│  −   3rds   +              │
└─────────────────────────────┘
```

- **Chrome:** the specific pick's identifier (*"2026 1.04"*) replaces the round name. User knows which pick they're editing.
- **Body:** essentially identical to player card back — Price row + Comparison row + Availability row + Toggles.
- **Per-pick availability tags use the 4-tier system** (Untouchable / Core / Listening / Moveable). Same as players.

### Flip back

Tap anywhere except toggles → flips back to the round-card front.

### Internal scroll for overflow

Pick cards have a fixed height. When a user has 5+ picks in a round (rare — typical is 3-4), the body engages **internal vertical scroll**.

- Same hard-line + chevron + *"X more"* pattern used on the wall, applied inside the card body when picks extend below the visible area
- Vertical scroll inside the card; horizontal swipe still navigates the rail. Different axes, no gesture conflict.

### Pick value flexibility (system-level note)

Pick values become flexible (parallel to player values):
1. **Layer 1 (team strategy modifier, auto):** picks_market and wants_more drive team-specific multipliers on pick values. Rebuilders see picks higher; all-in teams see them lower. Parallel to studs/youth modifiers on players.
2. **Layer 2 (per-pick manual override, user):** the back-of-card pick anchor adjuster sets manual values per pick. Captures class-quality intuitions (loaded 2027 class, etc.).

The auction anchor (e.g., 1.01 = $300) stays as the league-level CFC reference. Team-level modifiers don't break the anchor — they just give each team's *trade view* its own multiplied value. Same architecture as players.

Build note: Layer 1 (team modifier on picks) is parallel logic to existing player modifiers — moderate add. Layer 2 (manual override) already works in the trade chart codebase for picks.

---

## Section 13: Topbar Treatment

Inherits from `CFC-GM-OFFICE-SPEC.md` — same `InnerTopbar` component on all R&S surfaces.

### Desktop

| Slot | Content | Behavior |
|---|---|---|
| Left | ← back arrow | Returns to home (org chart) — from Wall. From sub-pages, returns to Wall. |
| Center | CFC league logo (clickable) | Returns to home (org chart) |
| Right | Settings icon | Opens settings menu |

### Mobile

| Slot | Content | Behavior |
|---|---|---|
| Left | Hamburger menu | Opens global navigation drawer |
| Center | CFC league logo (clickable) | Returns to home (org chart) |
| Right | Settings icon | Opens settings menu |

R&S does **not** use Pro Personnel's dynamic-section-title topbar pattern on mobile. The wall is one surface (no sections to label), and sub-pages have their own page titles in the content area. Center stays the league logo.

---

## Section 14: Cross-Spec Notes (For Master Design Session)

Items flagged during R&S design that need decisions or updates beyond this spec. These belong in the future master design session that will run after all four door specs are complete:

1. **Cross-door consistency on briefing-to-room continuity.** R&S locked Pattern A — home screen director's briefing previews the top card on the wall inside the room. Should every door follow the same rule (briefing = preview of what's on top inside the room)? Pro Personnel's Director's Pick offer card and GM Office's inbox don't yet have this rule explicitly applied to their home briefings. Decide once, apply everywhere.

2. **Three-tier urgency system per door.** Green / yellow / red as universal status. R&S can now go red, which **reverses what the home screen spec v2.0 says about R&S never going red** (Section 3.4). The home screen spec needs updating in the master pass.

3. **Card system survey.** Different "sets" of cards across the app — Pro Personnel player cards (~180×220), Pro Personnel team cards (~280×140), GM Office persona cards, Set Strategy cards, Set Availability player cards (~200×280), Set Availability pick cards (~280×300). All share the design system (2.5px Ink borders, 4px offset shadows, no rounded corners, Paper bg, Topps-style chrome) but each set has its own dimensions and content shape. Master session should codify the system.

4. **Mobile peek pattern revisit for Set Availability.** Set Availability uses pick cards bigger than the typical player card peek pattern was designed for. Revisit at mockup time to confirm peek lands right with the larger cards.

5. **GM Office spec needs updating.** GM Office Section 8's Propose popover was killed by Pro Personnel spec (Section 14, item 5). The GM Office spec should be updated to reflect Propose routing directly to `/trade-builder`. Already noted.

6. **Card-flip animation specifics.** Set Availability cards (player + pick) use card-flip for value editing. The wall also uses card-flip + slide-off. Animation timing, easing, reverse-flip behavior should be spec'd as a shared pattern in the master session.

7. **Stamp aesthetic for action confirmation.** Wall cards use *"DONE"* stamp for inline edits and *"FILED"* stamp for route-out actions (or just flip-and-slide for route-out — TBD at build). Visual specifics of the stamp (font, rotation, color) aren't fully designed.

---

## Section 15: Items Killed in This Redesign

These exist in the current codebase and are removed:

1. **`src/components/owners-box/OwnersBoxView.tsx` and the "Owner's Box" door concept** — the door is gone. Its content is split between Set Strategy (wants_more + position markets), Set Availability (attachment + trade values), and the wall (where strategic findings now surface).
2. **`src/components/owners-box/StrategyTab.tsx`** — replaced by the Set Strategy sub-page with the war room aesthetic.
3. **`src/components/owners-box/TradeChartTab.tsx`** — replaced by the Set Availability sub-page with per-player cards.
4. **`src/components/owners-box/DepthChartTab.tsx`** — already killed pre-spec; functionally absorbed by Set Availability's position-grouped rails.
5. **`src/components/owners-box/PersonaPicker.tsx` and `PersonaCard.tsx`** — persona is migrated to the GM Office nameplate (per GM Office spec Section 4). Dead code on this surface.
6. **`src/components/historian/HistorianChat.tsx` standalone usage** — the historian becomes the Wall's persistent right-rail chat panel. Standalone route to the Historian (if any) is killed.
7. **`src/components/historian/WelcomeScreen.tsx`** — welcome screen, fun fact, suggested prompt cards all killed. Default state is just the input + one-line intro.
8. **`src/components/historian/ConversationSidebar.tsx`** — left-side conversation sidebar replaced by the two-tab pattern (Active / History) within the chat panel.
9. **The "Save Profile" button** in current StrategyTab — replaced by autosave on every tap. Strategy was the only inconsistent surface; now matches trade chart and attachment.
10. **High / Med / Low vocabulary** in current StrategyTab UI — replaced by Buying / Holding / Selling.
11. **Per-position WR and TE markets in the UI** — consolidated into Pass Catchers (aggregate display).
12. **The 4-color availability chip pattern on Set Availability cards** — these cards drop tier color signaling in favor of the blue+green/red two-tone treatment. (Pro Personnel and other surfaces still use the 4-color pattern; this is a Set Availability-specific change.)

---

## Section 16: Files Affected

### Replace / Retire

- `src/components/owners-box/OwnersBoxView.tsx` — retire
- `src/components/owners-box/StrategyTab.tsx` — retire
- `src/components/owners-box/TradeChartTab.tsx` — retire
- `src/components/owners-box/DepthChartTab.tsx` — retire (already inactive)
- `src/components/owners-box/PersonaPicker.tsx` — retire
- `src/components/owners-box/PersonaCard.tsx` — retire
- `src/components/owners-box/Card.tsx` — retire (specific to old Owner's Box layout)
- `src/components/historian/WelcomeScreen.tsx` — retire
- `src/components/historian/ConversationSidebar.tsx` — retire

### Adapt / Update

- `src/components/historian/HistorianChat.tsx` — adapt for the persistent right-rail chat surface. Strip sidebar, add two-tab pattern, update header label, kill suggested prompts.
- `src/components/historian/ChatInput.tsx` — likely reusable as-is, may need styling tweaks.
- `src/components/historian/ChatMessage.tsx` — likely reusable as-is.
- `src/components/historian/markdown.tsx` — reusable as-is.
- `src/components/historian/types.ts` — reusable as-is.

### New components

- `src/components/research-strategy/RSLanding.tsx` — top-level page composing topbar + header bar + wall + chat panel (desktop) / pinned-input (mobile). Mounts at `/research-strategy`.
- `src/components/research-strategy/Wall.tsx` — wall queue rendering (2-up cards stacked, scroll affordance, urgency sort, empty state).
- `src/components/research-strategy/InsightCard.tsx` — single wall card (chrome + headline + supporting line + actions).
- `src/components/research-strategy/CardActions.tsx` — primary action button + dismiss button + flip/stamp/slide-off animations.
- `src/components/research-strategy/DoneStamp.tsx` — the rubber-stamp moment shown on the back of acted-on cards.
- `src/components/research-strategy/RSChatPanel.tsx` — the persistent right-rail chat. Two tabs (Active / History). Wraps the adapted HistorianChat content.
- `src/components/research-strategy/RSHeaderBar.tsx` — wall's header bar (page title + Set Strategy / Set Availability buttons on desktop; mobile pinned-top).
- `src/components/research-strategy/EmptyWall.tsx` — empty-state copy.
- `src/components/research-strategy/SetStrategyPage.tsx` — top-level Set Strategy page. Mounts at `/research-strategy/set-strategy`.
- `src/components/research-strategy/StrategyCard.tsx` — single card on Set Strategy (used for both Wants More and Position Markets variants).
- `src/components/research-strategy/SetAvailabilityPage.tsx` — top-level Set Availability page. Mounts at `/research-strategy/set-availability`.
- `src/components/research-strategy/PlayerCard.tsx` — Set Availability player card (front + back, flip mechanics).
- `src/components/research-strategy/PickCard.tsx` — Set Availability pick card (front + back, internal scroll for overflow).
- `src/components/research-strategy/AvailabilityPopover.tsx` — small popover with 4 tier options for the player card's availability chip.
- `src/components/research-strategy/PickAnchorAdjuster.tsx` — the +/- toggles for 1sts/2nds/3rds, used on the back of player cards and pick-editor backs of pick cards.

### New / extended APIs

- `/api/research-strategy/wall` — generates the wall (runs all 6 lenses, returns top 3-7 cards by urgency)
- `/api/research-strategy/dismiss` — records dismissal for cooldown
- `/api/research-strategy/act` — records that a card's action was taken (for cooldown / no resurfacing)
- Extension to existing strategy / attachment / trade-chart endpoints for the inline-edit lens actions

### Reuse untouched

- `src/components/historian/types.ts` and supporting utility files
- `src/lib/storedTeam.ts`, `src/lib/hooks/useMyRoster.ts` — used by Set Availability for roster data
- `src/lib/team-hq/types.ts` — strategy profile types used by Set Strategy

---

## Section 17: Build Order Recommendation

Suggested sequence to ship cleanly without broken intermediate states. Each step should produce a buildable commit (one file at a time via GitHub web editor).

### Phase 1 — Card primitives

1. **`InsightCard.tsx`** — wall card with chrome + headline + supporting line + action buttons. Stub data initially.
2. **`DoneStamp.tsx`** — the rubber-stamp confirmation overlay. Standalone component.
3. **`CardActions.tsx`** — primary + dismiss buttons with flip-stamp-slide animation hooks. Standalone.
4. **`PickAnchorAdjuster.tsx`** — +/- toggle component for pick anchors. Standalone.
5. **`AvailabilityPopover.tsx`** — popover with 4 tier options. Standalone.

### Phase 2 — Wall

6. **`EmptyWall.tsx`** — empty state copy.
7. **`Wall.tsx`** — wall queue rendering (2-up stack, scroll affordance, sort logic). Stub card data initially.
8. **`/api/research-strategy/wall`** — endpoint generating the wall. Implement the lenses one at a time:
   - 8a. Settings staleness (simplest, internal data only)
   - 8b. Aging roster scan
   - 8c. Value calibration
   - 8d. Attachment drift
   - 8e. Position alignment (needs league-wide aggregation — see open items)
   - 8f. Championship insights (needs structured data wiring — see open items)
9. **`/api/research-strategy/dismiss` and `/api/research-strategy/act`** — cooldown tracking endpoints.

### Phase 3 — Chat surface

10. **Adapt `HistorianChat.tsx`** — strip sidebar, add two-tab structure, update header to *"RESEARCH ANALYST"*, kill suggestions/welcome.
11. **`RSChatPanel.tsx`** — wraps adapted historian for right-rail (desktop) and pinned-input (mobile) presentation.

### Phase 4 — Wall page composition

12. **`RSHeaderBar.tsx`** — header bar with page title + Set Strategy / Set Availability buttons.
13. **`RSLanding.tsx`** — composes topbar + header bar + wall + chat panel. Mount at `/research-strategy`.

### Phase 5 — Set Strategy

14. **`StrategyCard.tsx`** — single card. Variant for Wants More (toggle), variant for Position Markets (Buying/Holding/Selling buttons + roster preview).
15. **`SetStrategyPage.tsx`** — composes the two horizontal-rail sections. Mount at `/research-strategy/set-strategy`.

### Phase 6 — Set Availability

16. **`PlayerCard.tsx`** — front + back, flip mechanics, two-tone bicolor rows. Standalone with stub data.
17. **`PickCard.tsx`** — front + back, per-pick row layout, flip mechanics, internal scroll. Standalone.
18. **`SetAvailabilityPage.tsx`** — composes the four position-grouped rails. Mount at `/research-strategy/set-availability`.

### Phase 7 — Polish

19. **Dynamic position filter on Pro Personnel** — `/pro-personnel?position=WR` deep-link support for "go acquire" cards. Optional V1, can ship without.
20. **Pick value flexibility** — extend the team-modifier pipeline to include picks (Layer 1 from Section 12).
21. **Animation tuning** — flip timing, slide-off easing, stamp landing.

### Phase 8 — Cleanup

22. **Retire old Owner's Box files** — once everything works, delete `OwnersBoxView.tsx`, `StrategyTab.tsx`, `TradeChartTab.tsx`, `DepthChartTab.tsx`, `PersonaPicker.tsx`, `PersonaCard.tsx`, `Card.tsx`, `WelcomeScreen.tsx`, `ConversationSidebar.tsx`. Remove old route.

---

## Section 18: Open Items / Deferred Decisions

These are NOT blockers for the R&S design. They are flagged for build phase or later work:

1. **Championship lens data wiring.** Lens 4 needs structured access to title-team patterns (year-by-year analysis of championship rosters' position composition, age, etc.). Today the historian can answer free-text questions about league history but doesn't expose structured comparison data as a queryable signal. If unwired at build, this lens ships disabled or capped at a simple stat pull.

2. **Position alignment league-wide aggregation.** Lens 3 needs *"bottom-3 in the league"* style comparisons — every team's position values aggregated and ranked. May need new aggregation queries / views.

3. **Cross-team activity tracking.** Future signal that would let aging-scan and attachment-drift hit red triggers (e.g., *"player has active interest from other teams"*). Today this data isn't tracked. If/when added, the spec already assumes the lens would level up to red.

4. **Pass Catchers data-model migration.** UI consolidates WR + TE into one "Pass Catchers" market card. V1 implementation: aggregate display only — same setting writes to both `wr_market` and `te_market`. Long-term: consider migrating to a single `pass_catchers_market` column with the existing wr/te columns dropped. Defer to data-migration discussion.

5. **Pick value flexibility build.** Layer 1 (team-modifier on picks) is new logic parallel to existing player modifiers. Moderate build add. Layer 2 (manual override) already works — just needs to surface in the new card UI.

6. **Director's-voice content engine for Set Strategy cards.** State-aware prose per card (*"Our roster is averaging 27.5 at WR..."*). Decide between LLM-generated at request time or rule-based templating from team data. Parallel decision to the Pro Personnel director-quip engine.

7. **Wall card content engine — director's-voice headlines.** Each lens's card headline (the in-quotes director prose) is generated content. Same decision: LLM vs. templated.

8. **Position filter deep-link on Pro Personnel.** "Go acquire" cards route to `/pro-personnel?position=WR` to filter Section 2 of Pro Personnel. Pro Personnel currently doesn't support this URL parameter — needs build work to add.

9. **Card-flip animation timing and easing.** Specific durations for: flip-to-back (~250ms?), stamp-hold (~800ms?), slide-off-top (~300ms?), reflow-up (~250ms?). Tune at mockup.

10. **Per-pick availability tag granularity.** Picks use the same 4-tier system (Untouchable / Core / Listening / Moveable) as players. Whether all 4 tiers are useful for picks (or whether picks usually default to Moveable / Listening with rare Core / Untouchable) is a UX question that surfaces in real use. Spec keeps the full 4-tier system; can simplify if data shows only 1-2 tiers ever get used.

11. **Mobile peek pattern revisit on Set Availability.** Pick cards are larger than typical player cards. Confirm peek-of-next-card affordance works at the larger size. Mobile mockup decision.

12. **Backend persistence for chat conversations.** V1: localStorage. V2: backend persistence so conversations survive across devices.

13. **Wall card per-tier sort tiebreakers.** Within yellow tier (multiple yellow cards), what's the secondary sort? By recency of underlying state change? By lens type priority? Defer to build.

14. **Stamp variants per action type.** *"DONE"* for inline edits vs. *"FILED"* for route-outs. Or unify all to one stamp. Decide at mockup.

15. **Vs-last-week comparison data wiring.** The back-of-card comparison row shows *"vs last week"* — CFC consensus value movement over the past week. Requires historical CFC value snapshots. Confirm whether snapshot data exists or needs new wiring.

---

## Section 19: Behavioral Notes

- **Default landing within the door:** the Wall (`/research-strategy`).
- **Logo click on topbar (any R&S surface):** returns to home (org chart).
- **Back arrow on Wall:** returns to home.
- **Back arrow on Set Strategy / Set Availability:** returns to the Wall.
- **Hamburger (mobile):** opens global navigation drawer with all four doors + settings.
- **Header buttons on Wall** (*Set Strategy* / *Set Availability*): direct route to the respective sub-page. Always visible (desktop header bar; mobile pinned top).
- **Wall card primary action:** depending on lens, either inline edit (silent + DONE stamp + slide-off) or route-out (flip + navigate). See Section 6.
- **Wall card dismiss:** card slides off without flipping, no stamp. 28-day cooldown before re-surfacing.
- **Wall scroll:** vertical scroll within the wall panel (not page scroll). Cards above the viewport remain on the wall.
- **Chat panel (desktop):** persistent right rail. Always visible while on the Wall.
- **Chat panel (mobile):** pinned single-line input. Tap or start typing → full-screen chat takeover. Close → returns to Wall.
- **Set Strategy autosave:** every tap saves immediately. Toast confirmation top-center.
- **Set Strategy navigation between sections:** desktop scrolls vertically (both rails visible at once typically); mobile snap-snap (vertical between sections, horizontal within).
- **Set Availability navigation between rails:** desktop vertical scroll (2 rails visible at once); mobile snap-snap (vertical between rails, horizontal within rails).
- **Set Availability player card — availability tap:** opens popover with 4 tier options.
- **Set Availability player card — value tap:** flips card to back. Tap anywhere except toggles → flips back.
- **Set Availability pick card — pick row tap:** flips card to back showing that specific pick's editor. Tap anywhere except toggles → flips back to round-card front.
- **Pick card overflow:** internal vertical scroll within the card body when 5+ picks.

---

## Section 20: Color Palette (Excerpt from Design System)

| Name | Hex | Usage on R&S |
|---|---|---|
| Ink | #1A1A1A | Borders, primary text, chrome backgrounds, action buttons (filled state) |
| Paper | #FEFCF9 | Card backgrounds, chat panel content bg, chrome text on Ink |
| Cream | #F5F0E6 | Page background, hover states |
| Blue | #3366CC | Availability bicolor (label outline + text + filled chip), primary action buttons (Bump, Set, Open) |
| Yellow | #F5C230 | Yellow urgency chip on cards |
| Red | #E8503A | Red urgency chip on cards, Price bicolor when below CFC, error states |
| Green | #007370 | Price bicolor when at-or-above CFC, green deltas in comparison rows |
| Muted | #8C7E6A | Secondary text, timestamps, subject line text in chrome, JetBrains Mono labels |

Full palette in `/docs/CFC-APP-STATUS.md`.

---

## Section 21: Typography (Excerpt from Design System)

| Font | Weight | Usage on R&S |
|---|---|---|
| Syne | 800–900 | Page titles, card chrome (player name, round name), section headers, action button labels, *"DONE"* stamp |
| DM Sans | 400–700 | Director's-voice headlines (in quotes on wall cards and Set Strategy cards), body prose, meta line text, comparison row text |
| JetBrains Mono | 700 | Subject lines (*Re: ...*) on wall cards, marker chip text (*STUD* / *YOUTH* / *AGING*), value display ($XXX), pick row metadata, *"AVAILABILITY"* / *"PRICE"* labels, *"X more below"* indicator, chat panel header (*RESEARCH ANALYST*), tab labels |

Full system in `/docs/CFC-APP-STATUS.md`.

---

## Section 22: Summary — At-a-Glance

| Element | Decision |
|---|---|
| **Routing** | `/research-strategy` (wall) · `/research-strategy/set-strategy` · `/research-strategy/set-availability` |
| **Concept** | Strategist's war room. Director's voice on the wall + Research Analyst voice in the chat |
| **Wall layout (desktop)** | 70% wall (queue, 2-up cards stacked) + 30% persistent chat panel right rail |
| **Wall layout (mobile)** | Pinned-top action buttons + swipeable card deck + pinned-bottom chat input |
| **Card lens types (6)** | Settings staleness · Aging roster scan · Position alignment · Championship insights · Value calibration · Attachment drift |
| **Card capacity** | 3-7 dynamic cards, sorted red → yellow → default. Below 3 = empty state |
| **Card structure** | *Re: subject* chrome + director headline (quotes) + supporting line + primary action + *"Not now"* dismiss |
| **Action mechanics** | Primary edit: flip + DONE stamp + slide-off. Route-out: flip + navigate. Dismiss: slide-off no flip + 28-day cooldown |
| **Wall recompute** | Page entry only. No manual refresh button |
| **Wall scroll affordance** | Hard line + chevron + *"X more below"* JetBrains Mono label |
| **Door urgency** | 3 tiers (green/yellow/red). Highest tier from any wall card sets door status. 4 lenses can hit red |
| **Empty state** | *"Nothing pressing this week, but it's been X days since our strategy was updated."* |
| **Chat surface** | Persistent right rail (~30% on desktop) · Two tabs (Active / History) · *Research Analyst* header · localStorage V1 · No suggestions |
| **Set Strategy** | 2 horizontal-rail sections: *Where we're going* (Wants More: 4 cards) + *Where we stand* (Position Markets: 4 cards). Buying/Holding/Selling vocabulary. Pass Catchers consolidates WR+TE |
| **Set Availability** | 4 position-grouped rails: QB / RB / Pass Catchers / Picks. Position rails contain player cards; Picks rail contains per-round pick cards. 2 rails visible on desktop, vertical scroll for more |
| **Player card** | ~200×280-300px. Chrome (portrait + name) + meta + outlined marker chips + bicolor availability row (blue) + bicolor price row (green/red dynamic). Tap chip → popover. Tap value → flip |
| **Pick card** | ~280×300-320px. Chrome (round name) + pick rows with inline filled chips. Tap row → flip to that pick's editor. Internal scroll if 5+ picks |
| **Pick value system** | Becomes flexible — Layer 1 (team modifier) + Layer 2 (manual override). Auction anchor stays as league reference |
| **Director's voice presence** | Wall: yes (per card). Set Strategy: yes (per card). Set Availability: no (work surface, cards communicate state visually) |
| **Bicolor pattern** | Filled = interactive, outlined = label. Availability: blue. Price: green at-or-above CFC, red below. Default green at CFC |
| **Tier color signaling on Set Availability cards** | Dropped. Tier name carries by text. Pro Personnel cards still use 4-color tier chips |
| **Killed** | OwnersBoxView · StrategyTab · TradeChartTab · DepthChartTab · PersonaPicker · standalone HistorianChat · WelcomeScreen · ConversationSidebar · "Save Profile" button · High/Med/Low vocabulary · old separate WR/TE markets in UI |

---

## End of Spec — Ready for Build

The Research & Strategy design is fully locked. Items intentionally deferred are content-engine choices (director's-voice generation), data-wiring questions (championship structured data, league-wide aggregations, cross-team activity tracking), and animation tuning. All locked items are buildable today against existing or naturally-extended APIs and components.

Pick this up in a build chat by attaching this document along with `/docs/CFC-APP-STATUS.md`, `CFC-HOME-SCREEN-SPEC.md`, `CFC-GM-OFFICE-SPEC.md`, and `CFC-PRO-PERSONNEL-SPEC.md`. The build chat should not need any conversation history beyond these five files to execute the build cleanly.
