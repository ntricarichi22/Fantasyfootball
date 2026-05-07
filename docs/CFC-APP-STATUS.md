# CFC Front Office — Preferences & Non-Negotiables

**Last Updated:** May 7, 2026

---

## How Nick Works

### Process
- Ideate → mockup → iterate → code. Never jump ahead.
- "No mockup" means just talk. Nick will say when he's ready to see visuals.
- When mockups are requested, give 2-3 distinct options to mix and match.
- Don't present an overwhelming number of decisions at once. Work through them one at a time.
- Don't write code until Nick explicitly says to write code.
- Before writing ANY code, confirm you have everything you need. Ask questions first.

### Communication
- **Be concise. Tight. No hedging.** Short responses unless explicitly asked to dig in.
- No filler ("absolutely", "great question", "I agree"). No excessive caveats.
- Plain English, not jargon. Use real-world analogies (sports, business, apps).
- Nick pushes back fast. Don't take it personally — just adapt.
- If given a direction, run with it. Don't second-guess unless something is genuinely unclear.
- Don't give a wall of bullet points when a few sentences will do.
- Don't ask more than 2-3 questions at a time.

### One Step at a Time — IMPORTANT
- **Step-by-step.** One step at a time. Don't bundle multiple actions into a single response unless asked.
- **No multi-step responses.** When working through a problem, give ONE thing to do, wait for it to be done, then give the next thing.
- **Hold for ALL results.** When asking for multiple SQL queries or multiple tasks at once, **wait until everything is pasted back before reacting.** Don't comment on the first result while others are still in flight. Just say "Standing by" and wait.

### SQL Formatting
- **Each separate SQL query in its own code block.** Nick copies/pastes them individually. Don't bundle multiple queries into a single block.
- **Verification queries always separate from migration queries.** Different code blocks. Run the migration, see it succeed, THEN run verification.

### Code Delivery
- All code goes into downloadable .tsx / .ts / .sql files. Never markdown with code fences — raw code only.
- Full file replacements always. Nick never wants to hunt for specific lines.
- Keep files under 500 lines. If something gets big, split into logical sub-components.
- Tell the exact file path for each file (e.g. `src/components/gm-office/InboxPage.tsx`).
- Use `window.location.href` for navigation (not `router.push`) unless `router.push` is already explicitly used.

### Deployment
- Nick uses the GitHub web editor — can only commit one file at a time.
- Give files in the right order so each commit builds cleanly. Standalone components first, then files that import them, page wrappers last.
- If a deletion might break the build because something else imports it, warn and give the safe order.
- After database changes, give a verification query (in a separate code block).
- Build order: database changes → API routes → UI components. Foundation first.

### When Errors Happen
- Show the actual error message before guessing at fixes. If Vercel logs only show the status code, have Nick hit the URL directly to see the JSON response body.
- If a fix doesn't work the first time, **don't keep guessing**. Get more diagnostic info first.
- **NEVER guess at Supabase schemas or Sleeper player IDs.** Look it up. Don't invent.

---

## Trade Engine Architecture — Non-Negotiables (May 7, 2026)

### Single Source of Truth
- All gap math, grading, liquidity classification, post-trade warnings, and shape mismatch detection lives in `src/lib/trade/core/`.
- Builder (`src/lib/trade/advisor/`) and Studio (`src/lib/trade/studio/`) **both** call core/. They do not reimplement these primitives.
- If you find yourself adding a new gap calculation or grade derivation outside core/, stop. Put it in core/ and consume from there.

### Canonical Functions
- **`computeGap`** (in `core/gap.ts`) — given a deal's assets and rosters, returns sendValue / receiveValue / ratio / verdict / hasSend / hasReceive. Pure math, no side effects. **The single source of fairness signal.**
- **`gradeFromVerdict`** (in `core/gap.ts`) — verdict → chip label + color + bucket. Neutral grading.
- **`personaAwareGrade`** (in `core/gap.ts`) — same as above but knows partner persona's accept band. Builder uses this for the chip; Studio uses neutral grading because Studio offers are already filtered to the user's persona.
- **`parsePickKey`** (in `core/classification.ts`) — handles both 3-part future-year keys (`pick:YYYY-R-RID`) and 4-part current-year keys (`pick:YYYY-R-SS-RID`). Used everywhere — never re-implement inline.

### Persona Ratio Bands (defined in BOTH `core/gap.ts` and `studio/persona.ts` — keep in sync)
- Straight Shooter: 0.90–1.10
- Closer: 0.90–1.15
- Hustler: **1.00–99** (no upper cap — the persona is "always come out ahead")
- Architect: 0.90–1.10

### Threading Model
- One thread per deal proposal. Original offer + counter chain stay in one thread.
- New deal proposal (no `parent_offer_id`) → always create a new thread, even if there's an open thread between the same two teams.
- Counter (`parent_offer_id` set) → use the parent offer's thread.
- Two distinct proposals between the same teams = two threads = two cards in the inbox. Each can be accepted/declined/withdrawn/countered independently.

### Player-Quality Filters (Studio + Builder)
Applied uniformly in both Studio's candidate generator (`studio/candidates.ts`) and Builder's advisor receive pool (`advisor/engine.ts`):
- **Scrubs excluded.** Players who are none of stud, starter-level, or youth never enter the partner pool. (e.g., depth RBs, journeyman backups, aging non-starters.)
- **Youth-depth gated by buy markets.** Players where `isYouth=true && !isStarterLevel && !isStud` (typically rookies and 2nd-year filler) are included only if their position is in the user's `buy` markets. If the user has no buy markets, no youth-depth players appear and picks fill the value gap instead.
- **Max 1 youth-depth per receive set.** Anchors (studs + starters) and picks are unrestricted.

These rules are why the engine doesn't pad multi-asset offers with low-tier players. Don't loosen these filters without a clear product reason.

### Suggestion Shape (Builder)
- `assets[].direction` is per-asset (each asset specifies "send" or "receive")
- Top-level `kind` summarises ("send" / "receive" / "swap")
- Swap suggestions only emit when partner persona is Architect AND deal has both sides AND verdict isn't FAIR
- For Architect partners, single-asset suggestions are capped at 1 (vs. 3 for other personas) so swap/pick-heavy combos always have room in the slate

### Studio Offer Shape
- StudioOffer carries `valueGap` (full Gap object), `gradeLabel` (string), `gradeColor` (hex)
- FitScore (the old 5-component score) is gone. Single fairness signal = `valueGap.ratio`.
- "More Like This" feature is gone. Pass and Edit are the only secondary actions.
- For ML-training continuity, the `/api/trade-studio/feedback` endpoint synthesizes works_for_you / works_for_them from `valueGap.ratio` (formula: `85 + (ratio - 1) × 50`, clamped 0-100).

### Shared UI
- `TradeBalanceChip` (in `src/components/trade/shared/`) is used by both Builder and Studio. Don't fork it — both features need to look identical.

---

## Design System — Non-Negotiables

### Aesthetic
- Neobrutalist with Bauhaus restraint
- 2.5px solid borders (#1A1A1A)
- Offset box shadows (3-4px)
- No gradients, no rounded corners (border-radius: 0 everywhere)
- Colors are for emphasis only — don't make it look like a circus
- Topps trading card / vintage sports aesthetic is the vibe
- Bold, confident design with strong visual hierarchy. Things should be obvious, not learned.

### Color Palette
| Name | Hex | Usage |
|------|-----|-------|
| Ink | #1A1A1A | Primary text, borders, active tabs |
| Paper | #FEFCF9 | Card backgrounds, inputs |
| Cream | #F5F0E6 | Page backgrounds, secondary surfaces |
| Blue | #3366CC | Constructive actions, deal card bg (#185FA5 darker blue) |
| Red | #E8503A | Destructive actions, untouchable chip |
| Yellow | #F5C230 | AI elements, offer card borders, alerts |
| Muted | #8C7E6A | Secondary text, timestamps, labels |
| Green | #007370 | Moveable chip, "In the range" grade |
| Purple | #7A4BC9 | Swap suggestion badge in AIAdvisor |

### Availability Chips (Filled)
| Label | Color | Hex |
|-------|-------|-----|
| Moveable | Green filled | #007370 |
| Listening | Yellow filled | #F5C230 |
| Core | Black filled | #1A1A1A |
| Untouchable | Red filled | #E8503A |

All chips use white (#FEFCF9) text. All chips are the same fixed width (62px). Text is centered.

### Fonts
| Font | Weight | Usage |
|------|--------|-------|
| Syne | 800-900 | Headlines, tab labels, section headers |
| DM Sans | 400-800 | Body text, player names, buttons |
| JetBrains Mono | 700 | Data labels, chip text, metadata, timestamps |

### Grade Chip Logic (Persona-Aware)

**Studio:** uses neutral `gradeFromVerdict` because offers are already filtered to the user's chosen persona. Verdict → label + color:

| Verdict | Label | Color |
|---------|-------|-------|
| MASSIVE_FAVOR_USER / STRONG_FAVOR_USER | "Great deal for you" | Red (#E8503A) |
| SLIGHT_FAVOR_USER | "You're ahead" | Yellow (#F5C230) |
| FAIR | "In the range" | Green (#007370) |
| SLIGHT_FAVOR_OTHER | "You're reaching" | Yellow (#F5C230) |
| STRONG_FAVOR_OTHER / MASSIVE_FAVOR_OTHER | "Way off" | Red (#E8503A) |
| RECV_ONLY | "Add your pieces" | Yellow |
| SEND_ONLY | "Pick your targets" | Yellow |

**Builder:** uses `personaAwareGrade` so the chip respects the partner's accept band. Inside partner's band → green ("In the range"). Outside band → falls back to neutral grading. Example: a +12% deal grades green with a Closer (band goes to +15%) but yellow with a Straight Shooter (band caps at +10%).

---

## AI Advisor — Non-Negotiables

### Cardinal Rules
1. **NEVER disclose point values.** The AI uses values internally but must never mention specific numbers, percentages, ratios, or multipliers in its prose. Use natural language only: "significantly more valuable", "roughly equivalent", "nowhere near enough".
2. **NEVER say "accept."** The user is the PROPOSER. They can "send this", "pull the trigger", "this should work" — but they cannot accept.
3. **NEVER suggest players for the wrong side.** YOUR roster players → SEND suggestions only. THEIR roster players → RECEIVE suggestions only. Verify roster ownership before every suggestion.
4. **NEVER suggest assets the user wants to keep.** If user wants picks (picks_market = buy), don't suggest sending picks. If user is buying at WR, don't suggest sending WRs.
5. **Separate position needs from wants_more.** "Buying at WR" means wants MORE WRs. It does NOT mean wants elite WRs. The wants_more field (studs, youth, picks, depth) is separate and independent.
6. **Be honest about unrealistic deals.** If the gap is massive, say so. Don't say "sweeten slightly" when the deal needs to double. Suggest a 3rd team or a different target.
7. **Check stud availability.** When the other team wants elite_producers, check for [STUD] tags on the user's roster. If the only studs are untouchable, say that explicitly.
8. **Check asset type fit.** Even if values match, if the asset types don't match what the other team wants (e.g. offering picks to a team that wants studs), call it out.
9. **No filler.** Never use "you're right", "you're absolutely right", "I agree", "great question", "absolutely".
10. **Pre-interpret the gap.** The server computes the verdict (FAVORS USER / FAVORS OTHER TEAM / FAIR). The AI prose MUST agree with the verdict. Never contradict the chip.
11. **NEVER speak in raw DB terms.** Don't say "core at WR" or "marked as untouchable". Translate to natural language.
12. **NEVER say "building around your core" if the trade ships out core players.**
13. **Reference other team's personality/negotiation style** when relevant.
14. **Acknowledge tradeoffs naturally.**
15. **2-4 sentences, name actual players.**
16. **Describe swap suggestions as swaps.** When a suggestion's kind is "swap", describe both sides explicitly — e.g., "swap your 2026 2nd for their 2027 1st and Lamb." Don't collapse it into a one-direction phrasing.

### AI Suggestion Direction
- Suggestions are ALWAYS shown, regardless of gap size
- Gap sized to the suggestion: big gap → high-value suggestions, small gap → small sweeteners, zero gap → no sweetener (within 5% of fair = no suggestions)
- Direction: user getting more (good deal for them) → suggest THEIR assets to Send (sweeten for other side). User giving more → suggest OTHER TEAM's assets to Receive (get more back)
- Visual: "Send →" = blue filled chip, "← Receive" = blue outline chip, "↔ Swap" = purple filled chip (only for Architect partners)

### Value Lookups
- Player values: use `final_value` from `cfc_team_trade_values_current` for the team that owns the player
- Pick values: use `cfc_value` from `cfc_trade_values_current` via `display_name` lookup
- No client-side value adjustment functions — values come pre-adjusted from the database
- Stud: `elite_multiplier_applied > 1.0` in `cfc_trade_values_current`
- Youth: `age_multiplier_applied > 1.0` in `cfc_trade_values_current` (note: rookie 1.12, young 1.10)

---

## Trade Builder — Non-Negotiables

### Landing Page ("Who are you targeting?")
- Driven purely by MY preferences. Other teams' needs/wants are irrelevant to what appears
- Top 10 sorted by: MY needs first (position markets + wants_more), availability as secondary sort
- Both players AND picks appear equally — picks use picks_market for scoring via the same formula as players
- Section dividers: left-aligned black rectangle, line extends right (flush with search bar edges)
- Search searches all players AND all picks across all other teams (not just your own)

### Team Rankings (Landing Page)
Three-stage sort:
1. Do they have assets matching MY wants/needs? (primary)
2. Are their wants/needs complementary, not competing? (same wants = negative score)
3. Do I actually have what THEY want? (including untouchable assets)

### Roster Organization (Modal + Builder)
- Organized by POSITION, not availability tier
- Sections: AI Priority Targets (3-5 max) → QBs → RBs → Pass Catchers (WR+TE) → Draft Picks
- Within each section, sorted by value descending
- Every row gets a filled availability chip
- Priority target players ALSO appear in their position section below (dual listing)
- Priority targets additionally show availability chips

### Draft Pick Display
- Current year picks: show actual slot number ("2026 2.04")
- Future year picks: show generic ("2027 Rd 1") — no slot numbers
- Landing page: pick meta shows team ownership: "Draft pick · Virginia Founders (via Freaks)"
- Roster panel: pick meta shows "(via Freaks)" or "Draft pick" (no team name since you're already on that team)

### Draft Pick Exclusion
- CFC year = March 1 boundary (on/after March 1 → current calendar year)
- All picks from prior years: excluded entirely
- Current year picks: query `draft_log` — any `pick_number` with a `submitted_at` is spent and excluded
- Future year picks: all included, valued at middle slot (1.06 / 2.06 / 3.06)

### Deal Card
- 2-team: per-side "+Add from your roster" and "+Add from their roster" buttons. No universal +Add at bottom.
- 3-team: kill per-side buttons, show universal "+Add" at bottom that triggers team selection popup.
- 2-team auto-routing: tap your roster → auto-adds to "You send". Tap their roster → auto-adds to "You receive". No popup.
- 3-team: every tap triggers routing popup asking which team.
- **2-team row removal: 1-click.** Clicking anywhere on a deal-card row removes the asset. Small × icon shows visual affordance. No popover (reroute is meaningless with only two teams).
- **3-team row interaction: popover.** Clicking opens reroute options + remove.

### Team Nicknames in Tabs
- Everything AFTER the first word: "Virginia Founders" → "Founders", "Midwest Matzo Balls" → "Matzo Balls"
- NOT just the last word (would give "Balls" for Matzo Balls)
- Team-specific overrides exist in `TradeBuilder.tsx` (`TEAM_NAME_OVERRIDES` map) for teams whose nicknames don't follow the pattern (e.g., "Windy City Crossfitters" → "Crossfitters")
- 3-team tabs use dynamic font sizing so full nicknames always fit

### Suggestion Tap Behavior
- Iterate `suggestion.assets`, route each by its per-asset `direction`
- Same-direction suggestions populate one side of the deal
- Swap suggestions populate both sides at once (one asset to send, one to receive)
- Skip assets already in the deal

---

## Trade Studio — Non-Negotiables

### Persona Selection
- Driven by user's `gm_persona` from `cfc_team_strategy_profiles`, overridable via popover on offer card
- Persona toggle in offer card lets user re-roll the same partner with a different persona
- Persona ratio bands defined in `src/lib/trade/studio/persona.ts` — also mirrored in `core/gap.ts` for Builder's `personaAwareGrade`. Keep both in sync.

### Offer Card UI
- Top row: "Deal shape as [Persona ▾]" + prev/next + "1 / 5" counter
- Team name row: partner team name on left, balance chip (label + color) on right — flex space-between
- Send/receive grid in dark blue (#185FA5) panel
- AI advisor prose
- Two secondary buttons: Pass (red border), Edit (black border)
- Primary CTA: "Make this offer" (blue filled, ink border with offset shadow)
- No "More like this" button — feature was removed

### Deal-breakers (filtered out before slate)
- Partner untouchables in receive side
- AGING BENCH GUY in any deal asset (currently inert because client doesn't ship `isAging`; broader scrub filter handles the same case)
- Alarm-severity post-trade warnings (e.g., "you'd be left without a starter at QB")

### Slate Composition
- Up to 5 offers
- Pass 1: partner-unique (one offer per partner first)
- Pass 2: allow partner repeats to fill remaining slots
- No fallback — empty slate is the right answer when nothing fits the persona's ratio band

---

## Value Pipeline — Non-Negotiables

### Sources
- ONLY: FantasyCalc, KeepTradeCut, DynastyProcess. ALL using Superflex/2QB endpoints.
- Pick values: each source's own 1.01 pick value is the denominator. Computed multiple = `raw_value / source_1.01_value`.
- Pick values for app use stay locked to manually-set anchors in `cfc_assets.manual_override_value` (1.01=$300, 1.02=$250, etc.) — sources only inform player values, not pick values.

### League-Level Multiplier Stack
1. Source consensus (median of multiples × $300 anchor)
2. Position multiplier — QB/WR 1.00, TE tiered (1.00/0.85/0.70/0.50), RB tiered (1.00/0.97/0.95/0.92/0.88)
3. Elite multiplier — 1.20 above $300
4. Age multiplier — rookie 1.12, young 1.10, prime 1.00, aging 0.90
5. Per-player CFC scoring factor (last/prior 70/30 blend, 1.00 for rookies)
6. Manual override (escape hatch)

### Age Cutoffs (used at BOTH league and team level)
- QB: young ≤25, prime 26-32, aging 33+
- RB: young ≤23, prime 24-26, aging 27+
- WR/TE: young ≤24, prime 25-29, aging 30+

### Team-Level Modifier Stack (in `rebuildTeamTradeValuesForTeam`)
Three modifiers, additive, NO global cap (bounded by design):
1. **Studs** — +5% if `base_value > $250` AND `wants_more` includes "studs"
2. **Youth** — +5% young / -5% aging / 0 prime, only if `wants_more` includes "youth"
3. **Attachment** (per-player from `cfc_team_player_attachment`):
   - untouchable: +10%
   - core_piece: +5%
   - listening: 0%
   - moveable: -5%

Max stack: +20% (untouchable young stud). Min stack: -10% (aging moveable).

### Manual Overrides
- Stored as absolute dollar amounts in `cfc_team_player_value_overrides`
- NOT touched by cron — represent the user's stable signal of "what would I trade this player for"
- Override → `final_value` path is preserved
- UI should surface auto_value vs override delta when they drift (open item)

### What the Engine Uses for Gap Math
- **Player values:** team-specific. Each player's value comes from the owning team's `final_value` in `cfc_team_trade_values_current` — modifiers (studs, youth, attachment) baked in.
- **Pick values:** universal base CFC values from `cfc_trade_values_current` via `display_name` lookup.
- Both sides of any deal see the same gap because each asset is priced from its owner's view. One shared truth for the negotiation.

---

## Database — Non-Negotiables

- **NEVER guess at Supabase table schemas.** Always query `information_schema.columns` first and confirm before writing code that references tables.
- Don't assume column names exist. Don't assume data types. Ask first.
- After any database change, provide a verification query in a separate code block.
- Verification queries are ALWAYS separate from migration queries.

---

## General Non-Negotiables

- No rounded corners anywhere (border-radius: 0)
- No values displayed to users anywhere — AI speaks in relative terms only
- Navigation uses `window.location.href` (not router.push)
- Components use inline styles matching the neobrutalist system
- All components under 500 lines
- Files delivered as full replacements, one commit at a time
- Copy matters. Think like a real GM would talk, not a generic app.
