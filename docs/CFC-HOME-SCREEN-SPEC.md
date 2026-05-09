# CFC Front Office — Home Screen Design Spec

**Version:** 2.0 (revised)
**Date:** May 8, 2026
**Status:** Design locked — ready for mockup → code

> **Revision note:** v2.0 supersedes v1.0. The "Analytics" door is replaced by **Research & Strategy** (Browns-inspired, modeled after their VP, Research & Strategy role). All content related to setting roster strategy and inputs (wants_more, position markets, attachment, trade chart) now lives in Research & Strategy alongside the historian/research function. Pro Personnel becomes purely external scouting.

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
│  ┌─────┴─────┐    ┌─────┴─────┐    ┌─────┴─────┐             │
│  │ DIR. OF   │    │ DIR. OF   │    │ DIR. OF   │             │
│  │ SCOUTING  │ ●  │ PRO       │ ●  │ RESEARCH  │             │
│  │           │    │ PERSONNEL │    │ & STRATEGY│             │
│  │ [icon]    │    │ [icon]    │    │ [icon]    │             │
│  │           │    │           │    │           │             │
│  │ Copy...   │    │ Copy...   │    │ Copy...   │             │
│  │           │    │           │    │           │             │
│  │ "Brief..."│    │ "Brief..."│    │ "Brief..."│             │
│  └───────────┘    └───────────┘    └───────────┘             │
│                                                              │
└─────────────────────────────────────────────────────────────┘
```

- GM box: full-width of the content area, **shorter** vertical height (no briefing line)
- Three director boxes: equal width (1/3 each minus gutters), **taller** vertical height (includes briefing)
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
│  │                           │  │
│  │ [icon]  DIRECTOR OF       │  │
│  │         SCOUTING       ●  │  │
│  │                           │  │
│  │ Build your board, run     │  │
│  │ the draft.                │  │
│  │                           │  │
│  │ "Brief..."                │  │
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
- Slight peek of next card on right edge as a swipe affordance (iOS-native pattern)
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
| Urgency | None |
| Click target | Entire box → navigates to GM Office (currently `/trades`) |
| Houses (inside the room) | Inbox, trade threads, Trade Builder shortcut, Trade Studio shortcut, persona, CFC Insider |

**Important:** the GM box is intentionally clean. No briefing line, no urgency chip. This is the user's identity at the top of the chart; directors brief upward to them.

### 3.2 Director of Scouting

| Property | Value |
|---|---|
| Title | `DIRECTOR OF SCOUTING` |
| Icon | Clipboard |
| Copy | `Build your board, run the draft.` |
| Frame | Looking forward (rookies / draft) |
| Background | Paper (#FEFCF9) |
| Text color | Ink (#1A1A1A) |
| Border | Blue (#3366CC), 2.5px solid (continuation of connecting line from GM box) |
| Box shadow | 4px offset, Ink |
| Briefing | First-person, "we" voice (see Section 6) |
| Urgency | Yellow chip (week before draft) / Red chip (draft live) |
| Click target | Entire box → navigates to War Room |
| Houses | War Room (draft prep, draft live, draft results), redraft rankings (future) |

### 3.3 Director of Pro Personnel

| Property | Value |
|---|---|
| Title | `DIRECTOR OF PRO PERSONNEL` |
| Icon | Trading card (Topps-style player card silhouette) |
| Copy | `Scout the league, find our targets.` |
| Frame | Looking outward (other teams) |
| Background | Paper (#FEFCF9) |
| Text color | Ink (#1A1A1A) |
| Border | Blue (#3366CC), 2.5px solid |
| Box shadow | 4px offset, Ink |
| Briefing | First-person, "we" voice |
| Urgency | Yellow chip (pending offer 24–72h, an untouchable getting league interest) / Red chip (pending offer past 72h, an untouchable being actively shopped by multiple teams) |
| Click target | Entire box → navigates to Pro Personnel landing |
| Houses | **Scout Players** (top player matches — formerly part of the Trade Builder landing) and **Scout Teams** (best trading partners — formerly part of the Trade Builder landing). Pro Personnel is now purely external scouting. |

**STRUCTURAL NOTE:** The Trade Builder "landing page" (current "shop around" view with top targets and best trading partners) is split into **Scout Players** and **Scout Teams** screens, both housed under Pro Personnel. The "Build a trade" button on the GM Office landing remains as a shortcut — it opens a popover asking "Scout Players or Scout Teams?" and routes to the chosen mode. Pro Personnel no longer houses roster strategy, attachment, or trade chart — those have all moved to Research & Strategy.

### 3.4 Director of Research & Strategy

| Property | Value |
|---|---|
| Title | `DIRECTOR OF RESEARCH & STRATEGY` |
| Icon | Blueprint |
| Copy | `Mine the data, set the plan.` |
| Frame | Looking inward (our team) + the research that informs strategy |
| Background | Paper (#FEFCF9) |
| Text color | Ink (#1A1A1A) |
| Border | Blue (#3366CC), 2.5px solid |
| Box shadow | 4px offset, Ink |
| Briefing | First-person, "we" voice. Mostly data-informed strategic recommendations. |
| Urgency | **None** in the urgent (red) tier under any condition. Rare attention (yellow) tier — e.g., strategy hasn't been updated in 30+ days or before a major league window (draft, deadline). Default state most of the time. |
| Click target | Entire box → navigates to Research & Strategy landing |
| Houses | **Strategy** (wants_more + position markets), **Roster** (player attachment + trade chart), **Research** (the historian / ask-anything tool, plus league records and history). Three sub-screens, internal navigation TBD when this door is designed. |

**STRUCTURAL NOTE:** This door consolidates what was previously split between the old Owner's Box (roster strategy, wants_more, position markets, attachment) and the old Analytics door (records, history, historian) plus the trade chart that lived in Owner's Box. The integration is intentional: in real-world organizations (and on the Browns' actual front office), research and strategy work together — data informs strategy. The director's voice on this door is the strategist who uses data, not a pure researcher.

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

## Section 6: Director Briefings (Report-Outs)

Each director's box (Scouting, Pro Personnel, Research & Strategy) includes a **briefing** at the bottom — a first-person message from the director to the GM.

### 6.1 Voice & Style

- **First person, "we" voice.** Directors are part of the user's team. **Never** use "you" or "your" — say "we" / "our" / "us." Example: NOT *"You're buying at WR"*. YES *"We're buying at WR."*
- **Brief.** 1–2 sentences max. Punchy. No fluff.
- **Has a point of view.** Directors don't just state facts — they imply or recommend an action.
- **Vintage front-office voice.** "Boss" addressing is allowed sparingly. Otherwise neutral and professional.
- **Render in quotes** to make it clear this is a verbatim quote from the director.

### 6.2 Examples by Director

These are illustrative. Final content map deferred to build phase (Section 6.3).

**Director of Scouting:**
- Off-season (default): *"Fresh redraft rankings on your desk."*
- Pre-draft (attention): *"Draft starts in 6 days. Need to lock the board."*
- Draft live (urgent): *"We're on the clock."*
- Post-draft: *"Draft's wrapped. Board's on your desk."*

**Director of Pro Personnel** (purely external — league activity, trade flow, who's available):
- Sell signal (default): *"WR market's heating up — three teams buying. Lamb's value is peaking."*
- Buy signal (default): *"Founders just put their WR1 on the block. Good chance to fill our biggest need."*
- Pending offer (attention): *"Founders have been waiting two days. We owe them a response."*
- Untouchable hunted (urgent): *"Two teams have called about Daniels this week. They're persistent."*
- Quiet week (default): *"Wire's quiet. Nothing moving that fits our build."*

**Director of Research & Strategy** (data-informed strategic recommendations):
- Default: *"Champ teams stack WRs and run two RBs. Pulled the breakdown."*
- Default: *"Last decade's title teams averaged three untouchables at WR. We've got one."*
- Default: *"Most successful offseason trades involve 1st-rounders. Worth a look at our chart."*
- Default: *"Teams with our age profile won 23% of titles last decade."*
- Curiosity / lighter (default): *"Twelve new league records since your last visit."*
- Attention (rare): *"Our strategy hasn't been updated in 30 days. Worth a refresh."*

The Research & Strategy director's voice is the strategist who uses data. Most briefings pair an insight with an implied action ("champ teams stack WRs" → "worth bumping our WR market"). Pure-trivia briefings ("12 new records") are valid but should be the minority — they don't move the needle the way actionable strategic briefings do.

### 6.3 Briefing Triggers (DEFERRED)

Briefings are dynamic and depend on app state. The full trigger map (which briefing surfaces in which state) is **deferred to content/build phase**. At minimum, the build will need to support these state inputs:

- **Scouting:** draft state (off-season / pre-draft window / draft live / post-draft), days-to-draft countdown, set-board status
- **Pro Personnel:** pending offer count + age (in hours), league-wide market activity per position, untouchable hunt status (other teams asking about user's untouchables), recent league moves
- **Research & Strategy:** time since last strategy update, current `wants_more` / `position_markets` state, championship-team comparison data, league history events, new records

When implementing, lock these briefings against actual state variables in the database. Don't hard-code more than a default fallback. Build a small content engine that selects the right briefing based on state.

---

## Section 7: Urgency System

### 7.1 Tiers

| Tier | Color | When |
|---|---|---|
| Default | None / no chip rendered | Normal state |
| **Attention** | Yellow (#F5C230) | Something approaching or unresolved |
| **Urgent** | Red (#E8503A) | Needs action now |

### 7.2 Visual Treatment

- A small colored dot or chip next to the director's title (right of title text, on the same line)
- Roughly 8–10px diameter
- Solid filled color, no border
- Default state = no chip rendered (do NOT render a gray dot — the chip is fully absent in default state)
- Same chip used in both desktop and mobile views

### 7.3 Trigger Rules (Locked Framework)

**Director of Scouting:**
- Attention (yellow): 7 days → 1 day before draft start
- Urgent (red): draft is currently live (or starts today)

**Director of Pro Personnel:**
- Attention (yellow): at least one pending offer aged 24–72 hours; OR an untouchable has 1 team showing interest
- Urgent (red): at least one pending offer aged > 72 hours; OR an untouchable being actively shopped (≥2 teams asking)

**Director of Research & Strategy:**
- Attention (yellow): rare. Possible triggers: strategy hasn't been updated in 30+ days; the league is approaching a major event window (e.g., 14 days before draft) and `wants_more` / `position_markets` haven't been touched recently.
- Urgent (red): **never.** This director never escalates to red. The voice is the calm strategist; making them urgent breaks character.
- Default most of the time.

If multiple conditions apply, the highest tier wins (urgent beats attention).

### 7.4 Cross-Box Routing (FLAGGED FOR LATER)

Some Pro Personnel briefings reference content that lives in the GM Office (e.g., *"Founders have been waiting two days"* → the actual offer is in the GM's inbox). The **eventual** correct behavior is for clicking the briefing to deeplink to the relevant content (the actual thread). This is **deferred** — the home screen build can ship with all clicks routing to the parent box. Deeplinking from briefings can be added in a later pass.

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

**No notification dot.** Urgency lives in the director briefings; we don't need a separate notification surface on the topbar. The previous red dot in the topbar is **removed**.

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
- Pro Personnel "scout the league" view
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
| Yellow | #F5C230 | Attention urgency chip |
| Red | #E8503A | Urgent urgency chip |
| Muted | #8C7E6A | Hero subhead text |

Full palette in `/docs/CFC-APP-STATUS.md`.

---

## Section 10: Typography (Excerpt from Design System)

| Font | Weight | Usage |
|---|---|---|
| Syne | 900 | Hero headline, section header, box titles |
| DM Sans | 400–700 | Director copy, briefings, body text, team name |
| JetBrains Mono | 700 | Subhead, metadata, badge multipliers |

Full system in `/docs/CFC-APP-STATUS.md`.

---

## Section 11: Box Sizing & Proportions

### Desktop
- GM box: full width of the content area, shorter vertical height than directors (no briefing line to accommodate)
- Director boxes: 3 columns, equal width (each 1/3 of content area minus gutters), taller vertical height (briefing line included)
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

- **Box clicks:** Each box's entire surface is clickable, navigating to that section's landing screen
- **CFC league logo click (left of topbar):** No navigation needed on home (you're already home). Behavior can be inert or could open a "league info" overlay (defer the choice — inert is fine for V1)
- **Team logo click (right of topbar):** Opens settings/profile page
- **Mobile swipe:** Director card swipes left/right to cycle through Scouting → Pro Personnel → Research & Strategy. Wraps around (last card swipe-right goes to first card)
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
- `src/components/home/DirectorBox.tsx` — reusable director box (paper fill, blue border, briefing slot)
- `src/components/home/DirectorBriefing.tsx` — briefing text + urgency chip wrapper
- `src/components/home/UrgencyChip.tsx` — small reusable urgency dot
- `src/components/home/OrgChartLines.tsx` — SVG/CSS connecting lines
- `src/components/home/SwipeableDirectors.tsx` — mobile swipe container

**May need data wiring:**
- User's team name + team logo URL (likely already in scope from current `HomeScreen.tsx`)
- User's persona (from `cfc_team_strategy_profiles.gm_persona`)
- Championship count (data source TBD — likely from a history/seasons table; default to 0 if not modeled yet)
- Briefing inputs (pending offer counts, draft state, days since strategy update, championship-team comparison data, etc. — see Section 6.3)
- Urgency tier (computed from briefing inputs — see Section 7.3)

---

## Section 15: Build Order Recommendation

Suggested sequence to ship cleanly without broken intermediate states. Each step should produce a buildable commit (Nick uses GitHub web editor, one file at a time).

1. **`UrgencyChip.tsx`** — small standalone component, no dependencies. Easiest first commit.
2. **`PersonaBadge.tsx`** — standalone, takes persona prop. Stub icons can be Lucide placeholders if real persona icons aren't wired yet.
3. **`ChampionshipBadge.tsx`** — standalone, takes count prop.
4. **`HomeTopbar.tsx`** — composes badges. Replaces current topbar JSX in `HomeScreen.tsx`. Stub data with hardcoded values for now.
5. **`GMBox.tsx`** — standalone, takes user name prop. Hardcoded copy. No briefing.
6. **`DirectorBriefing.tsx`** — wraps briefing text + chip. Takes text + tier props.
7. **`DirectorBox.tsx`** — composes title + icon + copy + briefing. Takes director type prop. Hardcoded copy per director (it's locked, not dynamic).
8. **`OrgChartLines.tsx`** — the connecting lines. Test on desktop first — verify the visual lands.
9. **`HomeScreen.tsx` desktop layout** — composes topbar + hero + section header + GM box + lines + director boxes. Verify desktop renders cleanly.
10. **`SwipeableDirectors.tsx`** — mobile swipe wrapper. Use a touch/swipe library (e.g., `framer-motion` drag, `react-use-gesture`, or `embla-carousel`).
11. **Mobile layout in `HomeScreen.tsx`** — swap director column for swipeable component on small screens (use `@media (max-width: 767px)` or window-width state).
12. **Wire briefings to real data** — replace stubs with actual queries. (See Section 6.3 trigger map.)
13. **Wire urgency to real triggers** — replace hardcoded urgency tier with computed value.
14. **Wire badges to real data** — pull persona from strategy profile, championship count from history table (or default 0).

---

## Section 16: Open Items / Deferred Decisions

These are NOT blockers for the home screen build. They are flagged for later work:

1. **Inner page topbar** — different from home topbar; specified in `CFC-GM-OFFICE-SPEC.md` and inherited by other inner pages built later (Pro Personnel, Scouting, Research & Strategy)
2. **Cross-box deeplinking** — Pro Personnel briefings that reference inbox content should eventually deeplink to specific threads (Section 7.4)
3. **Briefing copy variants by state** — full content map for what each director says under each app state (Section 6.3). Enough of a framework is locked here to start; the full content library lands at build
4. **Persona icon mapping** — which icon (chess knight, etc.) represents which persona. User will provide at build
5. **Championship ring icon design** — exact visual treatment of the ring icon. Design at build
6. **Onboarding/empty states** — first-time GM with no rings, no offers, no briefing data. Default fallbacks needed
7. **Animation/transitions** — desktop hover effects, mobile swipe physics, etc. Punted until base layout works
8. **Accessibility** — keyboard navigation, screen reader labels, focus states. Punted
9. **The Trade Builder landing migration** — the current Trade Builder landing splits into Scout Players + Scout Teams under Pro Personnel, and roster strategy / attachment / trade chart move to Research & Strategy. Coordinate this migration when implementing those two doors. The home screen build itself doesn't depend on those migrations being complete — director boxes can route to placeholder pages until the doors are built.

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
| **Scouting copy** | *Build your board, run the draft.* |
| **Pro Personnel copy** | *Scout the league, find our targets.* |
| **Research & Strategy copy** | *Mine the data, set the plan.* |
| **Icons** | Rotary phone (GM) · Clipboard (Scouting) · Trading card (Pro Personnel) · Blueprint (Research & Strategy) |
| **GM box style** | Blue fill (#3366CC), white text, no briefing, no urgency |
| **Director box style** | Paper fill, ink text, blue (#3366CC) border, briefing + urgency chip |
| **Connecting lines** | Blue (#3366CC), 2.5px, continuous flow into director borders |
| **Section header** | *On your desk* (above the GM box) |
| **Hero** | *Cleveland Football Club · 7 Years Running* / *FRONT OFFICE* |
| **Topbar (left)** | CFC league logo |
| **Topbar (right)** | Persona icon + championship rings + team name + team logo (inline) |
| **Mobile** | Two-card stack, equal size, swipeable directors, dots + peek |
| **Loading states** | Disabled / removed |
| **Urgency** | Yellow/red chip next to director title (Scouting + Pro Personnel only — Research & Strategy never urgent, rare attention only) |
| **Briefings** | First-person, "we" voice, in quotes, 1–2 sentences with a point of view |
| **Notification dot** | Removed from topbar |

**Director frame summary:**

| Director | Lens | Houses |
|---|---|---|
| Scouting | Looking forward | War Room (draft prep, draft live, results), redraft rankings |
| Pro Personnel | Looking outward | Scout Players, Scout Teams |
| Research & Strategy | Looking inward + the data that informs strategy | wants_more, position markets, attachment, trade chart, historian / research tool |

---

## Section 19: Title Plate at Top of Each Box (Composition)

For clarity, the layout *inside* each box, top to bottom:

**GM box:**
1. Icon (rotary phone) + Title text on same row → `[icon]  [YOUR NAME], GENERAL MANAGER`
2. Copy below → `Get plugged in, work the phones, and make deals.`
3. (No briefing, no urgency)

**Director boxes (all three):**
1. Icon + Title + Urgency chip on same row → `[icon]  DIRECTOR OF [X]   ●`
2. Copy below → `[director copy]`
3. Briefing at bottom (in quotes, italicized or visually distinct) → `"[briefing text]"`

The briefing is visually separated from the copy — it's a different "voice" (the director speaking, vs. the static role description). Suggested treatment: small top divider, slightly muted color, italic, quotation marks.

---

## End of Spec — Ready for Build

Final note: the home screen design is fully locked. Every copy string, every color, every behavioral rule is decided. The only items intentionally deferred are content-data-dependent (briefing variants, urgency triggers, persona/ring data wiring) and adjacent build work (the Pro Personnel and Research & Strategy doors themselves) — all logged in Section 16.

Pick this up in a new chat by attaching this document along with `/docs/CFC-APP-STATUS.md`. The new chat should not need any conversation history beyond these two files to execute the build cleanly.
