# CFC Front Office — GM Office Landing Spec

**Version:** 3.1
**Date:** May 18, 2026
**Status:** Design locked — ready for Phase 2 build

> **Revision note (v3.1):** Path-only update. Phase 0 is complete (May 18, 2026): the repo is reorganized into surface-based folders. Inbox components for Phase 2 land under `src/inbox/` (with subfolders `thread/`, `insider/`, `persona/`), not under `src/components/gm-office/`. Some files already moved during Phase 0 (ThreadPage, ChatBubble, AcceptModal, RejectModal, CounterDrawer, InsiderPanel, PersonaCard, PersonaPicker). InboxPage / FilterBar / TradeCard stayed at `src/components/gm-office/` and get rebuilt in Phase 2. AppShell is dead (Phase 0) — no persistent global nav above the inbox. The persona switcher's new home is decided: Settings. Design decisions from v3.0 are unchanged.

> **Revision note (v3.0):** Major redesign. The GM Office is now exclusively the **Gmail-style inbox**. Sidebar killed (no Propose / Shop / Feed). Persona switcher relocated. The inbox interleaves director memos and trade correspondence in a single list. Four filter chips (Unread / Sent / Trash / Archive). Row-based layout (sender / subject / preview / timestamp). Click a row → body opens. Insider feed survives as a separate drawer (carried forward from v2.x). The home screen handles all navigation; the GM Office is one focused surface.

---

## Purpose of This Document

This document captures every design decision for the **GM Office** — which in v3.0/3.1 is exclusively the inbox. The route is `/inbox` (set in Phase 0).

This spec must be read alongside:
- `CFC-APP-STATUS.md` v3.0 (project-wide non-negotiables)
- `CFC-PHASE-0-RECAP.md` (current repo state, folder map, conventions)
- `CFC-HOME-SCREEN-SPEC.md` v3.1 (the home screen routes here from the GM box)

---

## Section 1: Concept & Metaphor

The GM Office IS the GM's inbox. Walk in from the home screen, see what's on your desk. Real email metaphor — sender / subject / preview / timestamp / status. Scannable, filterable, searchable. Click a row to read the full message and act on it.

The inbox has two kinds of messages:

- **Trade correspondence** — offers from other GMs, counters, accepted trades, withdrawn offers. The other team's name is the sender.
- **Director memos** — reminders, recaps, intel summaries from the three directors. The director is the sender.

These interleave by date in a single list, exactly like a real email inbox. Filters let the user slice if needed.

The home screen's GM box previews the unread count and clicks here. Everything else lives on the home screen as a deep link.

---

## Section 2: Layout Architecture

### Desktop (≥768px)

```
┌──────────────────────────────────────────────────────────────────────┐
│  [InnerTopbar: ← back · league logo · settings]                       │
├──────────────────────────────────────────────────────────────────────┤
│                                                                       │
│  [Unread] [Sent] [Trash] [Archive]                       [🔍 search]  │
│                                                                       │
├──────────────────────────────────────────────────────────────────────┤
│  ● [Founders]      Offer for Lamb                     • 2h ago        │
│    [PP Director]   Founders' fire sale — let's act     • 4h ago        │
│  ● [Outlaws]       Counter on Daniels deal             • 1d ago       │
│    [R&S Director]  Mahomes hit the age cliff           • 1d ago       │
│    [Scouting Dir]  Board's still 60% set               • 2d ago       │
│  ● [Crossfitters]  Offer for our 2026 1st              • 3d ago       │
│    [PP Director]   Lamb's stock just popped 15%         • 3d ago       │
│    ...                                                                │
└──────────────────────────────────────────────────────────────────────┘
```

- **InnerTopbar:** back arrow / league logo / settings. Inherits standard inner-page pattern.
- **Filter row:** four chips (Unread / Sent / Trash / Archive) + search icon on the right.
- **Main content area:** Gmail-style row list, interleaved by date.
- **Click a row** → opens the message body in the main content area (replacing the row list). Back-to-inbox affordance in the topbar.

### Mobile (<768px)

```
┌─────────────────────────────────┐
│  [topbar: hamburger / logo / ⚙] │
├─────────────────────────────────┤
│ [Unread][Sent][Trash][Archive]  │
├─────────────────────────────────┤
│ ● Founders                       │
│   Offer for Lamb         2h ago  │
├─────────────────────────────────┤
│   PP Director                    │
│   Founders' fire sale    4h ago  │
├─────────────────────────────────┤
│ ● Outlaws                        │
│   Counter on Daniels     1d ago  │
├─────────────────────────────────┤
│   ...                            │
└─────────────────────────────────┘
```

- Top bar: hamburger / logo / settings (standard mobile inner-page pattern).
- Filter chips horizontal, scrollable if they don't fit.
- Search icon on the right of the filter row (same as desktop).
- Row list takes full width. Tap a row → routes to a message detail page.

---

## Section 3: Inbox Row Anatomy

Each row contains:

| Element | Position | Details |
|---|---|---|
| **Status indicator** | Far left | Small filled dot (Blue #3366CC) if unread. Empty/no dot if read. For aged-pending offers, dot uses Yellow or Red urgency color. |
| **Sender** | Left, after status | Other team's name (for trade correspondence) or Director name (for memos). Bold if unread. |
| **Subject line** | Middle | Concise summary. *"Offer for Lamb"* / *"Founders' fire sale — let's act"* / *"Board still 60% set"*. |
| **Preview** | Middle, after subject (inline truncated) | One-line truncated body preview. For trades: AI quip or asset list. For memos: first line of memo body. |
| **Timestamp** | Far right | `timeAgo` format. Right-aligned, JetBrains Mono, muted. |

### Sender Visual Differentiation
Each director has a small consistent glyph or color accent next to their name so the user can scan-sort:

- **Director of Scouting** — Scouting-themed accent (TBD at mockup — could be a small clipboard glyph or a colored chip behind the name)
- **Director of Pro Personnel** — PP-themed accent
- **Director of Research & Strategy** — R&S-themed accent

Trade thread rows use the other team's logo (small, ~16-20px) before the sender name.

### No Inline Actions on the Row
Accept / Decline / Counter / Withdraw all live inside the message body. The row itself is purely scannable — no action buttons clutter the list.

### Closed / Read Treatment
Read rows render at reduced opacity (~0.6). Closed threads (accepted, declined, withdrawn) include the closure state in the timestamp area (e.g., *"Accepted · 2d ago"*).

---

## Section 4: Filter Chips

Four filters, leaning into the email metaphor. **Apply to both trade correspondence and director memos** — the user filters across the whole inbox, not by message type.

| Filter | Maps To |
|---|---|
| **Unread** (default view) | Anything not yet opened — pending trade offers waiting on the user, fresh director memos |
| **Sent** | Pending trade offers the user has sent (waiting on the other team) |
| **Trash** | Trade offers the user withdrew, or memos the user dismissed (if dismissal is supported on memos) |
| **Archive** | Closed trade threads (accepted, declined, withdrawn by other team) AND read memos |

### Filter Chip Style
- Active filter: filled with Ink (#1A1A1A), Paper text
- Inactive filters: outlined, Ink text
- 2.5px solid border, no rounded corners
- Click to switch — only one filter active at a time

---

## Section 5: Search

Small search icon sits to the right of the filter row. Clicking it expands an inline search input (no modal, no full-row collapse). Clearing or dismissing returns to the filter view.

Search behavior:
- Searches across both trade correspondence and director memos
- For trades: matches counterpart team names + asset labels
- For memos: matches sender name + subject + body text

---

## Section 6: Persona Switcher — Decided

The v3.0 spec deferred the persona switcher's location after the nameplate was killed. **v3.1 resolution: persona switcher lives in Settings** (Option 1 from v3.0 Section 6).

Settings is reached via the settings icon in the InnerTopbar (right slot, desktop and mobile). Settings page itself is a separate build (defer to whichever phase introduces it).

The per-deal persona override popover inside Trade Studio's OfferCard is unaffected — that's a per-trade adjustment, not a persona setting change.

`src/inbox/persona/PersonaCard.tsx` and `src/inbox/persona/PersonaPicker.tsx` (relocated during Phase 0) will be consumed by Settings when that surface gets built. They're parked at their new path in anticipation.

---

## Section 7: Empty States

When a filter has no results:

| Filter | Headline | Sub-line |
|---|---|---|
| Unread | *"No deals on the table."* | *"Quiet around here."* |
| Sent | *"Nothing pending."* | optional |
| Trash | *"Trash is empty."* | optional |
| Archive | *"No closed deals yet."* | optional |

No CTAs in empty states (the home screen handles "what to do next" — empty inbox doesn't need to push the user toward making trades). Final copy locked at content-pass time.

### Loading State
Standard ink-bordered block with `Loading…` text in JetBrains Mono.

---

## Section 8: Message Body View

Clicking an inbox row opens the message body. The view depends on message type.

### Trade Thread Body
Inherits from the existing `src/inbox/thread/ThreadPage.tsx` (relocated from `src/components/gm-office/ThreadPage.tsx` in Phase 0). Shows:
- The chain of offers (original + counters)
- Each offer card with send/receive, balance chip, AI advisor prose
- Inline actions (Accept / Decline / Counter / Withdraw) on the latest open offer
- ChatBubble messages between the two GMs (if any)

Largely unchanged in v3.1 — this is the existing thread page. Will get its own design pass later (out of scope for Phase 2).

### Director Memo Body
New for v3.0/3.1. Shows:
- Sender (director name + glyph)
- Subject
- Full memo body in director voice (first person, conversational)
- Inline actions (deep links to relevant workrooms, one-click commits where applicable)
- Timestamp

Director memos are short — typically 2-4 sentences. The body view is mostly clean text + actions. No complex layout.

### Examples of Director Memo Bodies

**From Scouting Director:**
> *"Boss, the board's at 60%. Draft's still 3 weeks out but the consensus moves fast — worth getting our top 50 locked in this week so I can flag any drift early."*
>
> [Open Big Board →]

**From PP Director:**
> *"Founders just shipped Allen and their 2026 1st for picks and youth — full fire sale. Their WR room is loaded with guys we'd love. I'd start with Lamb and offer our 1st plus a depth piece."*
>
> [Open in Trade Builder →]

**From R&S Director:**
> *"Mahomes turned 33 last month and the curve says he's a depreciating asset. We've still got him Core. I'd drop him to Listening and let me flag him to Pro Personnel as a shop candidate."*
>
> [Drop to Listening] [Open Set Availability →]

The inline actions render as buttons within the body. Some are deep links (route to a workroom); some are one-click commits (fire an API call, update the memo body in place with confirmation).

---

## Section 9: Killed in v3.0/3.1

These existed in v1.x / v2.x and are removed:

1. **GM Office sidebar** (Propose / Shop / Feed nav items). The whole sidebar is gone.
2. **Nameplate** in the sidebar. No sidebar means no nameplate.
3. **Persona switcher in the nameplate.** Relocated to Settings (Section 6 above).
4. **Propose popover** ("Scout Players or Scout Teams"). Long dead — Propose routes from home screen go directly to workrooms.
5. **Persona cascade drawer** (the desktop slide / mobile accordion to switch persona). Persona switching moves to Settings.
6. **The old `FilterBar` "all / open / closed"** — replaced by Unread / Sent / Trash / Archive (already changed in v2.x).
7. **Empty-state CTAs (Make an offer / Shop around buttons).** Home screen handles next-step navigation.
8. **Page title "Trade Center."** No more page title — the inbox is the screen.
9. **AppShell persistent topbar (killed in Phase 0).** No persistent global nav above the inbox.

---

## Section 10: CFC Insider Feed — Decided

The v3.0 spec deferred the Insider feed's disposition. **v3.1 resolution: roll Insider content into the inbox** (Option 3 from v3.0 Section 10).

Each completed league trade becomes a memo from a director — likely the PP Director ("Founders sent Lamb to Outlaws for 1.04 and a 2nd"). The "feed" concept is redundant with the inbox if the inbox is broad enough; consolidate.

This kills the separate Insider drawer concept. `src/inbox/insider/InsiderPanel.tsx` (relocated in Phase 0) becomes parked / available for future reuse if a dedicated feed surface is ever needed, but Phase 2 build does not consume it.

---

## Section 11: Inner Page Topbar

Inherits from the inner-page pattern (applies to all surfaces one level below home). The `InnerTopbar` component is new in Phase 2 — it's the shared topbar for any inner page (will be reused by Scouting / PP / R&S in subsequent phases).

### Desktop
| Slot | Content | Behavior |
|---|---|---|
| Left | ← back arrow | Returns to home (org chart) |
| Center | CFC league logo (clickable) | Returns to home (org chart) |
| Right | Settings icon | Opens settings/account menu |

### Mobile
| Slot | Content | Behavior |
|---|---|---|
| Left | Hamburger menu | Opens global navigation drawer (Front Office home, Scouting, PP, R&S, settings) |
| Center | CFC league logo (clickable) | Returns to home (org chart) |
| Right | Settings icon | Settings access |

### Settings Menu Contents
Out of scope for this spec. At minimum: account info, league info, Sleeper integration, notification preferences, **persona switcher** (relocated from nameplate), logout.

---

## Section 12: Files Affected

> **Phase 0 context:** As part of Phase 0, the repo reorganized into surface-based folders. Inbox components for Phase 2 land under `src/inbox/`, not `src/components/gm-office/`. Some files already moved during Phase 0 (see "Already moved" below). The legacy v2.x files that survived Phase 0 (InboxPage, FilterBar, TradeCard, GMOfficeLayout, etc.) still live in `src/components/gm-office/` and get retired during Phase 2.

### Already moved (Phase 0 — paths are final)
- `src/inbox/thread/ThreadPage.tsx`
- `src/inbox/thread/ChatBubble.tsx`
- `src/inbox/thread/AcceptModal.tsx`
- `src/inbox/thread/RejectModal.tsx`
- `src/inbox/thread/CounterDrawer.tsx`
- `src/inbox/insider/InsiderPanel.tsx`
- `src/inbox/persona/PersonaCard.tsx`
- `src/inbox/persona/PersonaPicker.tsx`

### Retire / replace (during Phase 2)
Currently at `src/components/gm-office/` — get killed or rewritten:
- `src/components/gm-office/InboxPage.tsx` — replace with `src/inbox/InboxView.tsx`
- `src/components/gm-office/FilterBar.tsx` — replace with `src/inbox/FilterChips.tsx`
- `src/components/gm-office/TradeCard.tsx` — kill (replaced by Gmail-style row in `src/inbox/InboxRow.tsx`)
- `src/components/gm-office/GMOfficeLayout.tsx` — kill (no sidebar)
- `src/components/gm-office/Nameplate.tsx` — kill
- `src/components/gm-office/PersonaDrawer.tsx` — kill (persona moves to Settings, surviving PersonaCard/PersonaPicker live at `src/inbox/persona/`)
- `src/components/gm-office/SidebarNav.tsx` — kill
- `src/components/gm-office/MobileTabBar.tsx` — kill (no bottom tab bar)
- `src/components/gm-office/ProposePopover.tsx` — kill if not already gone
- `src/components/gm-office/InsiderDrawer.tsx` — kill (Insider rolls into inbox per Section 10)

### New (Phase 2)
- `src/inbox/InboxView.tsx` — top-level inbox screen
- `src/inbox/InboxRow.tsx` — Gmail-style row component
- `src/inbox/FilterChips.tsx` — Unread / Sent / Trash / Archive
- `src/inbox/SearchToggle.tsx` — search icon + inline expansion
- `src/inbox/MessageBody.tsx` — message body container, routes between trade body and memo body
- `src/inbox/DirectorMemoBody.tsx` — memo body rendering (subject + director voice + inline actions)
- `src/shared/chrome/InnerTopbar.tsx` — shared inner-page topbar (reusable across Scouting / PP / R&S in later phases). Lives in `src/shared/chrome/` because it's cross-surface.

### Reuse (existing files preserved)
- `src/inbox/thread/ThreadPage.tsx` + sibling thread components — used inside `MessageBody`

### Data wiring
- Inbox query that interleaves trade threads + director memos sorted by date
- Director memo schema (sender, subject, body, status, inline actions)
- New endpoint for marking memos read / archived / trashed
- Existing `/api/inbox/unread-count?teamId=...` (already in use by old AppShell — surviving endpoint, can keep or refactor)
- Existing `/api/inbox/threads/...` and `/api/inbox/threads/status` — preserved from Phase 0 API moves

---

## Section 13: Build Order Recommendation

1. **`src/shared/chrome/InnerTopbar.tsx`** — shared component. First commit. Reusable.
2. **`src/inbox/FilterChips.tsx`** — standalone, takes filter list + active prop.
3. **`src/inbox/SearchToggle.tsx`** — standalone search icon + inline input.
4. **`src/inbox/InboxRow.tsx`** — Gmail-style row. Takes a unified message prop (trade or memo type).
5. **Director memo schema + API** — backend work to create/query director memos.
6. **`src/inbox/DirectorMemoBody.tsx`** — memo body rendering with inline actions.
7. **`src/inbox/MessageBody.tsx`** — orchestrator that routes to trade body or memo body based on message type.
8. **`src/inbox/InboxView.tsx`** — top-level page composing topbar + filter chips + search + row list + message body.
9. **`src/app/inbox/page.tsx`** — replace the existing thin wrapper to mount `InboxView` (was mounting old InboxPage component).
10. **Wire data** — interleaved inbox query, read/archive/trash mutations.
11. **Mobile responsive polish.**

---

## Section 14: Open Items / Deferred Decisions

NOT blockers:

1. **Director glyph designs.** Per-director visual accent. Defer to mockup.
2. **Empty state copy.** Final copy variants — settle at content-pass time.
3. **Memo dismissal mechanic.** Can the user "delete" a memo from the inbox? Defer.
4. **Cross-surface deeplinking.** Memo body's inline actions need stable route targets — confirm route map at build (most targets are 404 until the relevant phase ships — see CFC-HOME-SCREEN-SPEC.md v3.1 Section 4 for the current state of routes).
5. **Director memo generation pipeline.** Who generates memos, on what cadence, with what triggers — defer to build (separate workstream).
6. **Settings menu contents and the Settings surface itself.** Defer.
7. **Onboarding states.** Empty inbox for a brand new user — defer.

---

## Section 15: Behavioral Notes

- **Default landing:** Inbox with the Unread filter active.
- **Logo click on topbar:** returns to home.
- **Back arrow:** returns to home.
- **Hamburger (mobile):** opens global nav.
- **Row click:** opens message body in main content area (desktop) or routes to message page (mobile).
- **Filter chip click:** switches filter, refreshes row list.
- **Search icon click:** expands inline input.
- **Memo inline action click:** fires the action (deep link routes to a new surface; one-click commit fires API + updates memo body in place).
- **Toast:** existing pattern preserved.

---

## Section 16: Summary — At-a-Glance

| Element | Decision |
|---|---|
| **Route** | `/inbox` (set in Phase 0) |
| **Layout** | Single-surface inbox — no sidebar, no nameplate, no nav within the office |
| **Inbox structure** | Gmail-style rows, interleaved trade correspondence + director memos by date |
| **Row anatomy** | Status indicator · sender · subject · preview · timestamp |
| **Filter chips** | Unread (default) / Sent / Trash / Archive |
| **Search** | Inline expand icon |
| **Message body** | Trade body (existing ThreadPage at `src/inbox/thread/`) OR Director memo body (subject + voice + inline actions) |
| **Insider feed** | Rolled into inbox as memos from PP Director (decided in v3.1) |
| **Persona switcher** | Relocated to Settings (decided in v3.1) |
| **Sidebar** | KILLED |
| **Nameplate** | KILLED |
| **Persona cascade drawer** | KILLED |
| **Empty state CTAs** | KILLED (home screen handles next-step navigation) |
| **AppShell persistent topbar** | KILLED in Phase 0 |
| **Component location** | `src/inbox/` for inbox components, `src/shared/chrome/InnerTopbar.tsx` for the shared topbar |
| **Topbar (desktop)** | ← back / league logo / settings |
| **Topbar (mobile)** | hamburger / league logo / settings |

---

## End of Spec — Ready for Phase 2 Build

The GM Office v3.1 design is fully locked. Path references reflect the post-Phase-0 repo structure. The two v3.0 deferred decisions (persona switcher home, Insider feed disposition) are now resolved (both to the recommended options from v3.0). Items intentionally deferred are mockup details (director glyphs, copy variants), Settings surface itself, memo dismissal mechanics, and the memo generation pipeline.

Pick this up in a Phase 2 build chat by attaching this document along with `CFC-APP-STATUS.md` v3.0, `CFC-PHASE-0-RECAP.md`, and `CFC-HOME-SCREEN-SPEC.md` v3.1.
