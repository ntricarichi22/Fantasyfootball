# CFC Front Office — Pro Personnel Design Spec

**Version:** 3.0
**Date:** May 14, 2026
**Status:** Design locked — ready for mockup → code

> **Revision note (v3.0):** Major redesign. The PP landing binder grid (Acquire / Shop opportunity cards) is killed. The director's office is now a **chat-driven workspace** — open the office, the Director of Pro Personnel greets you with their top 3 POVs, the chat surfaces inline actions (proposed trades, deep links, one-click commits). Staff voice (Pro Scout) killed. Trade Builder restructured: **top 10 players / top 10 teams landing is killed** — Trade Builder now opens with the Hero Card cycler showing 5 director-drafted acquisition trades (auto-driven by R&S signals), plus a "Build my own" button to drop into the blank builder. Trade Studio unchanged in structure — Hero Card cycler with 5 shop offers (driven by user-selected block). Both PP workrooms now share the Hero Card cycler pattern.

---

## Purpose of This Document

This document captures every design decision for the **Pro Personnel door** — the Director of Pro Personnel's office (chat-driven) and the workrooms reached from it (Trade Builder, Trade Studio).

This spec must be read alongside:
- `/docs/CFC-APP-STATUS.md` v3.0 (project-wide non-negotiables)
- `CFC-HOME-SCREEN-SPEC.md` v3.0 (home screen routes here)
- `CFC-GM-OFFICE-SPEC.md` v3.0 (inbox is the central "what's new" surface; PP director files memos there)
- `CFC-SCOUTING-SPEC.md` v3.0 (peer director — same office pattern)
- `CFC-RESEARCH-STRATEGY-SPEC.md` v3.0 (peer director — R&S signals feed PP intel)

The Pro Personnel director's lens is **looking outward** — other teams' rosters, trade activity, and who's a fit for our build.

---

## Section 1: Concept & Metaphor

The Pro Personnel door is the **Director of Pro Personnel's office**. The user walks in and the director's been working the phones. One voice in the room — the director themselves. No staff. The conversation is the surface.

When the user opens the office, the director greets them with their top 3 POVs as the opening message — specific deals to consider, league activity worth acting on, value movements that change the calculus. Each POV ends with a recommendation. The user can click any POV to dive in, or type their own question. The director responds with prose AND inline actions — most commonly, proposed trades rendered as mini trade cards with "Open in Builder" buttons.

Pro Personnel hunts opportunities. The GM Office handles correspondence (the inbox) and league news (memos). The PP office is the **proactive hunting surface**.

---

## Section 2: Architecture & Routing

### Routes

| Route | Surface | Entry points |
|---|---|---|
| `/pro-personnel/office` | Director's office (chat) | Home screen PP box → Office |
| `/trade-builder` | Trade Builder workroom (Hero Card cycler + blank builder) | Home screen PP box → Build a Trade · Office chat inline action |
| `/trade-studio` | Trade Studio workroom (Hero Card cycler) | Home screen PP box → Shop My Guys · Office chat inline action |

### Mental model

Three surfaces inside the door:

1. **Office** — chat-driven workspace, the director's room. No landing grid, no cards laid out. The conversation IS the surface.
2. **Trade Builder** — acquisition workroom. Opens with the Hero Card cycler (5 director-drafted acquisition trades). User can pick one to load into the builder, or click "Build my own" to drop into the blank builder.
3. **Trade Studio** — shop workroom. User picks players to shop, director generates 5 offers in the Hero Card cycler.

Both workrooms use the **same Hero Card cycler pattern**. Symmetrical, consistent.

### What this replaces

- The PP landing binder grid (Acquire / Shop opportunity cards) is killed.
- The top 10 players + top 10 teams landing on Trade Builder is killed.
- The lens engines that produced Acquire / Shop cards survive as **conversation starters in the office chat** AND as drivers of the Trade Builder cycler's 5 acquisition drafts.
- Pro Scout staff voice is killed.

---

## Section 3: The Office — Layout

### Desktop (≥768px)

```
┌──────────────────────────────────────────────────────────────────────┐
│  [InnerTopbar: ← back · league logo · settings]                       │
├──────────────────────────────────────────────────────────────────────┤
│                                                                       │
│  DIRECTOR OF PRO PERSONNEL                                            │
│                                                                       │
├──────────────────────────────────────────────────────────────────────┤
│                                                                       │
│   "Morning, boss. Three things on my mind:"                          │
│                                                                       │
│   ┌───────────────────────────────────────────────────────────────┐   │
│   │ 1. Founders just shipped Allen and their 2026 1st for picks   │   │
│   │    and youth — full fire sale. Their WR room is loaded with   │   │
│   │    guys we'd love. I'd start with Lamb and offer our 1st      │   │
│   │    plus a depth piece.                                        │   │
│   └───────────────────────────────────────────────────────────────┘   │
│                                                                       │
│   ┌───────────────────────────────────────────────────────────────┐   │
│   │ 2. Lamb's stock is rising fast and Founders, Outlaws, and     │   │
│   │    Kush are all buying at WR. Outlaws are our best target —   │   │
│   │    they've got the picks and the urgency.                     │   │
│   └───────────────────────────────────────────────────────────────┘   │
│                                                                       │
│   ┌───────────────────────────────────────────────────────────────┐   │
│   │ 3. Mahomes is at peak value but the age cliff is real. We     │   │
│   │    should move him now and Outlaws are the buyer — all-in     │   │
│   │    and need a QB. I'd ask for two 1sts and a stud.            │   │
│   └───────────────────────────────────────────────────────────────┘   │
│                                                                       │
│   Which one do we tackle? Or is there something else on your mind?    │
│                                                                       │
│  ┌─────────────────────────────────────────────────────────────────┐  │
│  │ [Ask the Director of Pro Personnel…]                     [Send] │  │
│  └─────────────────────────────────────────────────────────────────┘  │
└──────────────────────────────────────────────────────────────────────┘
```

- **InnerTopbar:** standard inner-page topbar.
- **Page title:** *"Director of Pro Personnel"* in Syne 800.
- **Chat surface:** full-width. No sidebar, no right rail.
- **Opening message:** director's three POVs as clickable items. Each POV is a self-contained intel statement ending in a recommendation.
- **Click a POV** → dives into a follow-up conversation on that topic.
- **Chat input:** pinned at the bottom. Placeholder *"Ask the Director of Pro Personnel…"*.

### Mobile (<768px)

Same shape, full-screen. Topbar mobile pattern. Page title + chat thread + pinned input.

---

## Section 4: The Director's Opening Message

Identical pattern to Scouting (see SCOUTING spec Section 4). Three POVs max, leading with recommendation, anonymized when discussing other teams' private intel.

### Example POVs (Voice Reference)

The 8-10 PP intel categories we built up in design:

**Fire-sale / level-up detection:**
> *"Founders just shipped Allen and their 2026 1st for picks and youth — full fire sale. Their WR room is loaded with guys we'd love. I'd start with Lamb and offer our 1st plus a depth piece."*

> *"Outlaws picked up two starters this month — they're going for it. They'd take any vet we'd consider moving. Daniels is the right one to offer."*

**Multi-team market opportunities:**
> *"Lamb's stock is rising fast and Founders, Outlaws, and Kush are all buying at WR. Outlaws are our best target — they've got the picks and the urgency."*

**Sell-high windows:**
> *"Mahomes is at peak value but the age cliff is real. We should move him now and Outlaws are the buyer — all-in and need a QB. I'd ask for two 1sts and a stud."*

**Comparable trades:**
> *"Comparable to Wilson just netted a 2nd and a starter WR last week. We should be able to pull the same return. Crossfitters are the right fit."*

**Unresolved threads:**
> *"Founders haven't moved on from Daniels. We turned them down two weeks ago but I think their offer was fair. Worth countering with a small bump."*

**Strategy alignment:**
> *"Crossfitters have extra picks and need WR depth. We've got WR to spare and we want picks. I'd offer Pittman for their 2nd and a 3rd."*

**Aged offers:**
> *"Founders have been sitting on our counter for 4 days. Time to nudge them or move on."*

**Roster surplus → market match:**
> *"Three teams need a starting RB and we're sitting on two. Could turn that into real assets."*

### Voice Rules (Same as Scouting)

- First person ("we / our"), conversational
- Anonymized intel — "word is Founders are high on him" not "Team X has him ranked 3rd"
- No codespeak — no dollar values, no "wants_more," no "tier"
- Leads with recommendation, not open questions
- Specific named teams as call-targets is fine; specific rankings inside their boards is not

---

## Section 5: Inline Actions in the Chat

Same pattern as Scouting (see SCOUTING spec Section 5).

For PP specifically, the most common inline action is **proposed trade** — the director's POVs almost always include a specific trade idea, and the chat naturally generates trade cards to open in the Builder.

### PP-Specific Action Examples

User clicks POV #1 (Founders fire sale):

Director responds:
> *"Right — they're rebuilding hard. Lamb is the value play. Here's what I'd open with:"*
>
> ┌─────────────────────────────────┐
> │ TO FOUNDERS                      │
> │ Send: 2026 1st, Pittman          │
> │ Receive: Lamb                    │
> │ [In the range ✓]                 │
> │ [Open in Builder →]              │
> └─────────────────────────────────┘
>
> *"They've been signaling they want a 1st and a starting WR — this hits both. Want to take it to the builder?"*

User clicks "Open in Builder" → routes to `/trade-builder` with the deal pre-populated, partner already loaded.

---

## Section 6: Empty State

When the director has nothing pressing:

> *"Wire's quiet, boss. Nothing pressing right now. Anything you want to look at?"*

No bullet POVs. Just the director's voice + chat input ready.

---

## Section 7: Trade Builder Workroom (`/trade-builder`)

### Concept Change in v3.0

The old Trade Builder landing (top 10 players + top 10 teams) is killed. Trade Builder now opens with the **Hero Card cycler** showing 5 director-drafted acquisition trades, plus a "Build my own" button to drop into the blank builder.

Symmetrical with Trade Studio:
- **Trade Builder:** 5 acquisition drafts (auto-driven by R&S signals — wants_more + position_market_buying)
- **Trade Studio:** 5 shop offers (driven by user-selected block)

### Layout — Hero Card Cycler

Same `OfferCard.tsx` component as Trade Studio. Single card visible at a time:

```
┌──────────────────────────────────────────┐
│ Deal shape as [Closer ▾]   ◀ 1 / 5 ▶    │
├──────────────────────────────────────────┤
│ TO FOUNDERS              [In the range]  │
├──────────────────────────────────────────┤
│                                           │
│   SEND               RECEIVE              │
│   2026 1st           Lamb                 │
│   Pittman                                 │
│                                           │
├──────────────────────────────────────────┤
│ "Founders are buying at WR and have      │
│  picks to spare. Lamb fits our hole and  │
│  this hits their stated needs."          │
├──────────────────────────────────────────┤
│ [Pass]     [Edit]     [Make this offer]  │
└──────────────────────────────────────────┘

           [+ Build my own]
```

- **Persona toggle:** user can re-roll the same partner with a different persona assumption (existing functionality).
- **Prev / next arrows + counter:** cycle through the 5 drafts.
- **Send / receive grid:** dark blue panel (existing styling).
- **AI advisor prose:** director's rationale for this specific draft.
- **Balance chip:** neutral grading (Studio pattern — offers already filtered to user's persona).
- **Three buttons:** Pass (red border) / Edit (black border) / Make this offer (blue filled).
- **Build my own:** secondary button below the cycler. Drops to the blank builder.

### Empty State

When the user has no clear strategy signals (new league, hasn't set strategy yet, no buying signals):

> *"Looks like we haven't set our strategy yet, boss. Once we know what we want and where we're buying, I can draft up real targets. Want to head over to Set Strategy?"*
>
> [Open Set Strategy →]   [Build my own anyway →]

This adds real teeth to Set Strategy — users who skip it can't benefit from the director's drafts.

### Blank Builder Surface

When the user clicks "Build my own" or routes from a chat inline action with a specific pre-population:

The existing `TradeBuilder.tsx` component is preserved with no internal changes. Layout:
- Deal card on the left (send / receive columns)
- Right panel with roster tabs (user's roster + partner's, when partner selected)
- AI Advisor below the deal card
- "+ Add from your roster" and "+ Add from their roster" buttons
- Empty state: clicking "+ Add from their roster" fires the partner-picker modal (search + team list)

### Mobile

Hero Card cycler renders one card at a time. Swipe left/right to cycle. Same component, mobile-optimized layout. "Build my own" button persistent below the cycler.

---

## Section 8: Trade Studio Workroom (`/trade-studio`)

Largely unchanged from v2.x. User picks players to shop (existing roster grid + Y toggle), hits Generate, director produces 5 offers via the existing pipeline, Hero Card cycler displays them.

The Hero Card pattern is the SAME component used in Trade Builder. Reused, not duplicated.

### Persona Override
Per-offer persona override popover preserved (existing functionality).

### Inline Action Entry
When the user enters Trade Studio from a chat inline action (e.g., director said *"Mahomes is at peak value, let me draft up shop offers"* → user clicks "Shop Mahomes"), the roster grid is pre-marked with Mahomes selected and offers auto-generate. User lands on the Hero Card cycler with offers ready.

---

## Section 9: Killed in v3.0

These existed in v1.x / v2.x and are removed:

1. **PP landing binder grid.** Acquire / Shop opportunity cards in a grid. Gone.
2. **Acquire opportunity Player Card.** Gone (intel survives as conversation in office).
3. **Shop opportunity Player Card.** Gone (intel survives as conversation in office).
4. **Pro Scout staff voice.** Director is the only voice.
5. **Opener chips on chat panel.** Replaced by director's opening 3 POVs.
6. **Persistent chat right rail.** No rail — chat is the entire surface in the office.
7. **Landing header bar with "Build a trade" + "Shop my guys" buttons.** Workrooms reached from home screen deep links or office inline actions.
8. **Mobile pinned action buttons below the topbar.** Same reason.
9. **Trade Builder top 10 players landing.** Killed in v3.0.
10. **Trade Builder top 10 teams landing.** Killed in v3.0.
11. **Director's-voice empty-state card on landing.** Empty state lives in the chat opening message.
12. **Memo card subject chrome.** Memo card template is dead globally.
13. **Card priority sort (red/yellow/green).** No cards on landing, no sort.
14. **Hero Card "Director's Pick" on PP landing** (already killed in v2.x). Stays killed. Hero Card now lives in BOTH workrooms (Trade Builder and Trade Studio).

---

## Section 10: Files Affected

### Retire / replace
- `src/components/pro-personnel/ProPersonnelLanding.tsx` — kill
- `src/components/pro-personnel/CardGrid.tsx` — kill (or move to shared if reused for nothing; likely kill)
- `src/components/pro-personnel/AcquireCard.tsx` — kill
- `src/components/pro-personnel/ShopCard.tsx` — kill
- `src/components/pro-personnel/ProScoutChatPanel.tsx` — replace with full office implementation
- `src/components/pro-personnel/PPHeaderBar.tsx` — kill
- `src/components/pro-personnel/EmptyLanding.tsx` — kill
- `src/components/trade/LandingPage.tsx` — confirm killed (was retired in v2.x)
- `src/components/trade/CartSidebar.tsx` — confirm killed
- `src/components/trade/RosterModal.tsx` — confirm killed
- `src/components/trade/ConfirmModal.tsx` — confirm killed

### New (v3.0)
- `src/components/pro-personnel/ProPersonnelOffice.tsx` — top-level office page. Mounts at `/pro-personnel/office`.
- `src/components/pro-personnel/DirectorChat.tsx` — chat thread component (shared with Scouting and R&S — extract to `src/components/shared/DirectorChat.tsx`)
- `src/components/pro-personnel/DirectorOpening.tsx` — opening message renderer
- `src/components/pro-personnel/InlineTradeCard.tsx` — mini trade card (shared with Scouting)
- `src/components/trade/TradeBuilderEntry.tsx` — new entry surface for Trade Builder. Renders the Hero Card cycler with 5 acquisition drafts + "Build my own" button. Drops to existing `TradeBuilder.tsx` for the blank-builder path.

### Reuse
- `src/components/trade-studio/OfferCard.tsx` — Hero Card. Now used in BOTH Trade Studio and Trade Builder.
- `src/components/trade-studio/PersonaPopover.tsx`
- `src/components/trade-studio/TradeStudioView.tsx` — Trade Studio, untouched (still gains `?seed=shop` query param for inline-action entry from office chat)
- `src/components/trade-studio/RosterPanel.tsx`
- `src/components/trade-studio/PassConfirmModal.tsx`
- `src/components/trade/TradeBuilder.tsx` — blank-builder workroom, untouched. Now reached via "Build my own" or pre-population from office chat.
- `src/components/trade/DealCard.tsx`
- `src/components/trade/AIAdvisor.tsx`
- `src/components/trade/PlayerRow.tsx`
- `src/components/trade/TierDivider.tsx`
- `src/components/trade/RoutingPopup.tsx`
- `src/components/trade/PartnerPickerModal.tsx` — partner-picker for blank builder entry (existing or to-be-built per v2.x spec)
- `src/components/trade/shared/TradeBalanceChip.tsx`

### APIs

**Existing (preserved):**
- `/api/trade-studio/generate` — generates 5 shop offers (consumed by Trade Studio)
- `/api/trade-studio/feedback` — Pass action
- `/api/trades/advisor` — AI advisor prose
- `/api/trades/create` — Make this offer

**New / extended:**
- `/api/trade-builder/generate-acquisitions` — generates 5 acquisition drafts based on R&S signals. New endpoint. Parallel to `/api/trade-studio/generate` but inverted for the acquire side.
- `/api/pro-personnel/office/opening` — generates director's opening 3 POVs
- `/api/pro-personnel/office/respond` — director's response to user messages

### Director memo pipeline
The PP director files memos to the GM inbox (recent league trades, completed deals, fire-sale detections). Same memo pipeline as Scouting and R&S — separate workstream.

---

## Section 11: Build Order Recommendation

### Phase 1 — Office shell (parallels Scouting build)
1. **`DirectorChat.tsx`** — shared chat thread component (if not already extracted in Scouting build).
2. **`InlineTradeCard.tsx`** — mini trade card (shared with Scouting).
3. **`DirectorOpening.tsx`** — opening message renderer.
4. **`ProPersonnelOffice.tsx`** — top-level page. Mount at `/pro-personnel/office`.

### Phase 2 — Office intel + responses
5. **`/api/pro-personnel/office/opening`** — generates 3 POVs from R&S signals + league trade activity + intel queries.
6. **`/api/pro-personnel/office/respond`** — LLM-backed responses with structured action payloads.
7. **Wire inline actions** — proposed trade (most common), deep links, one-click commits.

### Phase 3 — Trade Builder restructure
8. **`/api/trade-builder/generate-acquisitions`** — new endpoint. Generates 5 acquisition drafts auto-driven by user's wants_more + position_market_buying. Parallel architecture to Trade Studio's generate endpoint.
9. **`TradeBuilderEntry.tsx`** — new entry surface. Hero Card cycler + "Build my own" button. Empty state pointing to Set Strategy when signals are missing.
10. **Wire entry routing** — `/trade-builder` defaults to `TradeBuilderEntry`; "Build my own" or pre-populated entries drop to `TradeBuilder.tsx`.

### Phase 4 — Inline action entry to Trade Studio
11. **Wire `?seed=shop` query param into Trade Studio** — when entered from office chat with a pre-selected player, roster grid is pre-marked and offers auto-generate.

### Phase 5 — Cleanup
12. Delete killed v2.x landing components.
13. Verify Trade Studio behavior unchanged.

---

## Section 12: Open Items / Deferred Decisions

NOT blockers:

1. **Acquisition draft generation logic.** Parallel architecture to Trade Studio's shop offer generation — partner persona awareness, deal-breaker filtering, value gap math. Existing Studio code is the reference. Defer detailed implementation to build.
2. **Director's-voice content engine.** Same as Scouting — hybrid structured queries + LLM prose.
3. **Inline trade card rendering.** Visual treatment, action button placement, exact balance chip behavior. Defer to mockup.
4. **Mobile Hero Card cycler refinements.** Already exists in Trade Studio; confirm same component works for Trade Builder.
5. **POV click behavior.** Same as Scouting — recommend direct dive.
6. **Conversation persistence.** V1 localStorage.
7. **Director memo generation pipeline.** Separate workstream.
8. **Empty state copy for Trade Builder.** Final copy at content-pass time.

---

## Section 13: Behavioral Notes

- **Default landing within the door:** `/pro-personnel/office`.
- **Office POV click:** dives into a follow-up conversation on that topic.
- **Inline action click:** fires the action. Trade cards route to Trade Builder pre-populated. Deep links route directly. Commits fire API + update message in place.
- **Trade Builder default entry:** Hero Card cycler with 5 acquisition drafts.
- **Trade Builder "Build my own":** drops to blank builder.
- **Trade Builder empty state:** when no strategy signals, points user to Set Strategy.
- **Trade Studio entry from office chat:** `?seed=shop` pre-marks roster grid + auto-generates offers.
- **Logo click:** returns to home.
- **Back arrow:** returns to home from office; from workrooms, may return to office or home depending on entry path (build decision — recommend returning to whichever surface the user came from).

---

## Section 14: Summary — At-a-Glance

| Element | Decision |
|---|---|
| **Routing** | `/pro-personnel/office` (chat) · `/trade-builder` · `/trade-studio` |
| **Concept** | Director's office — chat-driven workspace, director is the only voice |
| **Office layout** | Full-width chat surface, no sidebars, no rails. Topbar + page title + chat thread + pinned input |
| **Opening message** | Director's top 3 POVs ending in recommendations. Signal → named target → recommendation → optional CTA |
| **Voice** | First person, conversational, anonymized intel, leads with POV |
| **Inline actions** | Proposed trade (mini card) most common · Deep links · One-click commits |
| **Trade Builder entry** | Hero Card cycler with 5 director-drafted acquisitions (auto-driven by R&S signals) · "Build my own" button drops to blank builder |
| **Trade Builder empty state** | Points user to Set Strategy when no signals |
| **Trade Studio entry** | Unchanged — user picks block, director generates 5 offers in Hero Card cycler |
| **Hero Card cycler** | Same component (`OfferCard.tsx`) used in BOTH workrooms |
| **Cross-director signals** | Acquisition drafts driven by R&S wants_more + position_market_buying. Shop offers driven by R&S aging + value drift + position_market_selling (existing) |
| **Killed in v3.0** | Landing binder grid · Acquire / Shop cards · Pro Scout staff voice · Opener chips · Persistent chat rail · Landing header bar · Trade Builder top 10 players/teams landing · Memo card · Card priority sort |

---

## End of Spec — Ready for Build

The Pro Personnel v3.0 design is fully locked. Items intentionally deferred are content-engine choices, mockup details, and adjacent polish.

Pick this up in a build chat by attaching this document along with `/docs/CFC-APP-STATUS.md` v3.0, `CFC-HOME-SCREEN-SPEC.md` v3.0, `CFC-GM-OFFICE-SPEC.md` v3.0, `CFC-SCOUTING-SPEC.md` v3.0, and `CFC-RESEARCH-STRATEGY-SPEC.md` v3.0.
