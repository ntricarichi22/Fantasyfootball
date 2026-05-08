# CFC Front Office — GM Office Landing Spec

**Version:** 1.0
**Date:** May 8, 2026
**Status:** Design locked — ready for mockup → code

---

## Purpose of This Document

This document captures every design decision for the **GM Office landing page** (currently `src/components/gm-office/InboxPage.tsx`, route `/trades`). It is the handoff spec for implementation. A new chat or developer should be able to read this document and execute the build without referring to prior conversation.

This document is **forward-looking**. It describes what the GM Office becomes, not what it currently is. The current implementation is being replaced.

This spec must be read alongside:
- `/docs/CFC-APP-STATUS.md` (project-wide design system and non-negotiables)
- `CFC-HOME-SCREEN-SPEC.md` (the home screen's org chart layout, which the user navigates *from* into this page)

The GM Office is one of four "doors" in the Front Office org chart. Clicking the **General Manager** box on the home screen routes here.

---

## Section 1: Concept & Metaphor

The GM Office IS the GM's actual office at the front of the building. The user is the General Manager, walking into their workspace. Everything in this room maps to a real desk:

- **Email** — the inbox of trade threads (offers from other GMs)
- **Phone** — outgoing trade actions (Make an Offer / Shop Around)
- **Twitter / Feed** — league chatter and intel (CFC Insider)
- **Nameplate** — the GM's identity and persona, sitting at the entrance/header of the office

The metaphor is the *frame*, not a literal recreation. We don't build a Gmail clone or an iPhone mockup. Each surface should *suggest* its real-world counterpart through icon, header, and visual pattern, while the underlying UI stays neobrutalist and functional.

The metaphor pays itself off as a callback to the home screen. When the **Director of Pro Personnel** briefs you on the home screen with *"Founders have been waiting two days. We owe them a response,"* you walk into the GM Office and the email is right there in your inbox.

---

## Section 2: Layout Architecture

### Desktop (≥768px)

```
┌──────────────────────────────────────────────────────────────────────┐
│  [Topbar: ← back · league logo · settings icon]                      │
├──────────────────────────────────────────────────────────────────────┤
│                          │                                            │
│  ┌────────────────────┐  │                                            │
│  │ NAMEPLATE          │  │                                            │
│  │                    │  │                                            │
│  │ NICK [LAST]        │  │                                            │
│  │ GENERAL MANAGER    │  │                                            │
│  │ [icon] Architect   │  │      MAIN CONTENT AREA                     │
│  │                    │  │                                            │
│  └────────────────────┘  │      Default: Inbox (Gmail-style rows)     │
│                          │                                            │
│  ┌────────────────────┐  │      Insider state: feed slides in as a    │
│  │ [icon] Propose     │  │       drawer from the right of this        │
│  │ [icon] Shop        │  │       content area                         │
│  │ [icon] Feed        │  │                                            │
│  └────────────────────┘  │                                            │
│                          │                                            │
│                          │                                            │
│                          │                                            │
└──────────────────────────┴────────────────────────────────────────────┘
   ← ~300px sidebar →     ← remaining width →
```

- **Left sidebar:** ~300px wide. Contains the nameplate (top, 3 rows stacked) and the three navigation items below it (icon + label).
- **Main content area:** remainder of the page width. Defaults to the inbox.
- **Topbar:** standard inner-page topbar — back arrow (left) + persistent league logo (center) + settings icon (right).

### Mobile (<768px)

Mirrors the existing **mobile draft room pattern** in `src/components/draft/mobile/`. Same architectural slots, GM-Office-specific content:

```
┌─────────────────────────────────┐
│  [hamburger][league logo][⚙]    │  ← mobile topbar (~40px, fixed)
├─────────────────────────────────┤
│  NICK [LAST] | GM | [icon] Arch │  ← nameplate (single row, sticky)
├─────────────────────────────────┤
│                                 │
│                                 │
│   MAIN SCROLLABLE CONTENT       │
│   (Inbox by default)            │
│                                 │
│                                 │
├─────────────────────────────────┤
│  [Propose] [Shop] [Feed]        │  ← bottom tab bar (icons + labels)
└─────────────────────────────────┘
```

- **Top bar:** hamburger (left, opens global nav menu) + league logo (center) + settings (right)
- **Nameplate:** full width, single row inline, sticky below the topbar
- **Main content:** scrollable, GM Office content (inbox by default)
- **Bottom tab bar:** three buttons — Propose / Shop / Feed
- **No clock bar, no ticker** — those are draft-specific. Mobile pattern's other slots stay empty here.

### Pattern alignment

The mobile architecture intentionally mirrors `MobileDraftRoom.tsx`:
- Top bar in the same slot (hamburger left, logo center, action right)
- Nameplate in the slot where the draft room places its `MobileClockBar`
- Scrollable content in the same slot as the draft board
- Bottom nav in the same slot as the draft room's tab bar

Different content, same architecture. Cohesive across the app.

---

## Section 3: The Nameplate

The nameplate is the GM's identity surface. It's persistent across all GM Office screens (inbox, insider drawer, etc.) and is the click-target for the persona switcher.

### Composition (different per platform)

**Desktop (3 rows stacked, vertical sidebar):**

```
NICK [LAST NAME]
GENERAL MANAGER
[persona icon] Architect
```

**Mobile (single row inline, top of screen):**

```
NICK [LAST NAME]  |  GENERAL MANAGER  |  [persona icon] Architect
```

The composition differs because the layouts are different:
- Desktop sidebar is narrow vertical → 3 rows stack naturally
- Mobile top is wide horizontal → 1 row inline fits

### Style

- **Background:** Paper (#FEFCF9) or Cream (#F5F0E6) — TBD at mockup, lean Paper for distinction from page background
- **Border:** 2.5px solid Ink (#1A1A1A), per design system
- **Box shadow:** 4px offset, Ink
- **Typography:**
  - Name: Syne 800–900, larger size (desktop ~22–26px, mobile ~14–16px)
  - "GENERAL MANAGER": JetBrains Mono 700, smaller size (~10–12px), uppercase, letter-spaced
  - Persona row: DM Sans 700 + persona icon inline, ~12–14px
- **Persona icon:** small, ~16–20px. From the existing persona icon library (Nick will provide mapping at build time).

### Behavior

- **Click anywhere on the nameplate** → triggers the persona switcher (see Section 4).
- **Cursor:** pointer on hover (desktop).
- **No other interactions** — it's a click target, nothing else. No long-press, no right-click menu.

---

## Section 4: Persona Switcher

When the user clicks the nameplate, the other 3 personas reveal as cards. Click one → switches the GM's base persona. Click the active nameplate or click outside → dismisses without changing.

### Personas (locked)

Four personas exist, defined in `cfc_team_strategy_profiles.gm_persona`:

| Persona | Tagline | Behavior (locked elsewhere) |
|---|---|---|
| **Closer** | *"Gets deals done"* | Accept band 0.90–1.15 |
| **Straight Shooter** | *"Wants a win-win"* | Accept band 0.90–1.10 |
| **Architect** | *"Structures outcomes"* | Accept band 0.90–1.10 + creative deal preferences |
| **Hustler** | *"Plays hardball"* | Accept band 1.00–99 (no upper cap) |

Persona icons live in the existing icon library — Nick will provide mapping at build.

### Card content (each persona card)

Each card displays:
- Persona icon (larger than the nameplate inline icon — feature-sized)
- Persona name (e.g., "Closer")
- Tagline (locked above)

That's it. No additional description. The four taglines do the work of differentiating the personas at a glance.

### Expansion behavior — different per platform

**Desktop — left-to-right slide:**

1. User clicks the nameplate.
2. The current persona stays anchored in the nameplate position.
3. The other 3 personas slide out one at a time, left-to-right cascading, *into* the main content area.
4. The main content area dims behind the cards (semi-transparent dark overlay).
5. User clicks one of the 3 alternative cards → it animates back into the nameplate position; the other cards (and the previously active one) slide back in. New persona is now active.
6. User clicks the active nameplate again, or clicks outside the cards / on the dim overlay → cards collapse back without a change.

**Mobile — downward accordion:**

1. User taps the nameplate.
2. The other 3 personas accordion *down* below the nameplate, each as a full-width row.
3. Content below dims.
4. User taps one of the rows → that persona accordions back up into the nameplate position; the others collapse. New persona active.
5. User taps the active nameplate or taps the dim overlay → accordion collapses without change.

### Implementation notes

- On mobile, we can reuse `MobileBottomSheet`-like animation principles — but the persona switcher is *not* a bottom sheet, it's a downward expansion *from the nameplate position*. The component should be its own thing.
- Animation duration: ~200–300ms per platform.
- Dim overlay: `rgba(0, 0, 0, 0.4)` (or system equivalent) on the area behind the expansion.

### What this *replaces*

There is no longer a separate "persona screen" anywhere in the app. Persona is set exclusively via this drawer. Any prior Owner's Box content related to persona is migrated here. Per-deal persona override stays in the offer card popover (already implemented in Trade Studio).

---

## Section 5: Sidebar Navigation (Desktop) / Bottom Tab Bar (Mobile)

Three navigation items, identical on both platforms:

| Label | Icon (TBD) | Behavior |
|---|---|---|
| **Propose** | TBD | Click → opens **routing popover** asking "Scout Players" or "Scout Teams." Each routes to the corresponding screen (which lives under Pro Personnel). |
| **Shop** | TBD | Click → routes to `/trade-studio` (Trade Studio — AI-curated offer slate). |
| **Feed** | TBD | Click → on **desktop**, opens the Insider drawer (slide-in from the right of the content area). On **mobile**, full-screen takeover via bottom sheet or full-screen modal. |

Icons TBD — to be designed at mockup time. Each should match the neobrutalist style (solid silhouette, no rounded glyphs) and be visually distinct from the persona icons and the home screen icons.

### Sidebar style (desktop)

- Stack of 3 buttons below the nameplate
- Each button: icon + label inline, left-aligned, with comfortable padding
- Active state: Ink fill background, Paper text/icon (when on the inbox there's no "active" — only Feed gets an active state when its drawer is open)
- Hover: subtle background shift (Paper → Cream)

### Tab bar style (mobile)

Three buttons evenly distributed, each containing icon stacked above label. Match the visual language of `MobileTabBar` in the draft room (`src/components/draft/mobile/MobileTabBar.tsx`).

---

## Section 6: Inbox (Default Content Area)

The inbox is the GM Office's primary surface — visible by default when the user enters the room.

### Treatment: Gmail-style row

Each trade thread renders as a row, not a card. The row is the at-a-glance summary:

- **Sender** — the other GM's team name (bold if Unread)
- **Subject** — a deal summary in the form *"Offer for [Asset(s)]"* or similar (e.g., "Offer for Lamb · 2 days ago")
- **Preview** — the AI quip OR the asset list, truncated, displayed inline like a Gmail preview
- **Status indicator** — small chip or text indicating state (pending / countered / closed-accepted / closed-declined / closed-withdrawn)
- **Time** — `timeAgo` format ("2h ago", "3d ago")
- **No action buttons on the row.** Accept / Decline / Counter / Withdraw all live inside the thread view, not in the inbox row.

### Click behavior

Click the row → opens the thread.

- **Desktop:** thread opens in the main content area (replacing the inbox list view). A back-to-inbox affordance lives in the topbar of the thread view.
- **Mobile:** thread opens as a new screen (route to `/trades/[threadId]`).

### Multiple offers per thread

The current implementation already handles this — one card per pending offer in open threads, one terminal card per closed thread. That logic is preserved. Each rendered row corresponds to one card (one pending offer or one terminal closed thread).

### Filter bar (above the inbox rows)

Four filters, leaning into the email metaphor:

| Filter | Maps To |
|---|---|
| **Unread** (default view) | Pending offers waiting on the user (their move) |
| **Sent** | Pending offers the user has sent (waiting on the other team) |
| **Trash** | Offers the user withdrew |
| **Archive** | Closed threads (accepted, declined, withdrawn by other team) |

### Search

- A small search **icon** sits to the right of the filter row.
- Clicking it expands an inline search input (inline animation, no modal, no full row collapse).
- Clearing or dismissing the search returns to the filter view.
- Search behavior matches the current implementation: searches counterpart team names + asset labels.

### Empty state

When a filter has no results, show a clean empty-state block in the inbox area:

- Headline: vary by filter (e.g., Unread → *"No deals on the table."* / Sent → *"Nothing pending."* / Trash → *"Trash is empty."* / Archive → *"No closed deals yet."*)
- Sub-line: short, optional context (e.g., *"Let's change that."* on Unread)
- Two CTAs (only on Unread/empty default state): **Make an Offer** → routes to Propose flow; **Shop Around** → routes to `/trade-studio`. Other empty states omit CTAs.

### Loading state

Standard ink-bordered card with `Loading…` text in JetBrains Mono. Match the existing pattern in `InboxPage.tsx`.

---

## Section 7: Insider Drawer

The Insider feed (CFC league intel) is no longer always-visible. It's accessed via the **Feed** sidebar item / tab bar button.

### Desktop — slide-in drawer from the right

- Drawer opens from the right edge of the **main content area** (not the full page — the sidebar stays visible).
- Drawer width: ~320–360px (TBD at mockup).
- Inbox compresses to fit the remaining width while the drawer is open. Content stays visible — drawer is alongside, not over.
- Background of the drawer: Ink (#1A1A1A), matching the current `InsiderPanel` style. Reuse the existing component as much as possible.
- The Feed sidebar button is in active state while the drawer is open.
- Click outside the drawer or click the Feed button again → drawer closes, inbox returns to full width.

### Mobile — full-screen takeover

- Tapping Feed in the bottom tab bar opens the Insider full-screen.
- Same `InsiderPanel` content, full viewport width and height, with a close affordance in the top-right corner.
- Closing the takeover returns to the inbox.
- On mobile, the bottom tab bar stays visible during the takeover so the user can switch quickly to Propose or Shop without dismissing.

### Content

The current `InsiderPanel` component already handles the feed rendering (item types, color-coded labels, time-ago, polling every 30s). Reuse it. The content model isn't changing — only the surface and trigger.

---

## Section 8: Propose Flow (Routing Popover)

Clicking **Propose** in the sidebar (desktop) or bottom tab bar (mobile) does **not** route to a single page. Instead, it opens a small routing popover asking the user where to start.

### Popover content

```
┌────────────────────────────────────┐
│  Where do you want to start?       │
│                                    │
│  [ Scout Players ]  [ Scout Teams ]│
└────────────────────────────────────┘
```

- Single short headline: *"Where do you want to start?"*
- Two large-tap targets: **Scout Players** and **Scout Teams**
- Optional small subtext under each (TBD at mockup, not required for V1)
- Dismissible by clicking outside / pressing Esc

### Routing destinations

Both destinations live as separate screens under the **Pro Personnel** door:

- **Scout Players** → top 10 player matches view (formerly the top half of the current Trade Builder landing)
- **Scout Teams** → best trading partners view (formerly the bottom half of the current Trade Builder landing)

Both pages exist as direct sub-routes of Pro Personnel as well — power users browsing Pro Personnel directly see both options without a popover. The popover is the GM Office shortcut into one of the two scouting modes.

### Why the popover (not direct routing)

If we routed Propose directly to a single combined page, we'd lose the room-to-breathe split. If we made Scout Players and Scout Teams two separate sidebar items, we'd lose the parallel **Propose / Shop / Feed** trio in the sidebar. The popover splits the difference: clean trio in the sidebar, deliberate moment of choice when entering scouting.

---

## Section 9: Topbar (Inner Page Pattern)

The GM Office is one level deep from the home screen. Its topbar is **different from the home screen's** by design. This pattern applies to all inner pages, not just GM Office — locking it here so future inner-page builds (Pro Personnel, Scouting, Analytics) can mirror.

### Desktop inner-page topbar

| Slot | Content | Behavior |
|---|---|---|
| Left | **← back arrow** | Returns to home (org chart) |
| Center | **CFC league logo** (persistent, also clickable) | Returns to home (org chart) |
| Right | **Settings icon** | Opens settings/account/profile menu |

The back arrow and logo both return to home (one level up = home in this case). They're partially redundant but provide consistent affordances across all inner pages.

### Mobile inner-page topbar

Mirrors the existing draft room pattern (`MobileTopBar`):

| Slot | Content | Behavior |
|---|---|---|
| Left | **Hamburger menu** | Opens global navigation drawer (Front Office home, Scouting, Pro Personnel, Analytics, settings) |
| Center | **CFC league logo** (clickable) | Returns to home (org chart) |
| Right | **Settings icon** (or contextual icon) | Settings/account access |

The hamburger replaces the back arrow on mobile because the same affordance handles all navigation. Tapping the league logo in the center is a quick-jump to home.

### Settings menu contents

Out of scope for this spec but logged for future build. At minimum: account info, league info, Sleeper integration, notification preferences, logout. Persona is **not** in settings — persona lives in the GM Office nameplate.

---

## Section 10: Items That Get Killed in This Redesign

These exist in the current `InboxPage.tsx` and are removed:

1. **"Trade Center" page title** — the room itself is the GM Office, and the topbar / nameplate already establish identity. The H1 page title is redundant.
2. **Muted team name underneath the page title** — team identity already lives in the home topbar (badges + name + logo) and isn't needed here.
3. **The yellow "CFC" text logo** in the prior topbar — replaced with the actual league logo (file already in repo).
4. **The 3-column action row** at the top of the page (Insider header label / Make an Offer / Shop Around buttons) — replaced by the sidebar nav.
5. **The always-visible 2-column body grid** (insider feed left, trade cards right) — Insider is now an opt-in drawer; the inbox uses the full main content area.
6. **The always-visible InsiderPanel sidebar column** — Insider becomes drawer-on-demand. The component itself is reused; only its placement changes.
7. **The current `FilterBar` "all / open / closed"** — replaced by the four-filter email-style set: Unread / Sent / Trash / Archive.
8. **Empty-state CTA layout (Make an offer / Shop around buttons in the empty state)** — preserved conceptually, simplified visually. Same destinations, leaner treatment.

---

## Section 11: Design Principles to Honor (from `/docs/CFC-APP-STATUS.md`)

When implementing, ensure these non-negotiables are honored:

- No rounded corners (`border-radius: 0` everywhere)
- No gradients
- 2.5px solid borders (Ink #1A1A1A) on all bordered elements
- Offset box shadows (3–4px)
- Inline styles consistent with the current `InboxPage.tsx` pattern (no new CSS framework)
- All components under 500 lines (split if needed)
- Use `window.location.href` for navigation (not `router.push`)
- Files delivered as full replacements, one commit at a time
- Copy matters — every word in this spec is locked. Do not paraphrase or "improve" copy without confirmation.

---

## Section 12: Color Palette (Excerpt from Design System)

| Name | Hex | Usage on GM Office |
|---|---|---|
| Ink | #1A1A1A | Borders, primary text, Insider drawer background |
| Paper | #FEFCF9 | Nameplate fill (TBD), inbox row background, content text on dark surfaces |
| Cream | #F5F0E6 | Page background, hover states |
| Blue | #3366CC | Sidebar item active state, primary CTAs (e.g., Make an Offer in empty state), toast background |
| Yellow | #F5C230 | AI quip badge, warning states |
| Red | #E8503A | Destructive actions (e.g., Decline button inside thread), error states |
| Muted | #8C7E6A | Secondary text, timestamps, "GENERAL MANAGER" subtitle on nameplate, filter labels when not active |

Full palette in `/docs/CFC-APP-STATUS.md`.

---

## Section 13: Typography (Excerpt from Design System)

| Font | Weight | Usage |
|---|---|---|
| Syne | 800–900 | Nameplate name, section headers, persona names |
| DM Sans | 400–700 | Inbox row content, body text, persona taglines |
| JetBrains Mono | 700 | "GENERAL MANAGER" subtitle, timestamps, status chips, filter labels |

Full system in `/docs/CFC-APP-STATUS.md`.

---

## Section 14: Files Affected

**Replace:**
- `src/components/gm-office/InboxPage.tsx` — full rewrite around new layout (sidebar + content area + nameplate)

**Likely to add (component breakdown):**
- `src/components/gm-office/GMOfficeLayout.tsx` — top-level orchestrator (topbar + sidebar + content area + drawer mount)
- `src/components/gm-office/Nameplate.tsx` — desktop and mobile variants (could be a single component with platform branching)
- `src/components/gm-office/PersonaDrawer.tsx` — the persona switcher (handles both desktop slide and mobile accordion)
- `src/components/gm-office/PersonaCard.tsx` — single persona card used inside the drawer
- `src/components/gm-office/SidebarNav.tsx` — desktop sidebar (Propose / Shop / Feed)
- `src/components/gm-office/MobileTabBar.tsx` — mobile bottom tab bar (or extend the existing one)
- `src/components/gm-office/InboxRow.tsx` — Gmail-style row replacing the current `TradeCard` for the inbox view (TradeCard may still be used inside the thread view; clarify at build)
- `src/components/gm-office/FilterChips.tsx` — Unread / Sent / Trash / Archive
- `src/components/gm-office/SearchToggle.tsx` — search icon + inline expansion
- `src/components/gm-office/InsiderDrawer.tsx` — wraps the existing `InsiderPanel` with desktop slide-in / mobile full-screen behavior
- `src/components/gm-office/ProposePopover.tsx` — the routing modal asking Scout Players vs. Scout Teams
- `src/components/gm-office/InnerTopbar.tsx` — shared inner-page topbar (back arrow / logo / settings on desktop; hamburger / logo / settings on mobile). This is reusable — Pro Personnel, Scouting, Analytics will use the same component.

**Reuse:**
- `src/components/gm-office/InsiderPanel.tsx` — kept as-is for content rendering; only the wrapper/placement changes
- The existing `TradeCard` may still appear inside the thread view (post-click); confirm at build whether it's reused or refactored
- Modals: `AcceptModal`, `RejectModal`, `CounterDrawer`, `ChatBubble` — used in the thread page, not the inbox; unaffected by this redesign

**May need data wiring:**
- User's persona (`gm_persona` from `cfc_team_strategy_profiles`) — already wired, surface in the nameplate
- Persona icon mapping — Nick will provide at build
- Thread filtering by Unread / Sent / Trash / Archive — derived from existing thread + offer state; mapping in Section 6
- League logo URL — file already in repo per Nick

---

## Section 15: Build Order Recommendation

Suggested sequence to ship cleanly without broken intermediate states. Each step should produce a buildable commit (Nick uses GitHub web editor, one file at a time).

1. **`InnerTopbar.tsx`** — shared inner-page topbar. Standalone component used across multiple pages later. First commit.
2. **`Nameplate.tsx`** — standalone, takes user name + persona props. Stub data initially; wire to `cfc_team_strategy_profiles` once basic render is verified.
3. **`PersonaCard.tsx`** — single card showing icon + name + tagline. Used inside the drawer.
4. **`PersonaDrawer.tsx`** — composes 3 PersonaCards for the alternates. Animated expansion logic. Mount inside the eventual layout.
5. **`SidebarNav.tsx`** — desktop sidebar with Propose / Shop / Feed buttons (icons stubbed, real icons inserted at design time).
6. **`MobileTabBar.tsx`** — mobile bottom nav with the same 3 items. Either new component or extension of the draft room's tab bar.
7. **`FilterChips.tsx` + `SearchToggle.tsx`** — inbox filter row.
8. **`InboxRow.tsx`** — Gmail-style row. Replace the `TradeCard` rendering in the inbox view (TradeCard usage inside the thread page is a separate concern).
9. **`ProposePopover.tsx`** — small modal with the two routing buttons.
10. **`InsiderDrawer.tsx`** — wraps `InsiderPanel` with desktop slide-in / mobile full-screen behavior.
11. **`GMOfficeLayout.tsx`** — top-level page composing all of the above. Replaces `InboxPage.tsx`.
12. **Wire Insider drawer trigger** to the Feed nav button.
13. **Wire Propose popover** to the Propose nav button. Routes to Scout Players or Scout Teams (which live under Pro Personnel — those screens are a separate build).
14. **Polish:** dim overlay during persona switcher expansion, focus management, keyboard nav (Esc to dismiss popovers/drawers), accessibility passes.

Note: the **Scout Players** and **Scout Teams** screens themselves are Pro Personnel work, not GM Office. The Propose popover routes to them but doesn't need them to exist for the popover itself to ship — initially the buttons can route to placeholder pages.

---

## Section 16: Open Items / Deferred Decisions

These are NOT blockers for the GM Office build. They are flagged for later work:

1. **Inbox row visual specifics** — the Gmail-style row treatment is locked conceptually but exact layout (avatar? color treatment? status chip placement?) lands at mockup.
2. **Persona icon mapping to specific personas** — Nick provides at build (Architect = chess knight per earlier conversation; others TBD).
3. **Sidebar icon designs for Propose / Shop / Feed** — TBD at mockup. Each should be visually distinct from home screen and persona icons.
4. **Settings menu contents** — out of scope for this spec; logged for future.
5. **Cross-box deeplinking from home screen briefings** — when the Director of Pro Personnel briefs *"Founders have been waiting two days,"* clicking that briefing should ideally deeplink to the actual thread inside this GM Office. Deferred.
6. **Empty-state copy for filter views** — Section 6 has working drafts; final copy locked at content-pass time.
7. **Thread page redesign** — clicking an inbox row opens a thread. The thread page (`ThreadPage.tsx`) has its own design and isn't part of this spec. Will be its own design pass. Inner-page topbar component built here is reused.
8. **Animations and motion specifics** — durations, easing curves, dim overlay opacity. TBD at mockup.
9. **Onboarding / empty-data states** — first-time GM with zero threads, no insider items, default persona. Default fallbacks needed at build.

---

## Section 17: Behavioral Notes

- **Default landing:** Inbox with the Unread filter active.
- **Logo click on topbar:** always returns to home (org chart).
- **Back arrow click (desktop):** returns to home (org chart). Same destination as logo on this page.
- **Hamburger menu (mobile):** opens global nav with all four doors + settings.
- **Persona drawer dismissal:** click outside, click active nameplate, or press Esc.
- **Insider drawer dismissal:** click Feed button again, click outside drawer (desktop), or close button (mobile).
- **Propose popover dismissal:** click outside or press Esc. No keyboard shortcut to choose Scout Players vs. Scout Teams (mouse/tap selection).
- **Thread row click:** opens thread in main content area (desktop) or routes to thread page (mobile).
- **Toast:** existing toast pattern preserved (top-center, 3s auto-dismiss). Used for Accept/Decline/Withdraw confirmations from inside thread view.

---

## Section 18: Summary — At-a-Glance

| Element | Decision |
|---|---|
| **Layout (desktop)** | Topbar + left sidebar (~300px, nameplate + 3 nav items) + main content area |
| **Layout (mobile)** | Topbar + sticky nameplate + scrollable content + bottom tab bar (mirrors draft room mobile pattern) |
| **Nameplate (desktop)** | 3 rows: Name / GENERAL MANAGER / [icon] Persona |
| **Nameplate (mobile)** | 1 row inline: Name | GM | [icon] Persona |
| **Persona drawer (desktop)** | Left-to-right cascade from sidebar into content area, dim background |
| **Persona drawer (mobile)** | Downward accordion below nameplate, dim content |
| **Persona taglines** | Closer: *"Gets deals done"* · Straight Shooter: *"Wants a win-win"* · Architect: *"Structures outcomes"* · Hustler: *"Plays hardball"* |
| **Sidebar / tab bar items** | Propose · Shop · Feed |
| **Propose behavior** | Opens popover: "Where do you want to start? Scout Players / Scout Teams" → routes to Pro Personnel screens |
| **Shop behavior** | Routes to `/trade-studio` |
| **Feed behavior** | Desktop: drawer slides in from right. Mobile: full-screen takeover |
| **Default content** | Inbox |
| **Inbox treatment** | Gmail-style rows (sender, subject, preview, status, time) — no inline action buttons |
| **Filter bar** | Unread (default) / Sent / Trash / Archive |
| **Search** | Icon that expands inline |
| **Topbar (inner page)** | Desktop: ← back / logo / settings. Mobile: hamburger / logo / settings |
| **Killed elements** | Page title "Trade Center" / muted team name / yellow CFC text / 3-column action row / always-visible InsiderPanel column / old filter bar |

---

## Section 19: Composition Inside the Inbox Row (Detail)

For clarity, the inbox row, top to bottom (single row layout):

**Active row (Unread or Sent):**
1. Status indicator (small dot or chip on the far left — bold/colored if Unread)
2. Sender team name (medium weight, ~14px, fills ~25% of row width)
3. Subject + preview (truncated, fills the middle ~50% of width)
4. Timestamp (right-aligned, monospace, muted)
5. Click target = entire row

**Closed row (Trash or Archive):**
- Same composition, with reduced opacity (~0.6) and a state label in the timestamp area instead of (or alongside) the timeAgo (e.g., *"Accepted · 2d ago"*)

The AI quip from the current implementation can render as the *preview* portion. If no quip exists, fall back to a brief asset list ("Lamb for Daniels + 2026 1st").

---

## End of Spec — Ready for Build

The GM Office landing design is fully locked. The only items intentionally deferred are visual mockup details (exact icon designs, animation timing, empty-state copy variants) and adjacent build work (Scout Players / Scout Teams pages, thread page redesign, settings menu contents) — all logged in Section 16.

Pick this up in a new chat by attaching this document along with `/docs/CFC-APP-STATUS.md` and `CFC-HOME-SCREEN-SPEC.md`. The new chat should not need any conversation history beyond these three files to execute the build cleanly.
