# CFC Front Office — Research & Strategy Design Spec

**Version:** 3.0
**Date:** May 14, 2026
**Status:** Design locked — ready for mockup → code

> **Revision note (v3.0):** Major redesign. The R&S Wall (binder grid landing of lens-engine cards) is killed. The director's office is now a **chat-driven workspace** — open the office, the Director of R&S greets you with their top 3 POVs, the chat surfaces inline actions (one-click setting commits, deep links to workrooms). Staff voice (Research Analyst) killed. Workrooms (Set Strategy, Set Availability) are preserved from v2.x with one structural change: **List Card template is killed** — each pick is now an individual Player-style card with contextual chips ("2 more in '26, 1 in '27, none in '28"). Set Strategy and Set Availability remain the source of strategic truth — other directors consume signals from these settings.

---

## Purpose of This Document

This document captures every design decision for the **Research & Strategy door** — the Director of R&S's office (chat-driven) and the two workrooms reached from it (Set Strategy, Set Availability).

This spec must be read alongside:
- `/docs/CFC-APP-STATUS.md` v3.0 (project-wide non-negotiables)
- `CFC-HOME-SCREEN-SPEC.md` v3.0 (home screen routes here)
- `CFC-GM-OFFICE-SPEC.md` v3.0 (inbox is the central "what's new" surface; R&S director files memos there)
- `CFC-SCOUTING-SPEC.md` v3.0 (peer director — same office pattern)
- `CFC-PRO-PERSONNEL-SPEC.md` v3.0 (peer director — consumes R&S signals)

The R&S director's lens is **looking inward** — our team, our preferences, the data that informs our plan. R&S is the source of strategic truth; other doors consume from it.

---

## Section 1: Concept & Metaphor

The R&S door is the **Director of Research & Strategy's office**. The user walks in and the director is at the whiteboard, ready to walk through what needs to be tightened up. One voice in the room — the director themselves. No staff. The conversation is the surface.

When the user opens the office, the director greets them with their top 3 POVs — specific settings recommendations, value drifts, behavior-vs-stated-strategy mismatches. Each POV ends with a recommendation. The user can click any POV to dive in, or type their own question. The director responds with prose AND inline actions — most commonly, **one-click setting commits** (drop Mahomes to Listening, flip WR market to Selling) or deep links into Set Strategy / Set Availability for deeper editing.

R&S is **purely settings**. The director surfaces settings updates; those settings ripple out as signals (Pro Personnel reads aging + position market → produces trade intel; Scouting reads wants_more → weights trade up/down intel). R&S doesn't produce trade cards or draft cards — it produces strategic truth.

---

## Section 2: Architecture & Routing

### Routes

| Route | Surface | Entry points |
|---|---|---|
| `/research-strategy/office` | Director's office (chat) | Home screen R&S box → Office |
| `/research-strategy/set-strategy` | Set Strategy workroom | Home screen R&S box → Set Strategy · Office chat inline action |
| `/research-strategy/set-availability` | Set Availability workroom | Home screen R&S box → Set Availability · Office chat inline action |

### Mental model

Three surfaces inside the door:

1. **Office** — chat-driven workspace, the director's room. The conversation IS the surface.
2. **Set Strategy** — workroom for editing wants_more + position markets. Selector Cards.
3. **Set Availability** — workroom for per-player attachment + per-asset values. Position-grouped Player Cards + individual Pick Cards.

### What this replaces

- The R&S Wall (binder grid landing of lens-engine cards) is killed.
- The 6 lens engines (Aging, Value drift, Attachment mismatch, Position misalignment, Wants More suggestion, Championship comparison) are killed as card-producing engines. The same intel categories survive as **conversation starters** in the office chat.
- The Research Analyst staff voice is killed.

### What's preserved

- Set Strategy and Set Availability sub-pages stay as designed in v2.x with one update: **List Card is killed** — Pick Cards become individual.

---

## Section 3: The Office — Layout

### Desktop (≥768px)

```
┌──────────────────────────────────────────────────────────────────────┐
│  [InnerTopbar: ← back · league logo · settings]                       │
├──────────────────────────────────────────────────────────────────────┤
│                                                                       │
│  DIRECTOR OF RESEARCH & STRATEGY                                      │
│                                                                       │
├──────────────────────────────────────────────────────────────────────┤
│                                                                       │
│   "Boss, three things on my mind:"                                   │
│                                                                       │
│   ┌───────────────────────────────────────────────────────────────┐   │
│   │ 1. Lamb's value is up 18% this month. We've still got him     │   │
│   │    priced where we set him last month — the league's saying   │   │
│   │    he's worth a lot more. We should bump our number.          │   │
│   └───────────────────────────────────────────────────────────────┘   │
│                                                                       │
│   ┌───────────────────────────────────────────────────────────────┐   │
│   │ 2. Mahomes turned 33 last month. We've got him Core but the   │   │
│   │    curve says he's a depreciating asset. I'd drop him to      │   │
│   │    Listening and let me flag him to Pro Personnel as a shop   │   │
│   │    candidate.                                                 │   │
│   └───────────────────────────────────────────────────────────────┘   │
│                                                                       │
│   ┌───────────────────────────────────────────────────────────────┐   │
│   │ 3. Three teams are buying at WR and we're 5-deep — we're      │   │
│   │    holding. This is a chance to sell from strength. Want me   │   │
│   │    to flip us to Selling so Pro Personnel can start scouting  │   │
│   │    deals?                                                     │   │
│   └───────────────────────────────────────────────────────────────┘   │
│                                                                       │
│   Which one do we tackle? Or is there something else on your mind?    │
│                                                                       │
│  ┌─────────────────────────────────────────────────────────────────┐  │
│  │ [Ask the Director of R&S…]                              [Send]  │  │
│  └─────────────────────────────────────────────────────────────────┘  │
└──────────────────────────────────────────────────────────────────────┘
```

- **InnerTopbar:** standard inner-page topbar.
- **Page title:** *"Director of Research & Strategy"* in Syne 800.
- **Chat surface:** full-width. No sidebar, no right rail.
- **Opening message:** director's three POVs as clickable items.
- **Click a POV** → dives into a follow-up conversation.
- **Chat input:** pinned at the bottom. Placeholder *"Ask the Director of R&S…"*.

### Mobile (<768px)

Same shape, full-screen. Standard mobile inner-page pattern.

---

## Section 4: The Director's Opening Message

Same pattern as Scouting and PP. Three POVs max, leading with recommendation.

### R&S Intel Categories (Voice Reference)

**Value drift (player-anchored):**
> *"Lamb's value is up 18% this month. We've still got him priced where we set him last month — the league's saying he's worth a lot more. We should bump our number."*

**Aging player tier mismatch:**
> *"Mahomes turned 33 last month. We've got him Core but the curve says he's a depreciating asset. I'd drop him to Listening and let me flag him to Pro Personnel as a shop candidate."*

**Position market opportunity (selling):**
> *"Three teams are buying at WR and we're 5-deep — we're holding. This is a chance to sell from strength. Want me to flip us to Selling so Pro Personnel can start scouting deals?"*

**Position market opportunity (buying):**
> *"Our WR room is bottom-3 in the league. We're not signaling we want WRs but maybe we should be. Want me to flip us to Buying?"*

**Behavior-vs-stated-strategy:**
> *"We said we want more picks, but we've turned down two pick-heavy offers this month. Are we still committed to that or has the plan shifted?"*

**Attachment mismatch:**
> *"We've got Lamb Moveable but he's our most valuable WR. Either we know something or we should re-tag him."*

### Cross-Director Handoffs

R&S POVs often end with a handoff to PP or Scouting (the user commits a setting; the signal flows to the consuming director). The director acknowledges this explicitly:

> *"Want me to flip us to Selling so Pro Personnel can start scouting deals?"*

The user clicks [Flip to Selling] → API fires → setting changes → next time the user opens PP's office, the director sees "we're selling at WR" and surfaces matching trade intel. The org chart feels alive.

### Voice Rules (Same as Other Directors)

- First person ("we / our")
- Conversational
- Anonymized intel — "three teams are buying at WR" not "Team X has WR market set to Buying"
- No codespeak — no "wants_more," no "attachment tier"
- Leads with recommendation
- Acknowledges cross-director flow naturally

---

## Section 5: Inline Actions in the Chat

Same pattern as Scouting / PP (see those specs Section 5).

For R&S specifically, the most common inline actions are **one-click commits** to settings — drop a player's tier, flip a position market, toggle a wants_more category. The chat is purely settings-driven, no trade proposals.

### R&S-Specific Action Examples

User clicks POV #2 (Mahomes age cliff):

Director responds:
> *"Right — he's been a stalwart but the math doesn't lie. Two things I'd do: drop him to Listening and let me push him into the PP director's view so they can find a buyer."*
>
> [Drop Mahomes to Listening] [Open Set Availability →]

User clicks [Drop Mahomes to Listening] → API fires → message updates in place:

> *"Done — Mahomes is now Listening. I'll let PP know to start looking. ✓"*

The change is committed without leaving the chat. Set Availability deep link is available if the user wants to make more changes.

### Action Types in R&S

| Action Type | Example |
|---|---|
| One-click tier commit | "Drop Mahomes to Listening" |
| One-click market commit | "Flip WR market to Selling" |
| One-click wants_more toggle | "Turn on Wants More: Picks" |
| Price commit | "Bump Lamb's price by 15%" (lighter weight — exact amount derived from recommendation) |
| Deep link to workroom | "Open Set Availability" (scoped to a player when applicable) |
| Multi-option choice | "Drop him to Listening" / "Keep him Core" / "Open Set Availability to decide" |

---

## Section 6: Empty State

When the director has nothing pressing (recent settings updates, no drift, no aging mismatches):

> *"Roster's set, signals are clean, boss. I'll flag anything that shifts. Anything you want to look at?"*

---

## Section 7: Set Strategy Workroom (`/research-strategy/set-strategy`)

Largely unchanged from v2.x. Two horizontal-rail sections of Selector Cards.

### Section A — Where we're going (Wants More)
4 Selector Cards: **Picks**, **Studs**, **Youth**, **Depth**.
- Front: identity stamp + current on/off state + optional director quip referencing roster reality + universal action button (*"Toggle"*).
- Back: single on/off selector. Tap to confirm.
- After confirmation: DONE stamp, auto-flip back showing new state.

### Section B — Where we stand (Position Markets)
4 Selector Cards: **QB**, **RB**, **Pass Catchers**, **Picks**.
- Front: position label + roster preview + current state stamp (*"BUYING"* / *"HOLDING"* / *"SELLING"*) + universal action button (*"Edit"*).
- Back: 3-button picker (Buying / Holding / Selling).

### Vocabulary
"Buying / Holding / Selling" — gerund form. Matches PP's existing chip language.

### Mobile
Snap-snap pattern: vertical snap between sections, horizontal snap within each section.

### Autosave
Confirmation on the back of each Selector Card IS the save event. DONE stamp = save confirmation. No save button.

### Open Item (v2.x — preserved)
Selector Card flip vs. inline edit. The spec acknowledges the flip is a 2-tap change for a setting. System consistency wins, but mark "revisit flip vs. inline edit at mockup time" as a build decision. Test both patterns side by side.

---

## Section 8: Set Availability Workroom (`/research-strategy/set-availability`)

Largely unchanged from v2.x. Four position-grouped rails (QB / RB / Pass Catchers / Picks).

### Player Cards (QB / RB / Pass Catchers rails)

Each player is a Player Card following the universal Player Card template.

**Front:**
- Chrome: photo + name + memo corner (when applicable)
- Meta line: position · team · age
- Marker chips: STUD / YOUTH / AGING where applicable
- Availability display: filled chip showing current tier (Moveable green / Listening yellow / Core black / Untouchable red — universal color treatment)
- Price display: current price + color cue (green at-or-above CFC, red below)
- Universal action button: *"Edit"*

**Back:**
- Availability section: 4-button tier picker (Untouchable / Core / Listening / Moveable). Tap → commits + DONE stamp + flip back.
- Price section: +/- adjuster with vs CFC / vs last week deltas. Auto-save.
- Pick Anchors section: +/- toggles for 1sts/2nds/3rds.

### Pick Cards (Picks rail) — UPDATED IN V3.0

**List Card template is killed.** Each pick is now an individual card following the Player Card template structure.

**Front:**
- Chrome: pick identifier (e.g., *"2026 2.04"* in large type)
- Contextual chip line below the identifier: shows the user's other picks in that round (e.g., *"2 more in '26, 1 in '27, none in '28"*). Non-interactive — purely contextual.
- Availability display: filled chip showing current tier
- Price display: current price
- Universal action button: *"Edit"*

**Back:**
- Same editor as Player Card back: tier picker + price adjuster + pick anchor toggles.

### Rail Pattern
Picks rail is one horizontal rail (parallel to QB / RB / Pass Catchers). Pick cards in the rail are sorted year-ascending, then round-ascending within year. No section dividers within the Picks rail.

### Layout
- Desktop: 4 position-grouped rails, 2 visible at once. Section dividers between rails.
- Mobile: snap-snap (vertical between rails, horizontal within rail).

### Memo Corner
Optional indicator on Player Cards (not Pick Cards — picks don't carry director memos). Tap → popover with full director note. Travels with the player across surfaces.

---

## Section 9: Cross-Director Signal Flow (R&S as Source)

R&S generates settings signals; other doors consume them:

- **R&S → Pro Personnel:**
  - Aging signal → PP intel ("Mahomes is at peak value — sell-high window")
  - Value drift signal → PP intel
  - Position market (selling) → PP intel + acquisition draft filtering
  - Wants_more + position market (buying) → PP acquisition draft generation
- **R&S → Scouting:**
  - Wants_more (especially studs / picks) → Scouting trade up/down intel relevance
  - Position market shapes trade intel direction

PP and Scouting do NOT feed signals back into R&S. R&S is the source.

### Build-Time Concerns (Preserved from v2.x)

1. **Signal volume management.** Aging fires on many players continuously. Need prioritization so R&S doesn't flood the office with POVs.
2. **Cooldowns / thresholds per signal.** When does a signal cross from "interesting" to "surface as a POV"?
3. **Multi-card from one signal.** If aging Mahomes triggers an R&S settings POV AND a PP trade POV, decide if both fire or only one, and which takes priority. Likely R&S fires first (the settings change unlocks the PP signal), but build-time tuning required.

---

## Section 10: Killed in v3.0

These existed in v1.x / v2.x and are removed:

1. **R&S Wall.** Binder grid landing of lens-engine cards. Gone.
2. **6 lens engines as card-producing engines** (Aging, Value drift, Attachment mismatch, Position misalignment, Wants More suggestion, Championship comparison). The intel categories survive as conversation in the office.
3. **Research Analyst staff voice.** Director is the only voice.
4. **Opener chips on chat panel.** Replaced by director's opening 3 POVs.
5. **Persistent chat right rail.** No rail — chat is the entire surface in the office.
6. **Landing header bar with "Set Strategy" + "Set Availability" buttons.** Workrooms reached from home screen deep links or office inline actions.
7. **Mobile pinned action buttons below the topbar.** Same reason.
8. **List Card template** (for Pick Cards in Set Availability). Replaced by individual Player-style Pick Cards with contextual chips.
9. **Director's-voice empty-state card on landing.** Empty state lives in the chat opening message.
10. **Memo Card template** (used on R&S Wall for position misalignment / wants more / championship comparison). Dead globally.
11. **Card priority sort (red/yellow/green) on landing.** No landing cards, no sort.
12. **28-day dismissal cooldown.** No cards to dismiss.
13. **"DONE" vs "FILED" stamp variants.** Only DONE survives (used in Set Strategy + Set Availability inline edits).
14. **Settings staleness as a standalone lens.** Already killed in v2.x; stays killed.

---

## Section 11: Files Affected

### Retire / replace
- `src/components/research-strategy/Wall.tsx` — kill (if built in v2.x)
- `src/components/research-strategy/RSLanding.tsx` — kill
- `src/components/research-strategy/CardGrid.tsx` — kill (or shared with Scouting/PP if applicable — likely kill if not extracted)
- `src/components/research-strategy/AgingPlayerCard.tsx` — kill
- `src/components/research-strategy/ValueDriftCard.tsx` — kill
- `src/components/research-strategy/AttachmentMismatchCard.tsx` — kill
- `src/components/research-strategy/PositionMisalignmentCard.tsx` — kill
- `src/components/research-strategy/WantsMoreSuggestionCard.tsx` — kill
- `src/components/research-strategy/ChampionshipComparisonCard.tsx` — kill
- `src/components/research-strategy/RSChatPanel.tsx` — replace with full office implementation
- `src/components/research-strategy/RSHeaderBar.tsx` — kill
- `src/components/research-strategy/EmptyWall.tsx` — kill
- `src/components/research-strategy/PickCard.tsx` — replace (if built as List Card in v2.x). Restructure as individual Player-style card.

### New (v3.0)
- `src/components/research-strategy/ResearchStrategyOffice.tsx` — top-level office page. Mounts at `/research-strategy/office`.
- `src/components/research-strategy/DirectorChat.tsx` — chat thread component (shared with Scouting + PP — extract to `src/components/shared/DirectorChat.tsx`)
- `src/components/research-strategy/DirectorOpening.tsx` — opening message renderer
- `src/components/research-strategy/InlineSettingButton.tsx` — reusable one-click commit button (tier change, market flip, toggle)
- `src/components/research-strategy/PickCard.tsx` — new Pick Card (Player Card template variant). Front with pick id chrome + contextual chip line + availability/price display + Edit button. Back identical to Player Card back.

### Reuse (preserved)
- `src/components/research-strategy/TierPicker.tsx` — 4-button tier picker. Used in Player Card back + Pick Card back + inline commits.
- `src/components/research-strategy/PriceAdjuster.tsx` — +/- price editor.
- `src/components/research-strategy/MarketEditor.tsx` — 3-button market picker. Used in Set Strategy Selector Card backs + inline commits.
- `src/components/research-strategy/WantsToggle.tsx` — on/off toggle. Used in Set Strategy + inline commits.
- `src/components/research-strategy/PickAnchorAdjuster.tsx` — +/- toggles for pick anchors.
- `src/components/research-strategy/MemoCorner.tsx` — reusable memo corner indicator + popover.
- `src/components/research-strategy/DoneStamp.tsx` — confirmation stamp.
- `src/components/research-strategy/SetStrategyPage.tsx` — Set Strategy workroom. Mounts at `/research-strategy/set-strategy`. Unchanged.
- `src/components/research-strategy/WantsMoreSelectorCard.tsx` — Set Strategy Selector Cards.
- `src/components/research-strategy/PositionMarketSelectorCard.tsx` — Set Strategy Selector Cards.
- `src/components/research-strategy/SetAvailabilityPage.tsx` — Set Availability workroom. Mounts at `/research-strategy/set-availability`. Updated to use new individual Pick Cards.
- `src/components/research-strategy/RosterPlayerCard.tsx` — Player Cards in Set Availability rails.

### APIs

**New / extended:**
- `/api/research-strategy/office/opening` — generates director's opening 3 POVs from settings + value pipeline + behavior signals
- `/api/research-strategy/office/respond` — director's response to user messages, with structured action payloads for one-click commits

**Existing (preserved):**
- All strategy / attachment / value override endpoints from v2.x

### Director memo pipeline
The R&S director files memos to the GM inbox (settings staleness reminders, behavior-vs-stated-strategy alerts). Same memo pipeline as Scouting + PP — separate workstream.

---

## Section 12: Build Order Recommendation

### Phase 1 — Office shell (parallels Scouting and PP builds)
1. **`DirectorChat.tsx`** — shared chat thread component (if not already extracted).
2. **`InlineSettingButton.tsx`** — one-click commit button for settings.
3. **`DirectorOpening.tsx`** — opening message renderer (shared).
4. **`ResearchStrategyOffice.tsx`** — top-level page. Mount at `/research-strategy/office`.

### Phase 2 — Office intel + responses
5. **`/api/research-strategy/office/opening`** — generates 3 POVs from value drift + aging + market mismatches + behavior signals.
6. **`/api/research-strategy/office/respond`** — LLM-backed responses with structured action payloads.
7. **Wire inline actions** — one-click tier commits, market flips, toggle commits, deep links to workrooms.

### Phase 3 — Pick Card restructure
8. **`PickCard.tsx` (new)** — individual Player-style card. Replaces v2.x List Card.
9. **Update `SetAvailabilityPage.tsx`** to render individual Pick Cards in the Picks rail (sorted year-ascending, then round-ascending).
10. **Compute contextual chip line** ("2 more in '26, 1 in '27, none in '28") — derived from user's pick portfolio.

### Phase 4 — Cleanup
11. Delete killed v2.x landing components and List Card.
12. Verify Set Strategy and Set Availability are unchanged in core behavior.

---

## Section 13: Open Items / Deferred Decisions

NOT blockers:

1. **Director's-voice content engine.** Same as Scouting / PP — hybrid structured queries + LLM prose.
2. **Selector Card flip vs. inline edit** (preserved from v2.x). Test both patterns at mockup.
3. **Signal prioritization for opening message.** When multiple aging signals fire, which one becomes POV #1? Build-time tuning.
4. **Multi-card-from-one-signal logic.** Coordinate with PP build to avoid redundant POVs (e.g., aging Mahomes shouldn't generate both an R&S settings POV AND a PP trade POV simultaneously — likely R&S fires, then PP picks up after commit).
5. **Pass Catchers data-model migration** (preserved from v2.x). UI consolidates WR + TE; backend may need migration to a single column.
6. **Pick value flexibility build** (preserved from v2.x). Team modifiers on picks parallel to player modifiers.
7. **Vs-last-week comparison data** (preserved from v2.x). Requires historical CFC value snapshots.
8. **Memo corner content engine** (preserved from v2.x).
9. **Conversation persistence backend.** V1 localStorage.
10. **POV click behavior.** Same as Scouting / PP — direct dive.
11. **Director memo generation pipeline.** Separate workstream.
12. **Championship lens / structured title-team data wiring** (preserved from v2.x). Was a v2.x open item; remains deferred. Championship-comparison intel surfaces only when the data is wired.

---

## Section 14: Behavioral Notes

- **Default landing within the door:** `/research-strategy/office`.
- **Office POV click:** dives into a follow-up conversation.
- **Inline action click:**
  - One-click commit fires API → message updates in place with confirmation.
  - Deep link routes to Set Strategy or Set Availability (scoped to a player when applicable).
- **Set Strategy autosave:** confirmation on the back of each Selector Card = save event. DONE stamp = save confirmation.
- **Set Availability — Player Card Edit tap:** flips to back. Tap tier → commits + DONE + flip back. +/- on price/anchors → auto-saves silently.
- **Set Availability — Pick Card Edit tap:** flips to back. Same controls as Player Card back.
- **Memo corner tap:** popover with full director note.
- **Logo click:** returns to home.
- **Back arrow:** returns to home from office; from workrooms, returns to office or home depending on entry path.

---

## Section 15: Summary — At-a-Glance

| Element | Decision |
|---|---|
| **Routing** | `/research-strategy/office` (chat) · `/research-strategy/set-strategy` · `/research-strategy/set-availability` |
| **Concept** | Director's office — chat-driven workspace, director is the only voice. R&S is purely settings |
| **Office layout** | Full-width chat surface. Topbar + page title + chat thread + pinned input |
| **Opening message** | Director's top 3 POVs. Signal → recommendation → optional one-click commit or workroom deep link |
| **Voice** | First person, conversational, anonymized intel, leads with POV, naturally acknowledges cross-director handoffs |
| **Inline actions** | One-click setting commits (tier, market, wants_more toggle, price) · Deep links to workrooms · Multi-option choices |
| **Set Strategy** | Unchanged from v2.x. 2 horizontal-rail sections, 4 Selector Cards each (Picks/Studs/Youth/Depth + QB/RB/Pass Catchers/Picks) |
| **Set Availability** | Position-grouped rails (QB/RB/Pass Catchers/Picks). Player Cards in player rails, individual Pick Cards in Picks rail |
| **Pick Card change** | List Card killed. Each pick is now an individual Player-style card with contextual chips ("2 more in '26, 1 in '27, none in '28") |
| **Cross-director signals (R&S → others)** | R&S → PP: aging, value drift, position market, wants_more. R&S → Scouting: wants_more + position market for trade intel |
| **R&S consumes signals from others** | No. R&S is the source |
| **Killed in v3.0** | R&S Wall · 6 lens engines as cards · Research Analyst staff voice · Opener chips · Persistent chat rail · Landing header bar · List Card · Memo Card · Card priority sort · 28-day dismissal cooldown · DONE/FILED stamp variants (only DONE survives) |

---

## End of Spec — Ready for Build

The R&S v3.0 design is fully locked. Items intentionally deferred are content-engine choices, signal prioritization, championship data wiring, and adjacent polish.

Pick this up in a build chat by attaching this document along with `/docs/CFC-APP-STATUS.md` v3.0, `CFC-HOME-SCREEN-SPEC.md` v3.0, `CFC-GM-OFFICE-SPEC.md` v3.0, `CFC-SCOUTING-SPEC.md` v3.0, and `CFC-PRO-PERSONNEL-SPEC.md` v3.0.
