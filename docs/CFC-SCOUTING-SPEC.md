# CFC Front Office — Scouting Design Spec

**Version:** 3.0
**Date:** May 14, 2026
**Status:** Design locked — ready for mockup → code

> **Revision note (v3.0):** Major redesign. The Scouting landing binder grid (Rankings drift / Rankings reminders / Trade up-down intel cards) is killed. The director's office is now a **chat-driven workspace** — open the office, the Director of Scouting greets you with their top 3 POVs, the chat surfaces inline actions (proposed trades, deep links to workrooms, one-click commits). Staff voice (College Scout) killed — the director is the only voice. Workrooms (Big Board, Draft Room, Mock Draft) are reached via deep links from the home screen OR from inline actions in the office chat. LLM-powered current-news intel is deferred — V1 briefings use closed-league data only.

---

## Purpose of This Document

This document captures every design decision for the **Scouting door** — the Director of Scouting's office (chat-driven) and the workrooms reached from it (Big Board, Draft Room, Mock Draft). It is the handoff spec for implementation.

This spec must be read alongside:
- `/docs/CFC-APP-STATUS.md` v3.0 (project-wide non-negotiables)
- `CFC-HOME-SCREEN-SPEC.md` v3.0 (home screen routes here)
- `CFC-GM-OFFICE-SPEC.md` v3.0 (inbox is the central "what's new" surface; Scouting director files memos there)
- `CFC-PRO-PERSONNEL-SPEC.md` v3.0 (peer director)
- `CFC-RESEARCH-STRATEGY-SPEC.md` v3.0 (peer director — Scouting reads R&S signals)

The Scouting director's lens is **looking forward** — the draft, the board, the rookies.

---

## Section 1: Concept & Metaphor

The Scouting door is the **Director of Scouting's office**. The user walks in and the director is at the whiteboard, ready to talk. One voice in the room — the director themselves. No staff. The conversation is the surface.

When the user opens the office, the director greets them with their top 3 POVs as the opening message — specific, sharp, conversation-starting. The user can click any of those POVs to dive in, or type their own question. The director responds with prose AND inline actions where appropriate — a proposed trade rendered as a mini trade card with "Open in Builder" button, a deep link to the Big Board focused on a specific player, a one-click commit to move someone on the board.

The director's job is seasonal: quiet most of the year, busy in draft prep, urgent on draft day. The home screen handles the "draft is live" signal directly (red briefing on the Scouting door's contextual entry). The office is where everything else happens.

---

## Section 2: Architecture & Routing

### Routes

| Route | Surface | Entry points |
|---|---|---|
| `/scouting/office` | Director's office (chat) | Home screen Scouting box → Office |
| `/scouting/big-board` | Big Board workroom | Home screen Scouting box → Big Board · Office chat inline action |
| `/scouting/draft-room` | Draft Room workroom | Home screen Scouting box → Draft Room · Office chat inline action |
| `/scouting/mock-draft` | Mock Draft workroom | Home screen Scouting box → Mock Draft · Office chat inline action |

### Mental model

Four surfaces inside the door:

1. **Office** — chat-driven workspace, the director's room. No landing grid, no cards laid out on a wall. The conversation IS the surface.
2. **Big Board** — board prep workroom. User ranks rookies + vets in one unified board.
3. **Draft Room** — the live draft surface (Round 1 and Rounds 2/3 unified — treated as one draft).
4. **Mock Draft** — mock draft simulator.

All four are deep-linkable from the home screen. The office is the only one with the director's chat; the workrooms are pure execution surfaces.

### What this replaces

- The Scouting landing binder grid (3-column card grid on desktop, swipe deck on mobile) is killed.
- The 3 lens engines (Rankings reminders, Rankings drift, Trade up/down intel) are killed as card-producing engines. The same intel categories survive as **conversation starters** in the office chat.
- The College Scout staff voice is killed.
- The opener chips on the chat panel are killed (replaced by the director's opening 3 POVs).

---

## Section 3: The Office — Layout

### Desktop (≥768px)

```
┌──────────────────────────────────────────────────────────────────────┐
│  [InnerTopbar: ← back · league logo · settings]                       │
├──────────────────────────────────────────────────────────────────────┤
│                                                                       │
│  DIRECTOR OF SCOUTING                                                 │
│                                                                       │
├──────────────────────────────────────────────────────────────────────┤
│                                                                       │
│   "Morning, boss. Three things on my mind:"                          │
│                                                                       │
│   ┌───────────────────────────────────────────────────────────────┐   │
│   │ 1. We're picking 4th. Word is the three teams ahead are       │   │
│   │    leaning QB, QB, RB. Both our top WR targets should be      │   │
│   │    there at 4. I'd hold and let it come to us.                │   │
│   └───────────────────────────────────────────────────────────────┘   │
│                                                                       │
│   ┌───────────────────────────────────────────────────────────────┐   │
│   │ 2. Mendoza's CFC value is up 18% this month — we still        │   │
│   │    have him at 22 on our board. Time to bump him.             │   │
│   └───────────────────────────────────────────────────────────────┘   │
│                                                                       │
│   ┌───────────────────────────────────────────────────────────────┐   │
│   │ 3. Founders and Kush are both light on picks and need WR      │   │
│   │    help. We've got WR depth to trade. Worth opening a         │   │
│   │    conversation.                                              │   │
│   └───────────────────────────────────────────────────────────────┘   │
│                                                                       │
│   Which one do we tackle? Or is there something else on your mind?    │
│                                                                       │
│                                                                       │
│                                                                       │
│                                                                       │
│  ┌─────────────────────────────────────────────────────────────────┐  │
│  │ [Ask the Director of Scouting…]                          [Send] │  │
│  └─────────────────────────────────────────────────────────────────┘  │
└──────────────────────────────────────────────────────────────────────┘
```

- **InnerTopbar:** standard inner-page topbar.
- **Page title:** *"Director of Scouting"* in Syne 800.
- **Chat surface:** full-width, takes the whole content area. No sidebar, no right rail.
- **Opening message:** director's three POVs rendered as clickable items. Each POV is a self-contained intel statement ending in a recommendation.
- **Click a POV** → it becomes the user's next message ("Let's dig into #1") OR opens a follow-up conversation directly. Build-time decision (lean toward the latter — direct dive).
- **Chat input:** pinned at the bottom. Placeholder *"Ask the Director of Scouting…"*. Send button on the right.
- **Subsequent messages:** standard chat thread layout. Director's responses appear left-aligned with the director's identifier; user's messages right-aligned.

### Mobile (<768px)

Same shape, full-screen. Topbar mobile pattern (hamburger / logo / settings). Page title in the content area. Chat takes the rest of the screen. Input pinned at the bottom.

---

## Section 4: The Director's Opening Message

When the user opens the office, the director's first message contains **exactly three POVs**, generated from current league + roster + draft state. Hard cap at three — more than that and it stops feeling like a curated briefing.

### Format

Three numbered items, each one a self-contained statement following the pattern:

**Signal → named target → director's recommendation → optional CTA**

The director leads with a recommendation. Doesn't survey the user with open questions.

### Examples (Voice Reference)

**Draft position intelligence:**
> *"We're picking 4th. Word is the three teams ahead are leaning QB, QB, RB. Both our top WR targets should be there at 4 — I'd hold and let it come to us."*

> *"If we want a starting WR with our 1st, we can't trade back past 6. Teams picking 5 and 6 are both buying at WR — they'll take the guys we want."*

**Trade partner intelligence:**
> *"Word is a couple teams behind us are high on Mendoza. If he's there at 4 we'll have buyers — Founders and Outlaws have the picks to make it work. Want me to put feelers out?"*

> *"We don't have a 3rd this year and we said we want more picks. Founders and Crossfitters have extras and need WR help. I'd start with Crossfitters — their needs line up better."*

**Board hygiene:**
> *"Our board's at 60% set. Draft's 3 weeks out and the consensus is moving fast — let's lock in our top 50 this week so I can flag drift early."*

> *"We've got Bowers at 18 but the rest of the league has him top 5. Either we know something they don't or we should take another look."*

**Value drift:**
> *"Mendoza's value popped 18% this month. We've still got him at 22 — time to bump him up."*

**Positional shape:**
> *"There are 4 RBs in our starter tier and then a cliff. If we want one, we go at 4 — there won't be anything close by our 2nd."*

### What the Opening NEVER Does

- **Never names what another team has on their board.** *"Word is they're high on Mendoza"* is fine. *"Team X has Mendoza ranked #3"* is not. Never peeks behind the curtain.
- **Never asks open questions instead of leading.** *"Who do you think we should call?"* is dead. *"I'd start with Founders — let me know if you agree."* is right.
- **Never uses codespeak.** No "wants_more," no "consensus board," no dollar values. Translate to "we said we want picks," "the rest of the league," "his value popped."
- **Never pads to fill the third slot.** If there are only two real things on the director's mind today, the opening has two POVs. Empty state pattern handles a truly quiet day (Section 6).

---

## Section 5: Inline Actions in the Chat

The director's responses can surface structured inline actions — UI components rendered in the message stream. These are what make the chat feel native to the app rather than a chatbot bolted on.

### Action Types

| Action Type | Visual | Behavior |
|---|---|---|
| **Proposed trade** | Mini trade card embedded in the message — partner team name, brief asset list (send/receive), balance chip, "Open in Builder" button | Click → routes to Trade Builder with the deal pre-populated. The mini card stays in the conversation thread as a record. |
| **Deep link to workroom** | Inline button below the director's prose (e.g., *"Open Big Board →"*, *"View Mendoza on the board →"*) | Click → routes to the specified workroom, scoped to the relevant player/round if applicable. |
| **One-click commit** | Inline button that fires an API call (e.g., *"Bump Mendoza on the board"*) | Click → API fires, message updates in place with a confirmation state (*"Bumped Mendoza from 22 to 12 ✓"*). Stays in conversation. |
| **Multi-option choice** | Two or three buttons inline (e.g., *"Talk to Founders"* / *"Talk to Outlaws"* / *"Pass"*) | Click one → director continues the conversation based on the choice. |

### Example Flow

User clicks POV #1: *"We're picking 4th. Word is the three teams ahead are leaning QB, QB, RB..."*

Director responds:
> *"Right — three teams ahead, three different needs. Here's what I'd do for our 4th: if WR run starts at 1-2-3, we still get our guy. If they go QB-QB-RB like I'm hearing, we have first pick of the WRs. Either way we're sitting pretty. Want me to draft a trade-down proposal to one of the teams behind us as a backup plan?"*
>
> [Yes, draft a trade-down] [No, hold the pick] [Show me who'd be interested]

User clicks "Yes, draft a trade-down" → director generates and renders a mini trade card inline with "Open in Builder" button. User clicks that → routes to Trade Builder pre-populated.

---

## Section 6: Empty State

When the director has nothing pressing (deep offseason, board is set, no drift, no trade intel signals), the opening message is shorter and softer:

> *"Class is locked, boss. We're ready. Anything you want to dig into?"*

No bullet POVs. No padded insights. Just the director's voice acknowledging the calm and the chat input ready for whatever the user wants to ask.

If even one POV exists, the opening shows that one POV plus an invitation:

> *"One thing on my mind, boss:"*
>
> *"Mendoza's value popped 18% this month — we've still got him at 22. Time to bump him up."*
>
> *"Otherwise we're in good shape. What do you want to look at?"*

---

## Section 7: V1 Intel Categories (Closed-League Data Only)

Building from the discussion: V1 ships with closed-league data only. LLM-powered current-news intel (combine results, pro day reports, injury updates) is deferred until the intel pipeline is built (separate workstream — see Section 12).

### Categories That Ship in V1

**1. Draft position intelligence**
- Who's likely on the board at our pick (aggregates rankings of teams ahead, surfaces probable available targets)
- Trade-back floors (based on position markets + roster gaps of teams behind us)
- Big positional dropoffs ("4 starter-tier RBs then a cliff — go now or wait long")

**2. Trade partner intelligence**
- Best trade-up partner ("Teams behind us are high on [Player] — Founders and Outlaws have the picks")
- Best trade-down partner ("Teams Y and Z need WR and aren't getting one — they'd pay to move up")
- Fire-sale and level-up mode detection from recent trade activity
- Comparable trades ("Player like Wilson just netted a 2nd and a starter WR last week — we should be able to pull the same")

**3. Board hygiene**
- Board completeness signals ("60% set, 3 weeks out")
- Outlier check (user's rank vs. league consensus, anonymized)
- Value drift (CFC value movement vs. user's board placement)

**4. Cross-director signals**
- Reads R&S wants_more + position market to shape trade-up/down intel relevance

### Categories Deferred to Phase 2

- Current player news (rising/falling stocks from real-world events, combine results, pro day reports, injury updates)
- Next year's class scouting (requires college football data layer)
- Sleeper / red flag identification (requires structured scouting data)

These are flagged in Section 12.

---

## Section 8: Conversation Persistence

Each director's office maintains its own conversation thread. Leave and return → same thread. The director's opening message regenerates only when there's meaningful new state (new signals, new trade activity, board updates) or when the user explicitly clears the conversation.

V1 storage: localStorage. Move to backend deferred — not blocking.

### Conversation Controls
- **Clear conversation** — option in a small menu (top right of chat, TBD at mockup). Wipes the thread and triggers a fresh opening.
- **Conversation history** — scroll up to see prior messages. Standard chat affordances.

---

## Section 9: Workrooms

### 9.1 Big Board (`/scouting/big-board`)

The unified prospect ranking workroom. **Rookies and vets in one board.** Round 1 isn't a separate concept from Rounds 2/3 — it's one board with one ranking.

Inherits the existing Set Rankings surface from the codebase. Key features (preserved):
- Drag-to-reorder ranking interface
- Player cards / rows showing key signals
- "Their guys" / starred concept — user can mark prospects as targets (separate from ranking) to give the director better intel signal *(idea from chat — confirm at build whether already exists or needs to be added)*
- QB strategy / superflex toggles (existing)

### 9.2 Draft Room (`/scouting/draft-room`)

The live draft surface. Existing implementation in `src/components/draft/`. Preserved. Treated as one continuous draft (Round 1 + Rounds 2/3 unified — no separate routes per draft day).

The existing `AssistantGmPanel` in the draft room may be renamed or repurposed (build-time decision) since the College Scout staff role is killed. Options:
- Rename to "Real-Time Draft Assistant" or similar (distinct from the director's office)
- Fold its real-time advisory function into the same director voice (so the draft room's assistant IS the director)

Recommend the second option — same voice everywhere makes the app feel like one consistent personality.

### 9.3 Mock Draft (`/scouting/mock-draft`)

Mock draft simulator. Existing or to-be-built. Out of scope for this spec — it's a workroom, not a chat surface. The office can deep-link into it ("Run a mock to test this strategy").

---

## Section 10: Topbar

Inherits `InnerTopbar` from GM Office spec.

### Desktop
| Slot | Content | Behavior |
|---|---|---|
| Left | ← back arrow | Returns to home |
| Center | CFC league logo | Returns to home |
| Right | Settings icon | Opens settings menu |

### Mobile
| Slot | Content | Behavior |
|---|---|---|
| Left | Hamburger menu | Opens global nav |
| Center | CFC league logo | Returns to home |
| Right | Settings icon | Opens settings |

---

## Section 11: Killed in v3.0

These existed in v1.x / v2.x and are removed:

1. **Scouting landing binder grid.** 3-column card grid on desktop, swipe deck on mobile. Gone.
2. **Lens engine cards.** Rankings reminders, Rankings drift, Trade up/down intel as card-producing engines. Gone (the intel itself survives as conversation in the office).
3. **College Scout staff voice.** The director is the only voice.
4. **Opener chips on chat panel.** Replaced by the director's opening 3 POVs.
5. **Persistent chat right rail.** No rail — chat is the entire surface.
6. **Landing header bar with "Set rankings" + "Enter draft room" buttons.** Workrooms are reached from home screen deep links or office inline actions.
7. **Mobile pinned action buttons below the topbar.** Same reason.
8. **Director's-voice empty-state card.** Empty state lives in the chat opening message now.
9. **"Memo card" subject chrome.** Memo card template is dead globally.
10. **Card priority sort (red/yellow/green).** No cards, no sort.
11. **28-day dismissal cooldown.** No cards to dismiss.

---

## Section 12: Files Affected

### Retire / replace
- `src/components/scouting/ScoutingLanding.tsx` — kill (if built in v2.x)
- `src/components/scouting/CardGrid.tsx` — kill
- `src/components/scouting/RankingDriftCard.tsx` — kill
- `src/components/scouting/RankingReminderCard.tsx` — kill
- `src/components/scouting/TradeIntelCard.tsx` — kill
- `src/components/scouting/ScoutingChatPanel.tsx` — replace with full office implementation (see below)
- `src/components/scouting/ScoutingHeaderBar.tsx` — kill
- `src/components/scouting/EmptyLanding.tsx` — kill

### New (v3.0)
- `src/components/scouting/ScoutingOffice.tsx` — top-level office page composing topbar + page title + chat surface. Mounts at `/scouting/office`.
- `src/components/scouting/DirectorChat.tsx` — chat thread component (may be shared with PP and R&S — extract to `src/components/shared/DirectorChat.tsx`)
- `src/components/scouting/DirectorOpening.tsx` — renders the opening message (1-3 POVs or empty state)
- `src/components/scouting/InlineTradeCard.tsx` — mini trade card embedded in messages (may be shared with PP)
- `src/components/scouting/InlineActionButton.tsx` — reusable button for deep links and commits

### Reuse
- `src/components/draft/*` — Draft Room components, preserved
- `src/components/draft/AssistantGmPanel.tsx` — preserved; rename or repurpose as the director's in-draft voice (build decision)
- Big Board components — existing surface preserved

### New / extended APIs
- `/api/scouting/office/opening` — generates the director's opening 3 POVs based on current state
- `/api/scouting/office/respond` — director's response to a user message (LLM-backed)
- `/api/scouting/intel/draft-position` — closed-league data: who's likely on the board, trade partner candidates, etc.
- `/api/scouting/intel/board-hygiene` — board completeness, outliers, value drift signals

### Director memo pipeline (writes to inbox)
- The Scouting director also files memos to the GM inbox (reminders, recaps). New: a memo-generation job that runs on a cadence (TBD — daily? on state change?) and writes director memos to the inbox. Out of scope for the office spec itself but flagged here as a related workstream.

---

## Section 13: Build Order Recommendation

### Phase 1 — Shared chat infrastructure
1. **`DirectorChat.tsx`** — shared chat thread component. May be extracted to `src/components/shared/` if PP and R&S use the same shape (likely).
2. **`InlineActionButton.tsx`** — reusable button for deep links and commits.
3. **`InlineTradeCard.tsx`** — mini trade card. Likely shared with PP.

### Phase 2 — Office shell
4. **`DirectorOpening.tsx`** — opening message renderer. Handles the 3-POV, 1-POV, and empty cases.
5. **`ScoutingOffice.tsx`** — top-level page. Composes topbar + page title + DirectorChat. Mount at `/scouting/office`.

### Phase 3 — Backend intel
6. **`/api/scouting/intel/draft-position`** — closed-league data queries (rankings aggregation, team needs analysis).
7. **`/api/scouting/intel/board-hygiene`** — board state + value drift queries.
8. **`/api/scouting/office/opening`** — generates 3 POVs from intel signals. LLM-backed for prose; structured data from the intel endpoints.
9. **`/api/scouting/office/respond`** — handles user messages; LLM responds with prose + structured action payloads where applicable.

### Phase 4 — Inline actions
10. **Wire proposed-trade action** — director emits a `proposed_trade` action; renders as InlineTradeCard with "Open in Builder" button.
11. **Wire deep-link actions** — Big Board (scoped to player), Draft Room, Mock Draft.
12. **Wire one-click commits** — bump player on board, etc.

### Phase 5 — Polish
13. **Conversation persistence** — localStorage V1.
14. **Clear conversation** affordance.
15. **Mobile responsive polish.**
16. **Phase 2 intel pipeline (deferred)** — when ready, add current-news intel (combine results, pro day reports, injury updates) via separate data pipeline.

---

## Section 14: Open Items / Deferred Decisions

NOT blockers:

1. **Director's-voice content engine.** LLM at request time vs. templated rules with LLM polish. Probably hybrid (structured intel from queries, LLM for prose). Defer.
2. **Phase 2 intel pipeline.** Current-news intel (combine, pro days, injuries). Separate build, separate cost model. Deferred from V1.
3. **AssistantGmPanel renaming/repurposing in Draft Room.** Lean toward folding into the director voice. Confirm at build.
4. **"Their guys" / starred prospects feature.** Confirm if this exists in current Big Board or needs to be added.
5. **Conversation persistence backend.** V1 localStorage; backend deferred.
6. **POV click behavior.** Does clicking a POV auto-send "Let's dig into #1" or open a direct dive? Recommend direct dive. Confirm at build.
7. **Director memo generation pipeline.** Triggers + cadence for filing memos to the inbox. Separate workstream.
8. **Mock Draft surface.** Out of scope for this spec; build separately.

---

## Section 15: Behavioral Notes

- **Default landing within the door:** `/scouting/office`.
- **Logo click:** returns to home.
- **Back arrow:** returns to home.
- **Hamburger (mobile):** opens global nav.
- **POV click in opening message:** dives into a follow-up conversation on that topic.
- **Inline action click:** fires the action (deep link routes; commit fires API + updates message in place).
- **Send button click:** submits user message; director responds in thread.
- **Clear conversation:** wipes thread, regenerates opening.

---

## Section 16: Summary — At-a-Glance

| Element | Decision |
|---|---|
| **Routing** | `/scouting/office` (chat) · `/scouting/big-board` · `/scouting/draft-room` · `/scouting/mock-draft` |
| **Concept** | Director's office — chat-driven workspace, director is the only voice |
| **Office layout** | Full-width chat surface, no sidebars, no rails. Topbar + page title + chat thread + pinned input |
| **Opening message** | Director's top 3 POVs (or fewer in quiet states). Each POV is signal → named target → recommendation → optional CTA |
| **Voice** | First person ("we / our"), conversational, anonymized intel, no codespeak, leads with POV not open questions |
| **Inline actions** | Proposed trade (mini card) · Deep links · One-click commits · Multi-option choices |
| **V1 intel** | Closed-league data only — draft position intelligence, trade partner intelligence, board hygiene |
| **Deferred to Phase 2** | Current-news intel (combine, pro days, injuries), next-year class scouting |
| **Workrooms** | Big Board (unified rookies + vets) · Draft Room (existing) · Mock Draft |
| **Round 1 vs. 2/3** | Treated as one continuous draft, not split by day |
| **Cross-director signals** | Reads R&S wants_more + position market for trade intel relevance |
| **Killed in v3.0** | Landing binder grid · Lens engine cards · College Scout staff voice · Opener chips · Persistent chat rail · Landing header bar · Empty-state card · Memo card subject chrome · Card priority sort · 28-day dismissal cooldown |

---

## End of Spec — Ready for Build

The Scouting v3.0 design is fully locked. Items intentionally deferred are content-engine choices, Phase 2 intel pipeline, AssistantGmPanel renaming, "their guys" feature confirmation, and Mock Draft scoping.

Pick this up in a build chat by attaching this document along with `/docs/CFC-APP-STATUS.md` v3.0, `CFC-HOME-SCREEN-SPEC.md` v3.0, `CFC-GM-OFFICE-SPEC.md` v3.0, `CFC-PRO-PERSONNEL-SPEC.md` v3.0, and `CFC-RESEARCH-STRATEGY-SPEC.md` v3.0.
