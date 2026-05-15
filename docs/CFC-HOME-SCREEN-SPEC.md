# CFC Front Office — Home Screen Design Spec

**Version:** 3.0
**Date:** May 14, 2026
**Status:** Design locked — ready for mockup → code

> **Revision note (v3.0):** Major redesign. Director briefings on the home screen are killed. Each director box becomes a clean menu of deep links into that director's workrooms plus an entry into the director's office (chat). The GM box previews inbox unread count and clicks into the inbox. Urgency tier system killed (no green/yellow/red chips). The home screen is now a clean command center, not a briefing surface. v3.0 carries forward the org chart layout from v2.1 with the four-box structure (GM + 3 directors).

---

## Section 1: Concept & Metaphor

The home screen IS the **organization chart of an NFL front office**. The user is the General Manager. The app is the building they manage. Each "door" is a department in their org reporting up to them.

Four boxes:

1. **General Manager** (the user, top of the chart, full-width) — clicks into the inbox
2. **Director of Scouting** — owns the draft
3. **Director of Pro Personnel** — owns trades
4. **Director of Research & Strategy** — owns settings + roster strategy

Each director box is a **menu** of deep links into that director's workrooms PLUS an entry point to walk into the director's office for a chat. No briefings on the home screen. No urgency tier chips. No real-time computed previews. The home screen is a clean command center — fast, scannable, predictable.

"What's new" lives in the inbox (the GM box's job). The home screen is the menu of *where you can go to do things*, not *what's happening right now*.

---

## Section 2: Layout Architecture

### Desktop (≥768px)

```
┌─────────────────────────────────────────────────────────────┐
│  [Topbar: CFC logo · · · badges + team name + team logo]    │
├─────────────────────────────────────────────────────────────┤
│                                                              │
│  Cleveland Football Club · 7 Years Running                   │
│                                                              │
│  FRONT OFFICE                                                │
│                                                              │
├─────────────────────────────────────────────────────────────┤
│                                                              │
│  ┌────────────────────────────────────────────────────────┐ │
│  │ [icon]  NICK TRICARICHI, GENERAL MANAGER                │ │
│  │                                                          │ │
│  │ Enter your office. 6 unread on your desk.               │ │
│  └─────────────────────┬──────────────────────────────────┘ │
│                        │                                     │
│       ┌────────────────┼──────────────────┐                  │
│       │                │                  │                  │
│  ┌────┴─────────┐ ┌────┴─────────┐ ┌─────┴────────────┐     │
│  │ DIRECTOR OF  │ │ DIRECTOR OF  │ │ DIRECTOR OF      │     │
│  │ SCOUTING     │ │ PRO PERSONNEL│ │ RESEARCH &       │     │
│  │              │ │              │ │ STRATEGY         │     │
│  │ [brief role  │ │ [brief role  │ │ [brief role      │     │
│  │  description]│ │  description]│ │  description]    │     │
│  ├──────────────┤ ├──────────────┤ ├──────────────────┤     │
│  │ → Office     │ │ → Office     │ │ → Office         │     │
│  │ → Big Board  │ │ → Build Trade│ │ → Set Strategy   │     │
│  │ → Draft Room │ │ → Shop Guys  │ │ → Set Avail.     │     │
│  │ → Mock Draft │ │              │ │                  │     │
│  └──────────────┘ └──────────────┘ └──────────────────┘     │
└─────────────────────────────────────────────────────────────┘
```

- GM box: full-width of the content area. Houses name + tagline + inbox unread count.
- Three director boxes: equal width (1/3 each minus gutters). Each box houses title + brief role description + action menu.
- Connecting line: starts from bottom-center of GM box, branches into 3 paths, each path becomes the border of its director box (continuous flow — see Section 9).

### Mobile (<768px)

```
┌─────────────────────────────────┐
│  [Topbar]                       │
├─────────────────────────────────┤
│  Cleveland Football Club ·      │
│  7 Years Running                │
│                                 │
│  FRONT OFFICE                   │
├─────────────────────────────────┤
│  ┌───────────────────────────┐  │
│  │ [icon]  NICK, GENERAL     │  │
│  │         MANAGER           │  │
│  │ Enter your office.        │  │
│  │ 6 unread on your desk.    │  │
│  └─────────────┬─────────────┘  │
│                │                │
│  ┌─────────────┴─────────────┐  │
│  │ DIRECTOR OF SCOUTING      │  │
│  │ [role description]        │  │
│  ├───────────────────────────┤  │
│  │ → Office                  │  │
│  │ → Big Board               │  │
│  │ → Draft Room              │  │
│  │ → Mock Draft              │  │
│  └───────────────────────────┘  │
│                                 │
│           • • •                 │  ← dots, swipe to next
│                                 │
└─────────────────────────────────┘
```

- GM box and active director box stacked vertically, equal width.
- Director box swipeable left/right to cycle through Scouting → Pro Personnel → R&S.
- Pagination dots below the director box.
- Peek of next card killed. Dots only.
- Connecting line stays anchored to the GM box; director card slides under the line's landing point.

---

## Section 3: The GM Box (Top)

### Composition
| Property | Value |
|---|---|
| Title | `[YOUR NAME], GENERAL MANAGER` (uppercase, dynamic from user data) |
| Icon | Rotary phone (or TBD at mockup) |
| Tagline | `Enter your office.` (TBD at copy time) |
| Inbox preview | `N unread on your desk.` where N = unread message count from inbox |
| Background | Blue (#3366CC) |
| Text color | White / Paper (#FEFCF9) |
| Border | 2.5px solid Ink (#1A1A1A) |
| Box shadow | 4px offset, Ink |
| Click target | Entire box → routes to inbox (`/gm-office` or equivalent) |

### Behavior
- Single click target. The whole box is the inbox entry.
- The unread count is the only piece of state on the home screen. It updates when inbox data changes.
- When unread is 0, the tagline simplifies to something like *"All caught up."* (TBD at copy time).

---

## Section 4: Director Boxes (Three, Equal Width)

Each director box has the same structure:

### Composition
| Element | Description |
|---|---|
| **Title** | `DIRECTOR OF [SCOUTING / PRO PERSONNEL / RESEARCH & STRATEGY]` in nameplate chrome at the top |
| **Brief role description** | One-line description of what this director handles. Examples: *"Owns the draft."* / *"Hunts and lands trades."* / *"Sets strategy and roster valuations."* (TBD at copy time) |
| **Action menu** | Stacked list of deep links into that director's surfaces, with the office entry first |
| **Background** | Paper (#FEFCF9) |
| **Text color** | Ink (#1A1A1A) |
| **Border** | Blue (#3366CC), 2.5px solid (continuation of connecting line from GM box) |
| **Box shadow** | 4px offset, Ink |

### Action Menus (Locked)

**Director of Scouting:**
- → Office (enter the director's office — chat-driven)
- → Big Board
- → Draft Room
- → Mock Draft

**Director of Pro Personnel:**
- → Office
- → Build a Trade
- → Shop My Guys

**Director of Research & Strategy:**
- → Office
- → Set Strategy
- → Set Availability

### Behavior
- Each action line is a click target. Direct deep link to that surface — no popovers, no intermediate menus.
- The "Office" line is visually distinct (slight differential styling — exact treatment TBD at mockup) to signal "talk to this person" vs. "do this task."
- Action lines use a directional arrow prefix (→) or similar visual affordance to indicate they navigate somewhere.
- Hovering an action line (desktop) shows a subtle hover state. No tooltips needed — labels are explicit.

---

## Section 5: Hero Section (Above the Org Chart)

**Subhead** (small, muted, uppercase, letterspaced):
```
Cleveland Football Club · 7 Years Running
```

**Display headline** (very large, bold, uppercase):
```
FRONT OFFICE
```

Below the hero, a 3px solid Ink horizontal rule.

Typography:
- Subhead: JetBrains Mono, 9px, letter-spacing 3, color `#8C7E6A`
- Headline: Syne, 900 weight, `clamp(36px, 4.5vw, 66px)`, letter-spacing -2, uppercase

Same as v2.x.

---

## Section 6: Section Header

Killed. The v2.1 "On your desk" header below the hero is removed in v3.0 — without briefings on the home screen, there's nothing to introduce. The org chart sits directly below the hero divider.

---

## Section 7: Killed in v3.0

The following from v2.x are dead:

1. **Director briefings on the home screen.** No more director's-voice quote on the home screen.
2. **Urgency tier system.** No green/yellow/red chips on director boxes.
3. **Contextual action buttons inside the director box body.** Replaced by the action menu list.
4. **"One thing at a time" Pattern A.** No more single-most-critical-item preview.
5. **"On your desk" section header.** Removed (Section 6 above).
6. **All real-time computed previews.** Home screen is static state-of-the-app (unread count is the one exception).
7. **Briefing content engine deferred items.** All of Section 6.6 in v2.1 is moot.
8. **Cross-box deeplinking from home screen briefings.** No briefings = no deeplink concern.

---

## Section 8: Topbar (Home Screen)

The home screen's topbar is intentionally distinct from inner pages.

### Composition

**Left side:**
- CFC league logo

**Right side, inline left-to-right:**
- Persona icon (chess knight for Architect, etc.)
- Championship rings (single ring + multiplier if >1)
- Team name
- Team logo (clickable → opens settings/profile page)

**No notification dot.** Unread state lives on the GM box. The topbar stays clean.

### Layout
Inline for both desktop and mobile. On narrow viewports the badges + name + logo cluster may compress; prioritize keeping the team logo visible and let the name truncate.

### Persona Icons
Persona icon library already exists. Nick provides file paths and mapping at build time. Supports: **Straight Shooter, Closer, Hustler, Architect**.

### Championship Rings
Single ring icon. Multiplier appended for >1 (e.g., `🏆 x2`). Data source TBD. Render 0 / no icon until data exists.

### Badges in Other Contexts (DEFERRED)
Same badges should appear next to other teams' names on trade threads, inbox cards, Trade Studio offer cards, etc. Build badge components reusable. Other surfaces inherit when built.

---

## Section 9: Connecting Lines (Org Chart)

### Desktop
- Single line from bottom-center of GM box drops down ~20-30px.
- Branches into 3 paths, each going horizontally then vertically down to the top of one director box.
- Each branch's terminus continues into the director box border (continuous stroke).
- Line color: Blue (#3366CC).
- Line weight: 2.5px (matches box borders).
- Implementation: SVG with paths.

### Mobile
- Single vertical line from bottom-center of GM card to top-center of director card.
- Same color and weight as desktop.
- Line is rendered between cards in the swipe area — does NOT swipe with the director card.

---

## Section 10: Behavioral Notes

- **GM box click:** routes to inbox.
- **Director box action line click:** direct deep link to that surface. No intermediate steps.
- **CFC league logo click (left of topbar):** inert (you're already home) or opens a "league info" overlay (defer; inert is fine for V1).
- **Team logo click (right of topbar):** opens settings/profile page.
- **Mobile swipe:** director card swipes left/right to cycle through Scouting → Pro Personnel → R&S. Wraps around.
- **Empty/onboarding states:** first-time GM, default fallbacks. Handle at build time. Default unread count = 0.

---

## Section 11: Files Affected

**Replace:**
- `src/components/HomeScreen.tsx` (full rewrite around new menu-driven layout)

**Likely to add (component breakdown):**
- `src/components/home/HomeTopbar.tsx` — topbar with league logo + badges
- `src/components/home/PersonaBadge.tsx` — reusable persona icon
- `src/components/home/ChampionshipBadge.tsx` — reusable ring + multiplier
- `src/components/home/GMBox.tsx` — top box (full-width, blue, inbox preview)
- `src/components/home/DirectorBox.tsx` — reusable director box (title + role description + action menu)
- `src/components/home/ActionMenu.tsx` — reusable action menu component (used inside each director box)
- `src/components/home/OrgChartLines.tsx` — SVG connecting lines
- `src/components/home/SwipeableDirectors.tsx` — mobile swipe container

**Killed:**
- `DirectorBriefing.tsx` (briefings on home screen are dead)
- `DirectorNameplate.tsx` (replaced by box header; nameplate chrome concept dies)
- `UrgencyChip.tsx` (no urgency on home screen)

**May need data wiring:**
- User's team name + team logo URL
- User's persona (from `cfc_team_strategy_profiles.gm_persona`)
- Championship count (data source TBD; default to 0 if not modeled)
- Inbox unread count (new query against inbox/threads)

---

## Section 12: Build Order Recommendation

1. **`HomeTopbar.tsx`** — topbar with badges. Stub data.
2. **`PersonaBadge.tsx`** — standalone, takes persona prop.
3. **`ChampionshipBadge.tsx`** — standalone, takes count prop.
4. **`ActionMenu.tsx`** — standalone, takes action list prop.
5. **`GMBox.tsx`** — composes user name + tagline + inbox unread count. Stub the unread count initially.
6. **`DirectorBox.tsx`** — composes title + role description + ActionMenu. Takes director type prop.
7. **`OrgChartLines.tsx`** — SVG connecting lines.
8. **`HomeScreen.tsx`** desktop layout — composes topbar + hero + GM box + lines + 3 director boxes.
9. **`SwipeableDirectors.tsx`** — mobile swipe wrapper.
10. **Mobile layout in `HomeScreen.tsx`** — swap director column for swipeable component on small screens.
11. **Wire inbox unread count** — query against inbox.
12. **Wire badges to real data** — persona from strategy profile, championship count.

---

## Section 13: Open Items / Deferred Decisions

These are NOT blockers:

1. **Exact tagline copy** for GM box. Settle at copy time.
2. **Exact role description copy** for each director box. Settle at copy time.
3. **Action line visual treatment.** Differential styling of "Office" vs. workroom links — settle at mockup.
4. **Persona icon mapping.** Provided at build time.
5. **Championship data source.** Defer; default to 0 until wired.
6. **Inbox unread count behavior at 0.** Tagline variant — defer to copy time.
7. **Onboarding states.** First-time GM defaults — handle at build.
8. **Animation / transitions.** Desktop hover effects, mobile swipe physics. Defer to mockup.

---

## Section 14: Summary — At-a-Glance

| Element | Decision |
|---|---|
| **Layout** | Org chart: GM full-width on top, 3 directors below |
| **GM box** | Blue fill, white text, name + tagline + inbox unread count. Click → inbox |
| **Director box** | Paper fill, ink text, blue border, title + brief role description + action menu (deep links) |
| **Director box action menus** | Scouting: Office / Big Board / Draft Room / Mock Draft · PP: Office / Build a Trade / Shop My Guys · R&S: Office / Set Strategy / Set Availability |
| **Office entry** | First action line in each director box. Visually distinct from workroom links (TBD at mockup) |
| **Connecting lines** | Blue (#3366CC), 2.5px, continuous flow into director borders |
| **Hero** | *Cleveland Football Club · 7 Years Running* / *FRONT OFFICE* |
| **Topbar (left)** | CFC league logo |
| **Topbar (right)** | Persona icon + championship rings + team name + team logo |
| **Mobile** | Two-card stack (GM + active director), swipeable directors, dots only |
| **Briefings** | KILLED |
| **Urgency tiers** | KILLED |
| **Section header** | KILLED |
| **Notification dot** | None (unread count lives on GM box) |

---

## End of Spec — Ready for Build

The home screen v3.0 design is fully locked. Items intentionally deferred are copy variants, persona icon mappings, and animation tuning. All locked items are buildable today.

Pick this up in a build chat by attaching this document along with `/docs/CFC-APP-STATUS.md` v3.0.
