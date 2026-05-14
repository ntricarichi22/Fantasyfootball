# CFC Front Office — Home Screen Design Spec

**Version:** 2.1 (revised)
**Date:** May 13, 2026
**Status:** Design locked — ready for mockup → code

> **Revision note (v2.1, May 13, 2026):** Updates from the May 12, 2026 master design session. Three-tier urgency system applies universally to all three director doors (the prior "R&S never urgent" rule is killed). Green chip is always rendered (no more "absence = default"). Universal green color shifts to #019942. Door display pattern formalized: title moves to nameplate chrome, body shows a single most-critical item in real director voice with a contextual action button. v2.0 changes (Research & Strategy replacing Analytics) carry forward.

---

## Purpose of This Document

This document captures every design decision for the CFC Front Office home screen ("Welcome Screen"). It is the handoff spec for implementation. A new chat or developer should be able to read this document and execute the build without referring to prior conversation.

This document is **forward-looking**. It describes what the home screen *becomes*, not what it currently is. The current implementation in `src/components/HomeScreen.tsx` is being replaced.

This spec must be read alongside `/docs/CFC-APP-STATUS.md` (project-wide design system and non-negotiables). Excerpts of the design system are reproduced here for convenience but the source of truth is that file.

---

## Section 1: Concept & Metaphor

The home screen IS the **organization chart of an NFL front office**. The user is the **General Manager**. The app is the building they manage. Each "door" they enter is a **department** in their org reporting up to them.

The four boxes represent:

1. **General Manager** (the user, top of the chart, full-width)
2. **Director of Scouting** (reports to GM, runs the draft)
3. **Director of Pro Personnel** (reports to GM, scouts other teams' rosters and trade targets)
4. **Director of Research & Strategy** (reports to GM, owns roster strategy, player evaluation, and the data/research function that informs them)

This metaphor governs everything: copy voice, layout, the connecting lines, the briefings the directors give to the GM, the topbar treatment. **Every implementation choice should reinforce that the user is a GM walking into their front office and being briefed by their directors.**

The product is called "CFC Front Office." The home screen is the front office, made literal. The org structure is loosely modeled on the Cleveland Browns' analytics-forward front office — most notably their VP, Research & Strategy role, which inspired our third director.

**Each director has a distinct lens:**

| Director | Lens |
|---|---|
| Scouting | Looking forward (the future via the draft) |
| Pro Personnel | Looking outward (other teams' rosters and trade activity) |
| Research & Strategy | Looking inward (our team, our preferences, our data-informed plan) |

Three lenses, no overlap.

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
│  ───── On your desk ─────────────────────────────────────    │
├─────────────────────────────────────────────────────────────┤
│                                                              │
│  ┌──────────────────────────────────────────────────────┐    │
│  │ [icon]  [YOUR NAME], GENERAL MANAGER                 │    │
│  │                                                       │    │
│  │ Get plugged in, work the phones, and make deals.     │    │
│  └──────────────────────┬───────────────────────────────┘    │
│                         │                                    │
│        ┌────────────────┼────────────────┐                   │
│        │                │                │                   │
│  ┌─────┴─────────┐ ┌────┴────────┐ ┌────┴──────────┐         │
│  │ DIRECTOR OF   │ │ DIRECTOR OF │ │ DIRECTOR OF   │         │
│  │ SCOUTING   ●  │ │ PRO PERS. ● │ │ RES. & STR. ● │  ← nameplate chrome
│  │               │ │             │ │               │     (title + chip)
│  ├───────────────┤ ├─────────────┤ ├───────────────┤         │
│  │ "Boss, we're  │ │ "Founders   │ │ "Strategy's   │         │
│  │  on the clock.│ │  have been  │ │  gone 37 days.│         │
│  │  Let's go."   │ │  waiting    │ │  Worth a      │         │
│  │               │ │  three days.│ │  refresh."    │         │
│  │ [Enter the    │ │  Time to    │ │ [Set strategy]│         │
│  │  draft room]  │ │  answer."]  │ │               │         │
│  │               │ │ [Open thread]│ │               │         │
│  └───────────────┘ └─────────────┘ └───────────────┘         │
│                                                              │
└─────────────────────────────────────────────────────────────┘
```

- GM box: full-width of the content area, **shorter** vertical height (no briefing line)
- Three director boxes: equal width (1/3 each minus gutters), **taller** vertical height (includes briefing + optional action button)
- Connecting line: starts from bottom-center of GM box, branches into 3 paths, each path becomes the border of its director box (continuous flow — see Section 12)

### Mobile (<768px)

```
┌─────────────────────────────────┐
│  [Topbar]                       │
├─────────────────────────────────┤
│                                 │
│  Cleveland Football Club ·      │
│  7 Years Running                │
│                                 │
│  FRONT OFFICE                   │
│                                 │
├─────────────────────────────────┤
│  ───── On your desk ─────       │
├─────────────────────────────────┤
│  ┌───────────────────────────┐  │
│  │                           │  │
│  │ [icon]  [YOUR NAME],      │  │
│  │         GENERAL MANAGER   │  │
│  │                           │  │
│  │ Get plugged in, work the  │  │
│  │ phones, and make deals.   │  │
│  │                           │  │
│  └─────────────┬─────────────┘  │
│                │                │
│                │                │
│  ┌─────────────┴─────────────┐  │
│  │ DIRECTOR OF               │  │  ← nameplate chrome
│  │ SCOUTING               ●  │  │     (title + chip)
│  ├───────────────────────────┤  │
│  │                           │  │
│  │ "Boss, we're on the       │  │
│  │  clock. Let's go."        │  │
│  │                           │  │
│  │ [Enter the draft room]    │  │
│  │                           │  │
│  └───────────────────────────┘  │
│                                 │
│           • • •                 │
│                                 │
└─────────────────────────────────┘
```

- Both cards (GM and active director) are **equal width and height**
- Cards sized so that at maximum scroll, both are visible together with the connecting line landing between them
- Director card is swipeable left/right to cycle through Scouting → Pro Personnel → Research & Strategy
- Pagination dots below the director card (e.g., `• • •` with the active dot filled)
- **Peek of next card is killed on mobile.** Dots only.
- The connecting line stays anchored to the GM card; the director card slides under the line's landing point

---

## Section 3: The Four Boxes — Full Spec

### 3.1 General Manager Box (Top)

| Property | Value |
|---|---|
| Title | `[YOUR NAME], GENERAL MANAGER` (uppercase, dynamic from user data) |
| Icon | Rotary phone |
| Copy | `Get plugged in, work the phones, and make deals.` |
| Background | Blue (#3366CC) |
| Text color | White / Paper (#FEFCF9) |
| Border | 2.5px solid Ink (#1A1A1A) |
| Box shadow | 4px offset, Ink |
| Briefing | None — GM doesn't brief themselves |
| Urgency | None — the GM is the user, not a department |
| Click target | Entire box → navigates to GM Office (currently `/trades`) |
| Houses (inside the room) | Inbox, trade threads, Trade Builder shortcut, Trade Studio shortcut, persona, CFC Insider |

**Important:** the GM box is intentionally clean. No briefing line, no urgency chip. This is the user's identity at the top of the chart; directors brief upward to them.

### 3.2 Director of Scouting

| Property | Value |
|---|---|
| Title | `DIRECTOR OF SCOUTING` (in nameplate chrome at top of box) |
| Icon | Clipboard (placement TBD at mockup — lean nameplate) |
| Frame | Looking forward (rookies / draft) |
| Background | Paper (#FEFCF9) |
| Text color | Ink (#1A1A1A) |
| Border | Blue (#3366CC), 2.5px solid (continuation of connecting line from GM box) |
| Box shadow | 4px offset, Ink |
| Briefing | Real director voice (see Section 6) |
| Urgency | All three tiers possible. Green default. Yellow as draft approaches. Red when draft is live. |
| Click target (body) | Entire body → navigates to Scouting landing |
| Click target (action button, when present) | Direct route to critical destination |
| Houses | Scouting landing → War Room (draft prep, draft live, draft results) |

### 3.3 Director of Pro Personnel

| Property | Value |
|---|---|
| Title | `DIRECTOR OF PRO PERSONNEL` (in nameplate chrome at top of box) |
| Icon | Trading card (Topps-style player card silhouette — placement TBD at mockup) |
| Frame | Looking outward (other teams) |
| Background | Paper (#FEFCF9) |
| Text color | Ink (#1A1A1A) |
| Border | Blue (#3366CC), 2.5px solid |
| Box shadow | 4px offset, Ink |
| Briefing | Real director voice |
| Urgency | All three tiers possible. Green default. Yellow on pending offers aged 24–72h, hot targets, or untouchable interest. Red on offers > 72h or multiple teams pursuing |
| Click target (body) | Entire body → navigates to Pro Personnel landing |
| Click target (action button, when present) | Direct route to critical destination |
| Houses | Pro Personnel landing → Trade Builder, Trade Studio (Shop Around) |

### 3.4 Director of Research & Strategy

| Property | Value |
|---|---|
| Title | `DIRECTOR OF RESEARCH & STRATEGY` (in nameplate chrome at top of box) |
| Icon | Blueprint (placement TBD at mockup) |
| Frame | Looking inward (our team) + the research that informs strategy |
| Background | Paper (#FEFCF9) |
| Text color | Ink (#1A1A1A) |
| Border | Blue (#3366CC), 2.5px solid |
| Box shadow | 4px offset, Ink |
| Briefing | Real director voice |
| Urgency | **All three tiers possible** (the old "R&S never red" rule is killed as of v2.1). Door tier = highest tier of any card on the R&S landing's binder grid. See R&S spec §5 for per-lens thresholds. |
| Click target (body) | Entire body → navigates to R&S landing |
| Click target (action button, when present) | Direct route to critical destination |
| Houses | R&S landing → Set Strategy, Set Availability sub-screens |

---

## Section 4: Hero Section

Above the org chart, above "On your desk":

**Subhead** (small, muted, uppercase, letterspaced):
```
Cleveland Football Club · 7 Years Running
```

**Display headline** (very large, bold, uppercase):
```
FRONT OFFICE
```

Below the hero, a 3px solid Ink horizontal rule.

Existing typography from current `HomeScreen.tsx`:
- Subhead: JetBrains Mono, 9px, letter-spacing 3, color `#8C7E6A`
- Headline: Syne, 900 weight, `clamp(36px, 4.5vw, 66px)`, letter-spacing -2, uppercase

These can be reused as-is.

---

## Section 5: Section Header

```
───── On your desk ──────────────────────────────
```

- Copy: `On your desk` (uppercase styling driven by font)
- Font: Syne 900, ~16px, uppercase, letter-spacing -0.5
- Treatment: a black rectangle bookend on the left (existing pattern), then text, then a 3px solid Ink line extends to the right edge of content area
- Position: between the hero divider and the GM box (above the GM box on both desktop and mobile)
- This replaces the previous "Make your move" header

The framing is intentional: report-outs from the directors are "memos that landed on the GM's desk this morning."

---

## Section 6: Director Briefings (Real Director Voice)

Each director's box (Scouting, Pro Personnel, R&S) shows a **briefing** in the body — a single most-critical item rendered in real director voice + an optional contextual action button.

### 6.1 Voice & Style

- **First person, "we" voice.** Directors are part of the user's team. **Never** use "you" or "your" — say "we" / "our" / "us."
- **Conversational, hallway-chatter cadence.** Real director voice, not bullet-point summary. Lead-ins like *"Boss, …"* or *"A few things on the docket …"* are encouraged.
- **~30–50 words.** Substantial enough to feel like a real briefing, short enough to scan.
- **Has a point of view.** The briefing implies or recommends an action.
- **Render in quotes** to make it clear this is verbatim speech from the director.

### 6.2 One Thing at a Time

Each door surfaces **the single most-critical item** from its lens queue — not a top-3 summary. The briefing is a real conversation about that one item. Tap the door body → land on the door's landing page to see the full queue.

This is the master "Pattern A" rule from the May 12, 2026 design session: door briefing = preview of the top item from the door's lens queue. Generalized across all three director doors.

### 6.3 Two Click Paths

Each director box exposes two click paths:

1. **Click the door body** → land on the door's landing page (full binder grid / queue).
2. **Click the contextual action button** → go directly to the critical action's destination (the draft room, the inbox thread, the Set Strategy screen, etc.).

### 6.4 Examples by Tier

These are illustrative. Final content engine deferred to build phase (Section 6.5).

**Scouting:**
- Live draft (red): *"Boss, we're on the clock. Let's go."* → [Enter the draft room]
- Rankings stale (yellow): *"Our board hasn't been updated in 12 days and Mendoza's stock is sliding. Let's get in there."* → [Set rankings]
- Quiet (green): *"Class is locked. Fresh rankings on your desk."* → no button (or soft browse)

**Pro Personnel:**
- Pending offer (red): *"Founders have been waiting three days. Time to give them an answer."* → [Open thread]
- Hot target (yellow): *"Lamb's value is peaking and the Founders are listening. Worth a real swing."* → [View Lamb]
- Quiet (green): *"Wire's quiet. Nothing pressing right now."* → no button

**Research & Strategy:**
- Strategy stale (red): *"Strategy's gone 37 days. Worth a refresh before the deadline."* → [Set strategy]
- Player insight (yellow): *"We've got Mahomes marked moveable but he's critical to us. Worth a look."* → [Review Mahomes]
- All quiet (green): *"Nothing pressing, boss. Settle in."* → no button

### 6.5 Action Button — Present or Absent

- **Present** when something pressing surfaces (tier is yellow or red, or there's a green-tier item with a clear next step).
- **Absent on green-with-nothing-pressing.** The button's presence is itself a signal — no button means truly nothing to do.

Button style follows the neobrutalist system: Paper bg, 2.5px Ink border, 3px offset shadow, Syne 800 uppercase label.

### 6.6 Briefing Triggers (DEFERRED)

The full trigger map (which item bubbles to the top of which door's queue under which state) is **deferred to content/build phase**. At minimum, the build will need to support these state inputs:

- **Scouting:** draft state (off-season / pre-draft window / draft live / post-draft), days-to-draft countdown, set-board status, rankings drift signals, trade-up/down intel
- **Pro Personnel:** pending offer count + age (in hours), Acquire / Shop opportunities surfaced by lenses, league-wide market activity per position
- **Research & Strategy:** the top item on the R&S landing's binder grid (per R&S spec §5 lens priority order). The briefing previews that top item.

When implementing, lock these briefings against actual state variables in the database. Don't hard-code more than a default fallback. Build a small content engine that selects the right briefing based on state.

---

## Section 7: Urgency System

### 7.1 Tiers

| Tier | Color | Hex | When |
|---|---|---|---|
| Default / All clear | Green | #019942 | Normal state |
| **Attention** | Yellow | #F5C230 | Something approaching or unresolved |
| **Urgent** | Red | #E8503A | Needs action now |

### 7.2 Visual Treatment

- A small colored chip / dot next to the director's title in the nameplate chrome
- Roughly 8–10px diameter
- Solid filled color, no border
- **Default state = green chip rendered.** Green is always rendered; the chip is fully present in every state. (This is a change from v2.0, which used "no chip rendered" as the default state.)
- Same chip used in both desktop and mobile views

### 7.3 Trigger Rules (Locked Framework)

**All three director doors can hit any tier.** No door is locked out of red. (The prior "R&S never urgent" rule from v2.0 is killed.)

**Director of Scouting:**
- Attention (yellow): 7 days → 1 day before draft start; or rankings stale + drift signals; or trade up/down intel surfaced
- Urgent (red): draft is currently live (or starts today)

**Director of Pro Personnel:**
- Attention (yellow): at least one pending offer aged 24–72 hours; OR a hot Acquire / Shop opportunity surfaced by a lens
- Urgent (red): at least one pending offer aged > 72 hours; OR an untouchable being actively shopped (≥2 teams asking)

**Director of Research & Strategy:**
- Attention (yellow): the R&S binder grid has at least one yellow-tier card from any of the 6 lenses (see R&S spec §5)
- Urgent (red): the R&S binder grid has at least one red-tier card (e.g., strategy 60+ days stale, severe position misalignment unresolved, top-3 player tagged moveable for 28+ days, etc.)

If multiple conditions apply within a door, the highest tier wins (urgent beats attention).

### 7.4 Cross-Box Routing (FLAGGED FOR LATER)

Some Pro Personnel briefings reference content that lives in the GM Office (e.g., *"Founders have been waiting two days"* → the actual offer is in the GM's inbox). The **eventual** correct behavior is for clicking the action button to deeplink to the relevant content (the actual thread). This is **deferred** — the home screen build can ship with all clicks routing to the parent landing page; deeplinking from briefings can be added in a later pass.

---

## Section 8: Topbar

The topbar on the **home screen** is intentionally distinct from the topbar on inner pages. The home topbar is the lobby/welcome treatment. Inner page topbars are working-room treatments and are specified in the GM Office spec (and inherited by other inner pages).

### 8.1 Home Screen Topbar Composition

**Left side:**
- CFC league logo (this is a change — currently the topbar shows team-related branding; replace with the league logo on home screen specifically)

**Right side, inline left-to-right:**
- Persona icon (e.g., chess knight = Architect)
- Championship rings — single ring icon, with multiplier (e.g., `x2`, `x3`) appended if more than one championship
- Team name (text)
- Team logo (clickable — opens settings/profile page)

**No notification dot.** Urgency lives in the director chips and briefings; we don't need a separate notification surface on the topbar. The previous red dot in the topbar is **removed**.

### 8.2 Layout

Inline for both desktop and mobile. On mobile, the badges + name + logo cluster may compress horizontally but stays on one line. If space becomes tight on very narrow viewports, prioritize keeping the team logo visible and let the name truncate.

### 8.3 Persona Icons

Persona icon library already exists in the project. Nick will provide the file paths and mapping at build time. Personas to support: **Straight Shooter, Closer, Hustler, Architect**. The icon is pulled from the user's `gm_persona` value in `cfc_team_strategy_profiles`.

### 8.4 Championship Rings

Single ring icon (visual TBD at build). If user has multiple championships, append a multiplier (e.g., `🏆 x2`). The exact icon glyph is TBD — design it consistent with the neobrutalist aesthetic (solid silhouette, no gradients, no rounded glyphs). Data source for championship count is TBD — likely from `cfc_seasons` or a similar history table; if not yet modeled, render `0` rings (no ring icon) until data exists.

### 8.5 Badges in Other Contexts (DEFERRED)

The same badges (persona icon + championship rings) should appear next to other teams' names on:
- Trade threads / inbox cards
- Trade Studio offer cards
- Pro Personnel surfaces wherever another team is referenced
- Anywhere else another team is referenced

This is **deferred** — only the home topbar implements badges in this build. Other surfaces will inherit the pattern when those screens are built. Build the badge component to be reusable so it can be dropped into other contexts later.

---

## Section 9: Color Palette (Excerpt from Design System)

| Name | Hex | Usage on Home Screen |
|---|---|---|
| Ink | #1A1A1A | GM box border, all body text on directors, hero headline, section header |
| Paper | #FEFCF9 | Director box backgrounds, GM box text |
| Cream | #F5F0E6 | Page background |
| Blue | #3366CC | GM box fill, connecting lines, director box borders |
| Green | **#019942** | Green urgency chip on director boxes (always rendered as default state). Universal green across the app — replaces the prior #007370. |
| Yellow | #F5C230 | Attention urgency chip |
| Red | #E8503A | Urgent urgency chip |
| Muted | #8C7E6A | Hero subhead text |

Full palette in `/docs/CFC-APP-STATUS.md`.

---

## Section 10: Typography (Excerpt from Design System)

| Font | Weight | Usage |
|---|---|---|
| Syne | 800–900 | Hero headline, section header, box titles (nameplate chrome), action button labels |
| DM Sans | 400–700 | Director briefings, body text, team name |
| JetBrains Mono | 700 | Subhead, metadata, badge multipliers |

Full system in `/docs/CFC-APP-STATUS.md`.

---

## Section 11: Box Sizing & Proportions

### Desktop
- GM box: full width of the content area, shorter vertical height than directors (no briefing line to accommodate)
- Director boxes: 3 columns, equal width (each 1/3 of content area minus gutters), taller vertical height (nameplate + briefing + optional action button)
- Gutter between director boxes: ~14px (current value, retain)
- Gap between GM box bottom and director row top: enough vertical space to accommodate the connecting line (~40–60px)

### Mobile
- GM card and director card: **equal width and height** (full content width)
- Cards sized so when scrolled to max, both are visible together with the connecting line landing between them
- Recommended approach: each card is ~38–42vh in height (subject to mockup tuning)

Final proportions to be tuned at mockup. The above is the design intent.

---

## Section 12: Connecting Lines (Org Chart)

### Desktop
- Single line from bottom-center of GM box drops down ~20–30px
- Branches into 3 paths, each going horizontally (left, center, right) then vertically down to the top of one director box
- Each branch's terminus continues *into* the director box border (the line "becomes" the box border — they are the same continuous stroke)
- Line color: Blue (#3366CC)
- Line weight: 2.5px (matches the box borders, so the visual continuation works)
- Implementation suggestion: SVG with paths, OR CSS with positioned elements. SVG is more reliable for the "continuous stroke" feel.

### Mobile
- Single vertical line from bottom-center of GM card down to top-center of director card
- Same color and weight as desktop
- Continues into the director card's top border (same continuous treatment)
- The line is rendered between cards in the swipe area — it does NOT swipe with the director card. The line stays anchored to the GM card; the director card slides in/out underneath the line's landing point.

---

## Section 13: Behavioral Notes

- **Box body clicks:** Each box's body surface is clickable, navigating to that section's landing screen
- **Action button clicks:** When present, navigate directly to the briefing's critical destination (the draft room, the inbox thread, the Set Strategy screen, etc.)
- **CFC league logo click (left of topbar):** No navigation needed on home (you're already home). Behavior can be inert or could open a "league info" overlay (defer the choice — inert is fine for V1)
- **Team logo click (right of topbar):** Opens settings/profile page
- **Mobile swipe:** Director card swipes left/right to cycle through Scouting → Pro Personnel → Research & Strategy. Wraps around (last card swipe-right goes to first card). Peek of next card is killed; dots are the only swipe signal.
- **Loading states:** Disabled. The current "Entering…" overlay during team claim is **removed** in this redesign
- **Empty/onboarding states:** Deferred. First-time users with no rings, no briefings, etc. — handle at build time

---

## Section 14: Files Affected

**Replace:**
- `src/components/HomeScreen.tsx` (current 4-card grid → new org chart layout)

**Likely to add (component breakdown):**
- `src/components/home/HomeTopbar.tsx` — new topbar with league logo + badges
- `src/components/home/PersonaBadge.tsx` — reusable, takes a persona type, renders the correct icon
- `src/components/home/ChampionshipBadge.tsx` — reusable, takes a count, renders ring + multiplier
- `src/components/home/GMBox.tsx` — top box (full-width, blue)
- `src/components/home/DirectorBox.tsx` — reusable director box (nameplate chrome + briefing body + optional action button)
- `src/components/home/DirectorNameplate.tsx` — chrome at the top of director boxes carrying title + urgency chip
- `src/components/home/UrgencyChip.tsx` — small reusable urgency chip (green / yellow / red)
- `src/components/home/DirectorBriefing.tsx` — briefing text + action button slot
- `src/components/home/OrgChartLines.tsx` — SVG/CSS connecting lines
- `src/components/home/SwipeableDirectors.tsx` — mobile swipe container

**May need data wiring:**
- User's team name + team logo URL (likely already in scope from current `HomeScreen.tsx`)
- User's persona (from `cfc_team_strategy_profiles.gm_persona`)
- Championship count (data source TBD — likely from a history/seasons table; default to 0 if not modeled yet)
- Briefing inputs per door (top item on the door's landing's lens queue — see Section 6.6)
- Urgency tier per door (computed from briefing inputs — see Section 7.3)

---

## Section 15: Build Order Recommendation

Suggested sequence to ship cleanly without broken intermediate states. Each step should produce a buildable commit (Nick uses GitHub web editor, one file at a time).

1. **`UrgencyChip.tsx`** — small standalone component, no dependencies. Easiest first commit. Always renders the green default unless yellow/red is passed.
2. **`PersonaBadge.tsx`** — standalone, takes persona prop. Stub icons can be Lucide placeholders if real persona icons aren't wired yet.
3. **`ChampionshipBadge.tsx`** — standalone, takes count prop.
4. **`HomeTopbar.tsx`** — composes badges. Replaces current topbar JSX in `HomeScreen.tsx`. Stub data with hardcoded values for now.
5. **`GMBox.tsx`** — standalone, takes user name prop. Hardcoded copy. No briefing.
6. **`DirectorNameplate.tsx`** — chrome with title + urgency chip slot.
7. **`DirectorBriefing.tsx`** — briefing text + action button slot. Takes briefing text + optional CTA props.
8. **`DirectorBox.tsx`** — composes nameplate + briefing. Takes director type prop. Hardcoded copy per director (it's locked, not dynamic).
9. **`OrgChartLines.tsx`** — the connecting lines. Test on desktop first — verify the visual lands.
10. **`HomeScreen.tsx` desktop layout** — composes topbar + hero + section header + GM box + lines + director boxes. Verify desktop renders cleanly.
11. **`SwipeableDirectors.tsx`** — mobile swipe wrapper. Use a touch/swipe library (e.g., `framer-motion` drag, `react-use-gesture`, or `embla-carousel`).
12. **Mobile layout in `HomeScreen.tsx`** — swap director column for swipeable component on small screens (use `@media (max-width: 767px)` or window-width state). Peek killed; dots only.
13. **Wire briefings to real data** — replace stubs with actual queries. (See Section 6.6 trigger map.)
14. **Wire urgency to real triggers** — replace hardcoded urgency tier with computed value.
15. **Wire badges to real data** — pull persona from strategy profile, championship count from history table (or default 0).

---

## Section 16: Open Items / Deferred Decisions

These are NOT blockers for the home screen build. They are flagged for later work:

1. **Inner page topbar** — different from home topbar; specified in `CFC-GM-OFFICE-SPEC.md` and inherited by other inner pages built later (Pro Personnel, Scouting, Research & Strategy)
2. **Cross-box deeplinking** — Pro Personnel briefings that reference inbox content should eventually deeplink to specific threads (Section 7.4)
3. **Briefing copy variants by state** — full content map for what each director says under each app state (Section 6.6). Enough of a framework is locked here to start; the full content library lands at build
4. **Icon placement in nameplate** — small icon alongside title in nameplate chrome, or larger icon as body graphic. Lean nameplate. Settle at mockup.
5. **Persona icon mapping** — which icon (chess knight, etc.) represents which persona. User will provide at build
6. **Championship ring icon design** — exact visual treatment of the ring icon. Design at build
7. **Onboarding/empty states** — first-time GM with no rings, no offers, no briefing data. Default fallbacks needed
8. **Animation/transitions** — desktop hover effects, mobile swipe physics, etc. Punted until base layout works
9. **Accessibility** — keyboard navigation, screen reader labels, focus states. Punted

---

## Section 17: Design Principles to Honor (from `/docs/CFC-APP-STATUS.md`)

When implementing, ensure these non-negotiables are honored:

- No rounded corners (`border-radius: 0` everywhere)
- No gradients
- 2.5px solid borders (Ink #1A1A1A by default; Blue #3366CC for director boxes per Section 3.2–3.4)
- Offset box shadows (3–4px)
- Inline styles (no new CSS framework — current pattern in `HomeScreen.tsx` uses inline styles, follow that)
- All components under 500 lines (split if needed)
- Use `window.location.href` for navigation (not `router.push`)
- Colors are for emphasis only — don't add color beyond what's specified here
- Files delivered as full replacements, one commit at a time
- Copy matters — every word in this spec is locked. Do not paraphrase or "improve" copy without confirmation

---

## Section 18: Summary — At-a-Glance

| Element | Decision |
|---|---|
| **Layout** | Org chart: GM full-width on top, 3 directors below |
| **GM box copy** | *Get plugged in, work the phones, and make deals.* |
| **GM box style** | Blue fill (#3366CC), white text, no briefing, no urgency |
| **Director box style** | Paper fill, ink text, blue (#3366CC) border, nameplate chrome (title + urgency chip), briefing body, optional action button |
| **Director title placement** | In nameplate chrome at the top of the box (NOT in box body) |
| **Director briefing** | Real director voice, ~30–50 words, single most-critical item ("one thing at a time" — Pattern A), in quotes |
| **Two click paths** | Click body → landing page. Click action button → critical destination |
| **Action button rule** | Present only when something pressing surfaces. Absent on green-with-nothing-pressing. |
| **Connecting lines** | Blue (#3366CC), 2.5px, continuous flow into director borders |
| **Section header** | *On your desk* (above the GM box) |
| **Hero** | *Cleveland Football Club · 7 Years Running* / *FRONT OFFICE* |
| **Topbar (left)** | CFC league logo |
| **Topbar (right)** | Persona icon + championship rings + team name + team logo (inline) |
| **Mobile** | Two-card stack, equal size, swipeable directors, dots only (peek killed) |
| **Loading states** | Disabled / removed |
| **Urgency** | 3 tiers (green / yellow / red). All doors can hit all three. Green chip always rendered (default). Highest tier of any landing-page card sets the door tier. |
| **Green color** | #019942 (universal across the app — replaces prior #007370) |
| **Notification dot** | Removed from topbar |

**Director frame summary:**

| Director | Lens | Houses |
|---|---|---|
| Scouting | Looking forward | Scouting landing → War Room (draft prep, draft live, results) |
| Pro Personnel | Looking outward | Pro Personnel landing → Trade Builder, Trade Studio |
| Research & Strategy | Looking inward + data that informs strategy | R&S landing → Set Strategy, Set Availability |

---

## Section 19: Inside-the-Box Composition

For clarity, the layout *inside* each box, top to bottom:

**GM box:**
1. Icon (rotary phone) + Title text on same row → `[icon]  [YOUR NAME], GENERAL MANAGER`
2. Copy below → `Get plugged in, work the phones, and make deals.`
3. (No briefing, no urgency)

**Director boxes (all three):**
1. **Nameplate chrome (top strip):** Title + urgency chip → `DIRECTOR OF [X]   ●` (icon placement TBD at mockup — small in nameplate, or as body graphic)
2. **Body:** Briefing in real director voice (in quotes, ~30–50 words)
3. **Action button (when present):** Direct route to critical destination
4. (No internal title in box body — title is up in the chrome)

The briefing is visually distinct from any role description — it's the director speaking, rendered in quotes. The body's voice is conversational, not descriptive.

---

## End of Spec — Ready for Build

Final note: the home screen design is fully locked. Every copy string, every color, every behavioral rule is decided. The only items intentionally deferred are content-data-dependent (briefing variants, urgency triggers, persona/ring data wiring) and adjacent build work (the Pro Personnel, R&S, and Scouting landings themselves) — all logged in Section 16.

Pick this up in a new chat by attaching this document along with `/docs/CFC-APP-STATUS.md`. The new chat should not need any conversation history beyond these two files to execute the build cleanly.
