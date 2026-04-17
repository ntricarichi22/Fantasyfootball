# CFC Design System — The Bible

> This is the definitive design reference for the Cleveland Football Club fantasy football app. Every UI component, page, and feature must follow this document. Read it before building or restyling anything.

---

## Stack

- Next.js 16, React 19, TypeScript
- Tailwind 4
- Fonts: DM Sans (body/UI), JetBrains Mono (stats/numbers), Syne (headlines — bold weight only)
- Supabase (Postgres), deployed on Vercel

---

## Aesthetic Direction

**Neobrutalism meets vintage sports graphics.** Inspired by 1980s Topps baseball card packaging and Bauhaus geometric design. Bold primary colors, thick black borders, solid offset shadows, flat fills, no gradients, no blur. The app should feel like ripping open a pack of cards — loud, confident, fun. Not corporate, not SaaS, not subtle.

---

## Color Palette

### Core Colors

```css
@theme {
  --color-blue: #3366CC;
  --color-red: #E8503A;
  --color-yellow: #F5C230;
  --color-ink: #1A1A1A;
  --color-canvas: #F5F0E6;
  --color-card: #FEFCF9;
  --color-muted: #8C7E6A;
  --color-muted-border: #C8C3B8;
}
```

| Token | Name | Hex | Usage |
|-------|------|-----|-------|
| `blue` | Blue | `#3366CC` | Primary action color, RB position, hero card bg, bottom ticker bar |
| `red` | Red | `#E8503A` | Alerts, destructive actions, QB position, section tags, AI accent |
| `yellow` | Yellow | `#F5C230` | Highlights, CFC logo text, WR position, active nav indicator |
| `ink` | Ink | `#1A1A1A` | Borders, shadows, body text, top bar bg, TE position |
| `canvas` | Canvas | `#F5F0E6` | Main content area background |
| `card` | Card | `#FEFCF9` | Cards, inputs, elevated surfaces |
| `muted` | Muted | `#8C7E6A` | Secondary text, captions, stat labels |
| `muted-border` | Muted Border | `#C8C3B8` | Bench card borders, inactive elements |

### Position Colors

| Position | Background | Text Color |
|----------|-----------|------------|
| QB | `#E8503A` (red) | White |
| RB | `#3366CC` (blue) | White |
| WR | `#F5C230` (yellow) | `#1A1A1A` (ink) |
| TE | `#1A1A1A` (ink) | White |

These colors are used for: position badges, starter chips, position row headers in depth charts, player card color bars, and stat card fills.

### Stat Value Colors (on dark backgrounds)

When displaying stats on a black/dark background, each stat type gets its own color for visual variety:

| Stat | Color |
|------|-------|
| Points / primary | `#F5C230` (yellow) |
| Secondary stat | `#FFFFFF` (white) |
| Tertiary stat | `#6B9AE0` (light blue) |
| Streak / alert | `#E8503A` (red) |
| Labels | `#999999` (never lower than this on black) |

**Rule:** On black backgrounds, label text must be at minimum `#999`. No `#666` or darker — it doesn't read.

---

## Typography

### Font Loading

```tsx
import { DM_Sans, JetBrains_Mono, Syne } from 'next/font/google';

const dmSans = DM_Sans({ subsets: ['latin'], variable: '--font-body' });
const jetbrains = JetBrains_Mono({ subsets: ['latin'], variable: '--font-mono' });
const syne = Syne({ subsets: ['latin'], weight: ['700', '800'], variable: '--font-headline' });
```

### Usage Rules

| Context | Font | Weight | Example |
|---------|------|--------|---------|
| Page titles, section headers, hero text | Syne | 700–800 | "Team HQ", "Draft Room", the big "8-5" record |
| Body text, labels, buttons, nav items, player names | DM Sans | 400–600 | All UI chrome |
| Stats, scores, point totals, records, rankings, PPG | JetBrains Mono | 400–700 | "24.3 pts", "8-5", "1,847" |
| Chips, tags, badges | DM Sans | 600–700 | "Starter", "Depth chart" |

### Scale Contrast

The design uses dramatic scale jumps — this is intentional. Hero numbers should be 48-64px. Stat values 18-28px. Labels 10-11px. The contrast between huge numbers and tiny labels is part of the aesthetic.

---

## Neobrutalist Rules

### Borders

- **Standard:** `2.5px solid #1A1A1A`
- **Bench/muted elements:** `2px solid #C8C3B8`
- **Badge/chip inner:** `1.5-2px solid #1A1A1A`
- **Never** use subtle, transparent, hairline, or colored borders on structural elements. Borders are ink-black.

### Shadows

Always solid offset, **never blurred**.

| Context | Shadow |
|---------|--------|
| Default (cards, buttons) | `4px 4px 0 #1A1A1A` |
| Small (badges, chips, player cards) | `3px 3px 0 #1A1A1A` |
| Tiny (section tags) | `2px 2px 0 #1A1A1A` |
| Large (modals, hero, drawers) | `6px 6px 0 #1A1A1A` |
| Bench/muted elements | `none` |

### Interactive Shadow Shift

Every clickable element with a shadow must respond physically:

```css
.interactive {
  transition: transform 100ms, box-shadow 100ms;
}
.interactive:hover {
  transform: translate(1px, 1px);
  box-shadow: 3px 3px 0 #1A1A1A; /* reduced from 4px */
}
.interactive:active {
  transform: translate(4px, 4px);
  box-shadow: none;
}
```

### Corners

| Element | Radius |
|---------|--------|
| Cards, hero blocks | `12px` |
| Buttons, inputs, player cards, position labels | `8px` |
| Badges, chips, tags, section tags | `4px` |
| AI icon circle | `50%` (full round) |
| Everything else | `4-8px` |

**Never use pill shapes** (`border-radius: 9999px` or `20px+`) on chips, buttons, or tags.

---

## Layout Structure

### Global Shell

```
┌─────────────────────────────────────────┐
│ TOP BAR — #1A1A1A (ink)                 │ ← always visible
│ Logo (yellow) + Nav (underline active)  │
├─────────────────────────────────────────┤
│                                         │
│ CONTENT AREA — #F5F0E6 (canvas)         │
│                                         │
│ Hero card, depth chart, AI card, etc.   │
│                                         │
├─────────────────────────────────────────┤
│ TICKER BAR — #3366CC (blue)             │ ← always visible
│ Activity feed, scrolling updates        │
└─────────────────────────────────────────┘
```

The top bar (black) and bottom ticker (blue) bookend every page. Content sits on the cream canvas between them.

### Top Bar

```
Background: #1A1A1A
Logo: "CFC" in Syne 800, color #F5C230, letter-spacing 3px
Nav items: DM Sans 11px, weight 500, color #666
Active nav: color #fff, font-weight 700, border-bottom 2px solid #F5C230
```

**No rectangles, pills, or backgrounds on nav items.** Active state is a yellow underline only. Inactive items are plain unstyled text.

### Bottom Ticker

```
Background: #3366CC
Separator dots: 6px circles, #F5C230
Text: 11px, color rgba(255,255,255,0.7)
Highlighted names: color #fff, font-weight 600
```

---

## Page: Team HQ

### Hero Block

A split-panel card with the team's season summary.

**Left panel** (`#3366CC` blue):
- Team name: 11px uppercase, letter-spacing 2px, `rgba(255,255,255,0.5)`
- Record: 64px JetBrains Mono 800, white, letter-spacing -4px
- Rank tag: 11px, red (`#E8503A`) fill, white text, 2px ink border, `border-radius: 4px`

**Right panel** (`#1A1A1A` ink):
- Stat rows with label on left, value on right
- Labels: 11px uppercase, `#999`, font-weight 600
- Values: 18px JetBrains Mono 700, each a different color (see stat value colors above)
- Row dividers: `1px solid #2a2a2a`

The hero block gets the full treatment: `2.5px solid #1A1A1A` border, `12px` radius, `4px 4px 0 #1A1A1A` shadow.

### Section Dividers

```
[Red Tag] ——————————————————————
```

- Tag: 11px DM Sans 800, uppercase, letter-spacing 1px, `#E8503A` fill, white text, `border-radius: 4px`, `2.5px` ink border, `2px 2px 0` shadow
- Line: `2.5px solid #1A1A1A`, fills remaining width
- Use `display: flex; align-items: center; gap: 8px`

### Depth Chart

Four horizontal swim lanes, one per position.

**Position Label** (left column, fixed 56px width):
- Full position-colored fill (red/blue/yellow/ink)
- Position name: 14px DM Sans 800, centered
- League rank below: 9px, 60-70% opacity
- `border-radius: 8px`, `2.5px` ink border, `3px 3px 0` shadow
- **Must match the height of the player cards** in its row — use `align-items: stretch` on the flex row

**Player Card Rail** (scrolls horizontally):
- Cards are `150px` wide, fixed
- `overflow-x: auto` on the rail, hide scrollbar with `::-webkit-scrollbar { height: 0 }`
- `gap: 8px` between cards
- Starters appear first (ordered by points/value descending), then bench players

### Player Cards

**Starter cards:**
```
┌──────────────────┐
│ [Starter]  24.3  │ ← chip (position color) + score (mono 20px 700)
├══════════════════┤ ← 3px color bar (position color)
│ J. Burrow        │ ← name (DM Sans 12px 600, ink)
│ CIN              │ ← team (10px, muted)
└──────────────────┘
```
- Border: `2.5px solid #1A1A1A`
- Shadow: `3px 3px 0 #1A1A1A`
- Background: `#FEFCF9`
- Starter chip: position color fill, white text (ink text for WR/yellow), 8px uppercase DM Sans 700, `border-radius: 3px`, `1.5px` ink border
- Score: JetBrains Mono 20px 700, ink color, top-right
- Color bar: 3px tall, full width, position color

**Bench cards:**
- Border: `2px solid #C8C3B8` (muted, NOT ink)
- Shadow: `none`
- No starter chip (leave empty space or a 1px spacer)
- Score + name text: `#8C7E6A` (muted)
- Color bar: 3px tall, `#C8C3B8` (muted)
- Background: `#FEFCF9`

### AI Copilot Card

```
┌──┬──┬──┬─────────────────────────────┐
│  │  │  │ [AI Icon] COPILOT           │
│R │Y │B │ Bold insight text here.     │
│E │E │L │ Regular detail text.        │
│D │L │U │ [Chip] [Chip] [Chip]        │
│  │L │E │                             │
└──┴──┴──┴─────────────────────────────┘
```

- Three vertical stripes on the left: red (`#E8503A`), yellow (`#F5C230`), blue (`#3366CC`), each `10px` wide
- Body: `#FEFCF9` background, `12-14px` padding
- AI icon: 20px circle, `#1A1A1A` fill, `#F5C230` text ("AI"), `1.5px` ink border
- Title: 11px DM Sans 800, uppercase, `#E8503A`, next to icon
- Message: 13px DM Sans 400, ink color. Key phrases bolded (`font-weight: 700`) in `#E8503A`
- Chips: 10px DM Sans 600, `#F5F0E6` fill, `2px` ink border, `border-radius: 4px`
- Card: `2.5px` ink border, `10px` radius, `4px 4px 0` shadow
- Layout: `display: grid; grid-template-columns: 10px 10px 10px 1fr`

---

## Component Reference

### Buttons

**Primary:**
```
bg: #3366CC, color: white
border: 2.5px solid #1A1A1A, radius: 8px
shadow: 4px 4px 0 #1A1A1A
font: DM Sans 500
+ interactive shadow shift
```

**Secondary:**
```
bg: #FEFCF9, color: #1A1A1A
border: 2.5px solid #1A1A1A, radius: 8px
shadow: 4px 4px 0 #1A1A1A
+ interactive shadow shift
```

**Danger:**
```
bg: #E8503A, color: white
border: 2.5px solid #1A1A1A, radius: 8px
shadow: 4px 4px 0 #1A1A1A
+ interactive shadow shift
```

**Accent/CTA:**
```
bg: #F5C230, color: #1A1A1A
border: 2.5px solid #1A1A1A, radius: 8px
shadow: 4px 4px 0 #1A1A1A
+ interactive shadow shift
```

### Inputs

```
bg: #FEFCF9, color: #1A1A1A
border: 2.5px solid #1A1A1A, radius: 8px
padding: 8px 12px
font: DM Sans 400
placeholder: #8C7E6A
focus: ring 2px #3366CC, ring-offset 2px
```

### Chips / Tags

```
font: DM Sans 10px 600
padding: 4px 10px
border: 2px solid #1A1A1A
border-radius: 4px (NEVER pill-shaped)
background: #F5F0E6 (canvas)
color: #1A1A1A
```

Interactive chips get the shadow shift treatment with `2px 2px 0` shadow.

### Modals / Drawers

```
bg: #FEFCF9
border: 2.5px solid #1A1A1A
border-radius: 12px
shadow: 6px 6px 0 #1A1A1A
padding: 20-24px
```

Title in Syne 700. Overlay backdrop at `rgba(0,0,0,0.4)`.

### Toasts / Alerts

```
Success: bg #3366CC, color white
Error: bg #E8503A, color white
Warning: bg #F5C230, color #1A1A1A
border: 2.5px solid #1A1A1A, radius: 8px
shadow: 3px 3px 0 #1A1A1A
```

### Stat Cards (Full Color Fill)

When stats appear as standalone cards (not inside the hero block), they get full color backgrounds:

```
bg: position or semantic color
border: 2.5px solid #1A1A1A
border-radius: 10px
shadow: 3px 3px 0 #1A1A1A
```

- Label: 10-11px uppercase, lighter opacity of the fill color
- Value: 22-28px JetBrains Mono 800, white (or ink on yellow)
- Optional footer bar: `#FEFCF9` background with context text in `#8C7E6A`

---

## Text Color Rules

| Background | Primary Text | Label Text |
|-----------|------------|-------------|
| `#E8503A` (red) | White | `rgba(255,255,255,0.7)` |
| `#3366CC` (blue) | White | `rgba(255,255,255,0.7)` |
| `#F5C230` (yellow) | `#1A1A1A` | `rgba(26,26,26,0.5)` |
| `#1A1A1A` (ink/black) | White or `#F5C230` | `#999` minimum |
| `#F5F0E6` (canvas) | `#1A1A1A` | `#8C7E6A` |
| `#FEFCF9` (card) | `#1A1A1A` | `#8C7E6A` |

---

## Absolute Rules (Never Break These)

1. **No gradients.** Flat fills only. Everywhere. Always.
2. **No blurred shadows.** Shadows are always solid offset with `#1A1A1A`.
3. **No pill shapes** on chips, tags, or buttons. `border-radius: 4px` max for small elements.
4. **No dark mode.** This is a light-only app.
5. **Canvas is the background, not white.** Main content bg is always `#F5F0E6`. White (`#FEFCF9`) is for cards sitting on top.
6. **Stats use JetBrains Mono.** Points, records, rankings, percentages, counts — always mono.
7. **Headlines use Syne bold.** Page titles, hero numbers, section headers.
8. **Everything else uses DM Sans.** Body, labels, buttons, nav, inputs, player names.
9. **Borders are visible.** `2.5px solid #1A1A1A`. No subtle or transparent borders on primary elements.
10. **Nav active state is an underline.** `border-bottom: 2px solid #F5C230`. No highlighted backgrounds, no pills, no rectangles.
11. **Starter vs. bench is shown through elevation.** Starters: ink borders + shadow + position-colored starter chip. Bench: muted borders + no shadow + no chip + muted text.
12. **AI copilot always has the 3-stripe left edge.** Red, yellow, blue — left to right. The "80s stripe."
13. **Every clickable element with a shadow shifts on interaction.** Translate toward shadow on hover, fully collapse on press.
14. **Position colors are sacred.** QB=red, RB=blue, WR=yellow, TE=black. Used consistently everywhere.

---

## File Structure

```
src/
  styles/
    globals.css              ← Tailwind theme, @font-face, CSS vars
  components/
    ui/
      Button.tsx
      Card.tsx
      StatCard.tsx
      Input.tsx
      Chip.tsx
      Modal.tsx
      Toast.tsx
      SectionDivider.tsx     ← red tag + ink line
    layout/
      TopBar.tsx             ← black bar, logo, nav with underline
      TickerBar.tsx          ← blue bar, activity feed
      PageShell.tsx          ← wraps TopBar + content + Ticker
    roster/
      PositionLabel.tsx      ← colored position block (QB/RB/WR/TE)
      PlayerCard.tsx         ← starter/bench variants
      DepthChart.tsx         ← position rows with horizontal rails
    team/
      HeroBlock.tsx          ← split record/stats card
    ai/
      CopilotCard.tsx        ← 3-stripe AI card
      HistorianChat.tsx
```

---

## How to Use This Document

When asked to build or restyle anything:

1. Read this file first. The whole thing.
2. Use the exact hex values and spacing from this doc.
3. Check against the 14 "Absolute Rules" before finishing.
4. When in doubt: thick black borders, solid offset shadows, flat bold fills, DM Sans for UI, JetBrains Mono for numbers, Syne for headlines, `4px` radius on small elements, `8px` on medium, `12px` on cards.