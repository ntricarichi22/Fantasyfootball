# CFC Front Office — GM Office Landing Spec

**Version:** 3.0
**Date:** May 14, 2026
**Status:** Design locked — ready for mockup → code

> **Revision note (v3.0):** Major redesign. The GM Office is now exclusively the **Gmail-style inbox**. Sidebar killed (no Propose / Shop / Feed). Persona switcher relocated or killed (TBD — see Section 6). The inbox interleaves director memos and trade correspondence in a single list. Four filter chips (Unread / Sent / Trash / Archive). Row-based layout (sender / subject / preview / timestamp). Click a row → body opens. Insider feed survives as a separate drawer (carried forward from v2.x). The home screen handles all navigation; the GM Office is one focused surface.

---

## Purpose of This Document

This document captures every design decision for the **GM Office** — which in v3.0 is exclusively the inbox. The route is `/gm-office` or `/inbox` (TBD at build).

This spec must be read alongside:
- `/docs/CFC-APP-STATUS.md` v3.0 (project-wide non-negotiables)
- `CFC-HOME-SCREEN-SPEC.md` v3.0 (the home screen routes here from the GM box)

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

## Section 6: Persona Switcher — Decision Deferred

V2.x located the persona switcher in the GM Office nameplate. With the nameplate gone (no sidebar, no nameplate header), the persona switcher needs a new home.

Options:
1. **Move to Settings.** Persona is a user setting; settings menu in the topbar can house it. Cleanest from a UX standpoint.
2. **Move to a profile / account view** reached via the team logo click in the topbar.
3. **Inline in the inbox empty state** (when there are no unread messages, show a small persona preview + change link). Probably too obscure.

**My recommendation: Option 1.** Settle at build time.

The per-deal persona override popover inside Trade Studio's OfferCard is unaffected — that's a per-trade adjustment, not a persona setting change.

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
Inherits from the current `ThreadPage.tsx` implementation. Shows:
- The chain of offers (original + counters)
- Each offer card with send/receive, balance chip, AI advisor prose
- Inline actions (Accept / Decline / Counter / Withdraw) on the latest open offer
- ChatBubble messages between the two GMs (if any)

Largely unchanged in v3.0 — this is the existing thread page. Will get its own design pass later (already flagged as out of scope in v2.x).

### Director Memo Body
New for v3.0. Shows:
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

## Section 9: Killed in v3.0

These existed in v1.x / v2.x and are removed:

1. **GM Office sidebar** (Propose / Shop / Feed nav items). The whole sidebar is gone.
2. **Nameplate** in the sidebar. No sidebar means no nameplate.
3. **Persona switcher in the nameplate.** Relocated (see Section 6).
4. **Propose popover** ("Scout Players or Scout Teams"). Long dead — Propose routes from home screen go directly to workrooms.
5. **Persona cascade drawer** (the desktop slide / mobile accordion to switch persona). Persona switching moves to Settings.
6. **The old `FilterBar` "all / open / closed"** — replaced by Unread / Sent / Trash / Archive (already changed in v2.x).
7. **Empty-state CTAs (Make an offer / Shop around buttons).** Home screen handles next-step navigation.
8. **Page title "Trade Center."** No more page title — the inbox is the screen.
9. **Insider Drawer trigger from Feed nav button.** See Section 10 for Insider Feed's current state.

---

## Section 10: CFC Insider Feed

Carried forward from v2.x with one change: **the trigger moves.** Without a Feed nav button (sidebar is dead), the Insider feed needs a new entry point.

Options:
1. **Small icon in the topbar.** Right side, next to settings. Click → drawer opens.
2. **Persistent at the bottom of the inbox.** A small "View CFC Insider" affordance at the bottom of the row list.
3. **Roll Insider content into the inbox.** Each completed league trade becomes a memo from a director ("Founders sent Lamb to Outlaws for 1.04 and a 2nd"). Kills the separate feed entirely.

**My recommendation: Option 3.** It's the cleanest model — everything that happens in the league surfaces in the inbox, full stop. The "feed" concept is redundant with the inbox if the inbox is broad enough. Settle at build time.

If Option 3 is chosen, the Insider drawer component is killed.

---

## Section 11: Inner Page Topbar

Inherits from the inner-page pattern (applies to all surfaces one level below home).

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

### Retire / replace
- `src/components/gm-office/InboxPage.tsx` — full rewrite around new layout
- `src/components/gm-office/GMOfficeLayout.tsx` — kill (no longer needs sidebar orchestration)
- `src/components/gm-office/Nameplate.tsx` — kill
- `src/components/gm-office/PersonaDrawer.tsx` — kill (move to Settings)
- `src/components/gm-office/PersonaCard.tsx` — kill (move to Settings)
- `src/components/gm-office/SidebarNav.tsx` — kill
- `src/components/gm-office/MobileTabBar.tsx` — kill (no bottom tab bar)
- `src/components/gm-office/ProposePopover.tsx` — already killed; confirm removed
- `src/components/gm-office/InsiderDrawer.tsx` — kill if Option 3 in Section 10 is chosen

### New (v3.0)
- `src/components/gm-office/InboxView.tsx` — top-level inbox screen
- `src/components/gm-office/InboxRow.tsx` — Gmail-style row component
- `src/components/gm-office/FilterChips.tsx` — Unread / Sent / Trash / Archive
- `src/components/gm-office/SearchToggle.tsx` — search icon + inline expansion
- `src/components/gm-office/MessageBody.tsx` — message body container, routes between trade body and memo body
- `src/components/gm-office/DirectorMemoBody.tsx` — memo body rendering (subject + director voice + inline actions)
- `src/components/gm-office/InnerTopbar.tsx` — shared inner-page topbar (reusable across PP, R&S, Scouting too)

### Reuse
- `src/components/gm-office/InsiderPanel.tsx` — survives if Option 1 or 2 in Section 10 is chosen; killed if Option 3
- Trade thread / ChatBubble / Accept/Reject/Counter modals — preserved for trade body rendering inside `MessageBody`

### Data wiring
- Inbox query that interleaves trade threads + director memos sorted by date
- Director memo schema (sender, subject, body, status, inline actions)
- New endpoint for marking memos read / archived / trashed

---

## Section 13: Build Order Recommendation

1. **`InnerTopbar.tsx`** — shared component. First commit.
2. **`FilterChips.tsx`** — standalone, takes filter list + active prop.
3. **`SearchToggle.tsx`** — standalone search icon + inline input.
4. **`InboxRow.tsx`** — Gmail-style row. Takes a unified message prop (trade or memo type).
5. **Director memo schema + API** — backend work to create/query director memos.
6. **`DirectorMemoBody.tsx`** — memo body rendering with inline actions.
7. **`MessageBody.tsx`** — orchestrator that routes to trade body or memo body based on message type.
8. **`InboxView.tsx`** — top-level page composing topbar + filter chips + search + row list + message body.
9. **Wire data** — interleaved inbox query, read/archive/trash mutations.
10. **Mobile responsive polish.**

---

## Section 14: Open Items / Deferred Decisions

NOT blockers:

1. **Persona switcher location.** Lean Option 1 (Settings) — confirm at build.
2. **CFC Insider Feed disposition.** Lean Option 3 (roll into inbox) — confirm at build.
3. **Director glyph designs.** Per-director visual accent. Defer to mockup.
4. **Empty state copy.** Final copy variants — settle at content-pass time.
5. **Memo dismissal mechanic.** Can the user "delete" a memo from the inbox? Defer.
6. **Cross-surface deeplinking.** Memo body's inline actions need stable route targets — confirm route map at build.
7. **Director memo generation pipeline.** Who generates memos, on what cadence, with what triggers — defer to build (separate workstream).
8. **Settings menu contents.** Defer.
9. **Onboarding states.** Empty inbox for a brand new user — defer.

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
| **Layout** | Single-surface inbox — no sidebar, no nameplate, no nav within the office |
| **Inbox structure** | Gmail-style rows, interleaved trade correspondence + director memos by date |
| **Row anatomy** | Status indicator · sender · subject · preview · timestamp |
| **Filter chips** | Unread (default) / Sent / Trash / Archive |
| **Search** | Inline expand icon |
| **Message body** | Trade body (existing thread page) OR Director memo body (subject + voice + inline actions) |
| **Insider feed** | Likely rolled into inbox as memos from directors (Option 3 — confirm at build) |
| **Persona switcher** | Relocated to Settings (Option 1 — confirm at build) |
| **Sidebar** | KILLED |
| **Nameplate** | KILLED |
| **Persona cascade drawer** | KILLED |
| **Empty state CTAs** | KILLED (home screen handles next-step navigation) |
| **Topbar (desktop)** | ← back / league logo / settings |
| **Topbar (mobile)** | hamburger / league logo / settings |

---

## End of Spec — Ready for Build

The GM Office v3.0 design is fully locked. Items intentionally deferred are minor UX choices (persona switcher home, Insider feed disposition, director glyphs, memo generation pipeline).

Pick this up in a build chat by attaching this document along with `/docs/CFC-APP-STATUS.md` v3.0 and `CFC-HOME-SCREEN-SPEC.md` v3.0.
