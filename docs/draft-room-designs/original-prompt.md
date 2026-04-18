# CFC Draft War Room — Original Kickoff Prompt

> Verbatim text of the original prompt that initiated the Draft War Room build.
> Preserved here so future sessions (which start with a fresh context window)
> have the exact source-of-truth instructions.

---

You are building the Draft War Room for the Cleveland Football Club (CFC) fantasy football app. This is a Next.js 16 / React 19 / TypeScript / Tailwind 4 / Supabase app deployed on Vercel. Repo: github.com/ntricarichi22/Fantasyfootball.

## Step 1: Read these files BEFORE writing any code

Read these in order. Do not start coding until you have read and understood all of them:

- **DESIGN_SYSTEM.md** (repo root) — the design bible. Every color, font, border, shadow, and component rule. Follow it exactly.
- **docs/draft-room-designs/draft-war-room-spec.md** — the complete design specification for every component, state, interaction, and animation in the draft war room.
- **Reference screenshots in docs/draft-room-designs/** — these show exactly what the final UI should look like. Match these pixel for pixel.
- **src/lib/llm/schema-context.ts** — this is the LLM's database brain. It documents every table in the Supabase database, including column names, types, and relationships. You will need this to understand the data layer.
- **src/lib/trade/profile.ts** — the `buildLeagueProfiles` function. Understand how it builds team strength/weakness profiles. You will use this for the "Fit" score and the "Team Needs" card.
- **src/lib/trade/starterLevel.ts** — the `computeCoreTeamStrength` function. Understand how it evaluates roster quality. Used alongside the profile logic.
- **The existing draft room component** — find the current monolithic draft room component (it's approximately ~80KB, likely in `src/app/` or `src/components/`). Understand what it already does before refactoring.

## Step 2: Key context about the draft

- This is a dynasty fantasy football league with 12 teams, active since 2019.
- The draft is a rookie draft — only incoming NFL rookies are eligible. The player pool is small (~20-40 prospects).
- The draft is 12 picks (1 round, 12 teams) for the standard rookie draft.
- Design aesthetic: Neobrutalism meets 1980s Topps baseball card packaging / Bauhaus geometric. Solid 2-2.5px black borders, solid offset shadows (never blurred), no gradients, no rounded corners, no pill shapes.

## Step 3: Build in this order

### 3.1 — Clock Bar

A segmented horizontal bar pinned under the top nav. All segments separated by vertical dividers (2px lines). Segments left to right: Franchise Name + chip, Rd, Pk, Timer (extra wide — pull Rd/Pk closer to franchise name to give the timer more breathing room), Action Button (always yellow `#F5C230`).

Three states:

| State | Bar background | Chip | Timer color | Action button text |
|---|---|---|---|---|
| Your pick + in draft room | `#E8503A` | "Your pick" | `#fff` | "Shop this pick" |
| Not your pick + in draft room | `#1A1A1A` | "On the clock" | `#F5C230` | "Trade up" |
| Any other page + draft active | `#1A1A1A` | "On the clock" | `#F5C230` | "Back to draft" |

Action button behavior:

- "Shop this pick" → navigates to Trade Center with the user's current pick pre-loaded on the trade block
- "Trade up" → navigates to Trade Center with context about targeting an earlier pick
- "Back to draft" → navigates back to the draft room

Timer: Counts down from 30:00 in MM:SS format. Data comes from the existing Supabase realtime draft state.

Global behavior: When a draft is active, this clock bar appears on EVERY page of the app (not just the draft room). Same for the draft ticker at the bottom.

### 3.2 — Draft Board (Table Layout)

The center of the screen. Background: `#F5F0E6` (Canvas).

Filter chips at the top: All (default), QB, RB, Pass Catchers (WR + TE combined), Rookie, Vet. Chips use Syne 700, uppercase. Active state fills with position color.

Table columns: `#`, `Pos`, `Player`, `School/Team`, `Type`, `Value`, `Fit`

Critical behaviors:

- Default view: ALL positions mixed, sorted by value/ADP ranking
- Drafted players are removed from the table entirely (not grayed out, not crossed out — gone)
- Rows are clickable — triggers the scouting card modal
- The table resizes when the roster panel slides in/out from the left

Where the data comes from:

- Player list and rankings: The existing draft room already pulls this from Sleeper. Find where the current component gets its player data and reuse that data source.
- The "Value" progress bar: Maps to whatever ranking metric currently sorts the board (likely Sleeper ADP or Sleeper's player rankings). Normalize to 0-100 scale where the #1 ranked player = 100.
- The "Fit" progress bar: This is personalized per owner. Call `buildLeagueProfiles` for the logged-in user's team, identify their positional weaknesses, and score each available player's fit against those weaknesses. A player at the owner's weakest position gets a high fit score. A player at a position they're already stacked at gets a low score. Normalize to 0-100.

### 3.3 — Player Card Modal (Scouting Card)

Animation: When a table row is clicked:

- The row visually "lifts" from the table
- Animates to center screen while growing to ~340x480px
- Simultaneously flips (CSS 3D `rotateY(180deg)`) to reveal the scouting card
- Dark overlay fades in behind (`rgba(26,26,26,0.6)`)
- Click overlay to dismiss (reverse animation)

Use `transform-style: preserve-3d`, `backface-visibility: hidden`, `cubic-bezier(0.4, 0, 0.2, 1)`, ~0.65s duration.

Scouting card content (back of card):

Left edge: Red/yellow/blue vertical stripe accent (5-6px wide, three equal sections).

Header (dark `#1A1A1A`):

- Player avatar: Check if Sleeper's API provides player images (typically at `https://sleepercdn.com/content/nfl/players/thumb/{player_id}.jpg`). Use silhouette placeholder if unavailable.
- Player name (Syne 700, 18-20px, white)
- Subtitle: `"{Position} · {School/Team} · {Rookie/Vet}"` (DM Sans, 12px, `#999`)

Stat boxes (row of 3): Age, Height, Weight — pull from Sleeper player data.

Three letter grades — here is exactly how to compute each one:

**Grade 1 — Draft Capital:** Map the player's actual NFL draft position to a letter grade:

- Picks 1-5: A+
- Picks 6-10: A
- Picks 11-20: A- (rest of round 1)
- Picks 21-40: B+ (round 2)
- Picks 41-64: B
- Picks 65-100: B-
- Picks 101-135: C+
- Picks 136-175: C
- Picks 176+: C-
- Undrafted: D

Display text: `"{NFL Team} · Round {X}, Pick {Y}"`

Where to get this data: Sleeper's player data includes `draft_round`, `draft_pick`, and `team` fields. If unavailable for incoming rookies pre-NFL-draft, show "TBD".

**Grade 2 — Situation:** Measures how good the offensive environment is. Logic by position:

For WR or TE rookies:

- Get the rookie's NFL team from Sleeper player data
- Query `cfc_team_trade_values_current` for QBs on that same NFL team
- Find the QB with the highest trade value
- Map that value to a letter grade:
  - QB trade value in top 5 league-wide → A+
  - Top 10 → A
  - Top 15 → B+
  - Top 20 → B
  - Below top 20 → C+
  - No QB with meaningful value → C
- Display text: Brief description + `"QB: {QB Name} ({tier})"`

For RB rookies:

- Get the rookie's NFL team
- Sum trade values of top offensive players on that NFL team as a proxy for offensive quality
- Map to letter grade using similar thresholds
- Display text: Brief description of offensive context

**Grade 3 — Opportunity:** Measures how clear the path to playing time is:

- Get the rookie's NFL team and position
- Query `cfc_team_trade_values_current` for players at the SAME position on that NFL team
- If no player at that position has meaningful trade value → A+ (wide open)
- If one high-value starter exists → B or C depending on value
- If multiple high-value players at position → D
- Display text: Who's ahead on depth chart, or `"No established {position} on roster. Clear path to {position}1 workload."`

**IMPORTANT:** All three grades must be pre-computed on page load for the top 20 ranked prospects. Store in React state/context. Modal opens instantly — no API calls on click.

"Draft This Player" button:

- Only visible when it is the logged-in user's turn to pick
- Red (`#E8503A`), white text, Syne 700 uppercase, neobrutalist border/shadow
- On click: submit the draft pick using existing pick submission logic from the current component

### 3.4 — Roster Panel

Slides from left edge. Board resizes (does NOT get overlaid).

Toggle: Persistent tab on left edge. Click to open/close.

Header: `#F5F0E6` background, NOT black. "My Roster" in Syne 700.

**Card 1 — Team Needs:**

- Call `buildLeagueProfiles` for the logged-in user
- Need bar per position: position badge + red progress bar + label ("Critical"/"Moderate"/"Low")
- Critical = major hole (empty slot, aging starters). Low = already strong.

**Card 2 — Lineup:**

- Traditional fantasy format: starters by slot (QB1, RB1, RB2, WR1, WR2, WR3, TE1, FLX)
- Match the league's actual starting requirements from settings
- Empty slots in red italic ("— empty")
- "Bench" divider, bench players below
- This card scrolls independently
- Data from existing Sleeper roster integration

### 3.5 — Assistant GM Panel

Fixed right side, always visible on desktop. ~160px wide.

Header: `#F5F0E6` background, NOT black. "Assistant GM" in Syne 800. Green dot + "Live".

Left edge: Red/yellow/blue stripe (4-5px, three equal sections), full height.

**Auto-triggered briefing card on page load:**

- Track user's last visit (cookie or Supabase user preferences)
- Query Supabase for draft picks since that timestamp
- Format "Since you left" section (pick list with pick number, position badge, player name, team)
- Generate "Trends" section via Anthropic API call

**Anthropic API setup for the Assistant GM:**

```typescript
const response = await fetch("https://api.anthropic.com/v1/messages", {
  method: "POST",
  headers: { "Content-Type": "application/json" },
  body: JSON.stringify({
    model: "claude-sonnet-4-20250514",
    max_tokens: 1000,
    system: `You are the Assistant GM for a dynasty fantasy football team called [TEAM NAME]. You are an expert dynasty analyst. Be concise and direct. You know this team's roster inside and out. Here is the current context:

TEAM ROSTER: [inject roster data]
TEAM NEEDS: [inject from buildLeagueProfiles]
DRAFT BOARD (available players): [inject available players with grades]
PICKS MADE SO FAR: [inject draft history]
IT IS CURRENTLY: [Team X]'s pick, Round [Y], Pick [Z]

Answer questions about draft strategy, player comparisons, and trade ideas. When recommending a pick, include a confidence percentage.`,
    messages: conversationHistory,
    tools: [{ type: "web_search_20250305", name: "web_search" }]
  })
});
```

**Recommendation card:**

- Yellow left accent (`#F5C230`, 4-5px)
- Player name (Syne 800), meta line, one-line rationale, confidence %
- Red "Draft This Player" button
- Generated from the same API call as the briefing trends

**Chat interface:**

- User messages: right-aligned, `#3366CC` bg, white text
- AI messages: left-aligned, `#F5F0E6` bg, `#1A1A1A` text
- Input at bottom, yellow send button
- Each message triggers Anthropic API call with full context + conversation history

### 3.6 — Draft Ticker

Fixed bottom. `#1A1A1A`, 34-38px. Auto-scrolls left. Replaces site-wide blue ticker during active drafts.

Each entry: yellow pick badge + player name (Syne 700) + colored position chip + team name (DM Sans, muted). Separated by 1px solid `#333`. Newest picks on the right.

Global: Appears on ALL pages during active drafts.

### 3.7 — Global Draft Mode

Layout-level: query Supabase for active draft. If active, render clock bar + ticker in root/shared layout on every page. When inactive, don't render.

### 3.8 — Mobile (below ~768px)

- Compressed clock bar
- Tab bar: Board | Roster | Asst GM (yellow border on active tab)
- Full-screen content for selected tab
- Ticker at bottom

Board tab: Slim table — Pos badge, Player name, Val/Fit bars. Filter chips scroll horizontally. Roster tab: Full-screen two stacked cards. Asst GM tab: Full-screen chat experience.

### 3.9 — Trade Integration

Yellow action button navigates to Trade Center with query params:

- Shop: `?mode=shop&pick={pickNumber}&round={round}`
- Trade up: `?mode=tradeup&targetPick={nextPick}`

If the Trade Center doesn't accept these params yet, add that capability.

## Step 4: Component architecture

Break the monolith into:

```
src/components/draft/
  DraftClockBar.tsx
  DraftTicker.tsx
  DraftBoard.tsx
  DraftBoardRow.tsx
  DraftFilterChips.tsx
  PlayerScoutingCard.tsx
  RosterPanel.tsx
  TeamNeedsCard.tsx
  LineupCard.tsx
  AssistantGMPanel.tsx
  DraftBriefingCard.tsx
  RecommendationCard.tsx
  AssistantGMChat.tsx
  DraftWarRoom.tsx           — parent page
```

Preserve from existing code: Supabase Realtime subscription, pick clock countdown, pick submission handler, Sleeper player data fetching.

State management:

- Draft state → Supabase Realtime + React context
- Player grades → pre-compute on load, store in context
- Panel open/closed → local state
- Filter selection → local state
- Chat history → local state
- Active draft → Supabase query in layout, context provider

## Step 5: Environment variables

Already configured:

- `NEXT_PUBLIC_SLEEPER_LEAGUE_ID`
- `NEXT_PUBLIC_SUPABASE_URL`
- `NEXT_PUBLIC_SUPABASE_ANON_KEY`
- `SUPABASE_SERVICE_ROLE_KEY` (server-side only)
- `ANTHROPIC_API_KEY`
- `LLM_DATABASE_URL` (port 5432)

## Step 6: Do NOT

- Rebuild the Trade Center
- Use rounded corners, gradients, blurred shadows, or pill shapes
- Put black backgrounds on roster or Assistant GM headers (use `#F5F0E6`)
- Gray out drafted players (remove them entirely)
- Make API calls on player card click (pre-compute everything)
- Create a separate trade UI in the draft room
