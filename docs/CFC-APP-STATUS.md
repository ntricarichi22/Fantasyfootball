# CFC Front Office — Preferences & Non-Negotiables

**Last Updated:** May 19, 2026
**Version:** 3.0 (chat-driven offices)

> **Revision note (v3.0):** Major architecture shift. Director landings as binder grids of lens-engine cards are killed. Each director door is now a **chat-driven office** — open the office, the director greets you with their top 3 POVs, the chat can surface inline actions (proposed trades, one-click setting commits, deep links to workrooms). Home screen becomes a clean menu of deep links to each director's workrooms. Inbox becomes the single "what's new" surface (Gmail-style rows, interleaved director memos + trade correspondence). Card system collapses from 5 templates to 3 (Player, Selector, Hero). Staff voices killed — each director is the only voice in their office. Urgency tier system killed.

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
- Don't give a wall of bullet points when a few sentences will do.
- Default cap: two paragraphs per response. If more is needed, flag x/y/z and let Nick decide.

### One Step at a Time
- One step at a time. Don't bundle multiple actions into a single response unless asked.
- When asking for multiple SQL queries or tasks at once, wait until everything is pasted back before reacting. Say "Standing by" and wait.
- Each separate SQL query in its own code block. Verification queries always separate from migration queries.

### Code Delivery
- All code goes into downloadable .tsx / .ts / .sql files. Never markdown with code fences — raw code only.
- Full file replacements always.
- Keep files under 500 lines.
- Tell the exact file path for each file.
- Use `window.location.href` for navigation (not `router.push`) unless `router.push` is already explicitly used.

### Deployment
- Nick uses the GitHub web editor — can only commit one file at a time.
- Give files in the right order so each commit builds cleanly.
- Build order: database changes → API routes → UI components.

### When Errors Happen
- Show the actual error message before guessing at fixes.
- If a fix doesn't work the first time, get more diagnostic info first. Don't keep guessing.
- **NEVER guess at Supabase schemas or Sleeper player IDs.** Look it up.

---

## App Architecture — The New Model

### Mental Model

The user is the General Manager of a dynasty fantasy football team. They report to nobody and three directors report to them: Director of Scouting (the draft), Director of Pro Personnel (trades), Director of Research & Strategy (settings + roster strategy).

The app is offseason-only. From the day after the championship through the night before Week 1. No lineup setting, no live scoring, no waiver claims.

### The Four Surfaces

1. **Home screen** — the org chart. Four boxes (GM + three directors). Each director box is a menu of deep links into that director's workrooms plus an entry into their office. The GM box previews the inbox unread count and clicks into the inbox. No briefings on the home screen. No urgency chips. No real-time computed previews.

2. **Inbox** — the only "what's new" surface in the app. Gmail-style row layout. Interleaved director memos (reminders, recaps, intel summaries) and trade correspondence (offers from other GMs, counters, threads). Click a row → body opens with full content + inline actions.

3. **Director's office** — chat-driven workspace, one per director. Open the office, the director greets you with their top 3 POVs as the opening message. Click an intel item or type your own question. The chat can surface inline actions (proposed trades with "Open in Builder" buttons, one-click setting commits, deep links to workrooms). Director's voice is first-person, conversational, anonymized when discussing other teams' private intel.

4. **Workrooms** — focused execution surfaces inside each director's domain. Scouting: Big Board, Draft Room, Mock Draft. Pro Personnel: Trade Builder, Trade Studio. R&S: Set Strategy, Set Availability. Reached via deep links from the home screen, from inline actions in the director's office chat, or from inbox memos.

### Cross-Director Signal Flow

Directors talk to each other through the user's settings, not through cards:

- **R&S → Pro Personnel:** R&S surfaces settings recommendations (drop player to Listening, flip position market to Selling). When the user commits, those signals show up in PP's chat as intel ("you said you want to sell at WR — three teams are buying").
- **R&S → Scouting:** wants_more + position market shape Scouting's trade-up/down intel relevance.
- **Scouting → Pro Personnel:** no direct flow. Scouting's draft-related trade intel stays in Scouting; its actions route to Trade Builder.

Same architecture as before. Different surfaces.

---

## Director Voice — Non-Negotiables

**One voice per door, the director themselves.** No staff (no College Scout, no Pro Scout, no Research Analyst). Killed in v3.0.

### Voice Rules
- **First person, "we" voice.** Always "our roster," "our pick," "we should." Never "you" or "your."
- **Conversational.** Real director voice, not bullet-point summary. Lead-ins like *"Boss, …"* or *"Word is …"* are encouraged.
- **Director has a point of view.** They lead with a recommendation. They don't just survey the user with open questions.
- **Anonymized intel.** The director can name teams as call-targets (*"Founders and Outlaws are worth a call"*) but stays vague about what other teams have on their boards (*"a couple teams behind us are high on him"*). Never says "Team X has him ranked 3rd." Never peeks behind the curtain.
- **No codespeak.** No "wants_more," no "position market," no "tier," no dollar values. Translate to natural language: "we said we want picks," "we're buying at WR," "Untouchable," "his stock popped."
- **Specific, never generic.** Razor-sharp insights from the closed-league data — what teams are buying/selling, who's in fire-sale or level-up mode, who's high on whom, what trades have just happened — anonymized when needed.
- **Conversation starter, not a report.** Every intel item ends with the director's recommendation and a CTA, not an open question to the user.

### Example pattern
**Signal → named target → director's recommendation → CTA**

> *"Founders just shipped Allen and their 2026 1st for picks and youth — full fire sale. Their WR room is loaded with guys we'd love. I'd start with Lamb and offer our 1st plus a depth piece. Want me to draft it up?"*

---

## Trade Engine Architecture — Non-Negotiables

### Single Source of Truth
- All gap math, grading, liquidity classification, post-trade warnings, and shape mismatch detection lives in `src/pro-personnel/trade-engine/core/`.
- Builder (`src/pro-personnel/trade-engine/advisor/`) and Studio (`src/pro-personnel/trade-engine/studio/`) **both** call core/. They do not reimplement these primitives.

### Canonical Functions
- **`computeGap`** (in `core/gap.ts`) — given a deal's assets and rosters, returns sendValue / receiveValue / ratio / verdict / hasSend / hasReceive. Pure math.
- **`gradeFromVerdict`** (in `core/gap.ts`) — verdict → chip label + color + bucket. Neutral grading.
- **`personaAwareGrade`** (in `core/gap.ts`) — same as above but knows partner persona's accept band. Builder uses this for the chip; Studio uses neutral grading because Studio offers are already filtered to the user's persona.
- **`parsePickKey`** (in `core/classification.ts`) — handles both 3-part future-year keys (`pick:YYYY-R-RID`) and 4-part current-year keys (`pick:YYYY-R-SS-RID`).

### Persona Ratio Bands (defined in BOTH `core/gap.ts` and `studio/persona.ts` — keep in sync)
- Straight Shooter: 0.90–1.10
- Closer: 0.85–1.00 (the persona is 'always pay extra to get the deal done')
- Hustler: **1.00–99** (no upper cap — the persona is "always come out ahead")
- Architect: 0.90–1.10

### Threading Model
- One thread per deal proposal. Original offer + counter chain stay in one thread.
- New deal proposal (no `parent_offer_id`) → always create a new thread.
- Counter (`parent_offer_id` set) → use the parent offer's thread.
- Two distinct proposals between the same teams = two threads = two cards in the inbox.

### Player-Quality Filters (Studio + Builder)
- **Scrubs excluded.** Players who are none of stud, starter-level, or youth never enter the partner pool.
- **Youth-depth gated by buy markets.** Youth-depth players included only if their position is in the user's `buy` markets.
- **Max 1 youth-depth per receive set.** Anchors (studs + starters) and picks are unrestricted.

### Suggestion Shape (Builder)
- `assets[].direction` is per-asset (each asset specifies "send" or "receive")
- Top-level `kind` summarises ("send" / "receive" / "swap")
- Swap suggestions only emit when partner persona is Architect AND deal has both sides AND verdict isn't FAIR

### Trade Builder + Trade Studio — Hero Card Cycler (NEW IN V3.0)

Both PP workrooms now use the same Hero Card cycler pattern. The director has 5 drafts ready when you open either workroom:

- **Trade Builder** — 5 acquisition drafts (director picks 5 trade angles based on wants_more + position_market_buying signals). User cycles through, edits, or hits Make this offer. "Build my own" button drops to blank builder.
- **Trade Studio** — 5 shop offers (same as today, generated from the block of players the user puts up).

When the user has no clear strategy signals (new league, hasn't set strategy yet), Trade Builder shows an empty state pointing to Set Strategy.

---

## Design System — Non-Negotiables

### Aesthetic
- Neobrutalist with Bauhaus restraint
- 2.5px solid borders (#1A1A1A)
- Offset box shadows (3-4px)
- No gradients, no rounded corners (border-radius: 0 everywhere)
- Colors are for emphasis only
- Topps trading card / vintage sports aesthetic is the vibe

### Color Palette
| Name | Hex | Usage |
|------|-----|-------|
| Ink | #1A1A1A | Primary text, borders, active tabs |
| Paper | #FEFCF9 | Card backgrounds, inputs |
| Cream | #F5F0E6 | Page backgrounds, secondary surfaces |
| Blue | #3366CC | Constructive actions, GM box bg, deal card bg (#185FA5 darker blue) |
| Red | #E8503A | Destructive actions, untouchable chip |
| Yellow | #F5C230 | AI elements, alerts, sender chips |
| Muted | #8C7E6A | Secondary text, timestamps, labels |
| Green | **#019942** | Moveable chip, "In the range" grade — universal green |
| Purple | #7A4BC9 | Swap suggestion badge in AIAdvisor |

### Availability Chips (Filled)
| Label | Color | Hex |
|-------|-------|-----|
| Moveable | Green filled | #019942 |
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

**Studio:** uses neutral `gradeFromVerdict`:

| Verdict | Label | Color |
|---------|-------|-------|
| MASSIVE_FAVOR_USER / STRONG_FAVOR_USER | "Too good to be true" | Red (#E8503A) |
| SLIGHT_FAVOR_USER | "You're coming out on top" | Yellow (#F5C230) |
| FAIR | "In the range" | Green (#019942) |
| SLIGHT_FAVOR_OTHER | "Slight overpay" | Yellow (#F5C230) |
| STRONG_FAVOR_OTHER / MASSIVE_FAVOR_OTHER | "No chance" | Red (#E8503A) |
| RECV_ONLY | "Add your pieces" | Yellow |
| SEND_ONLY | "Pick your targets" | Yellow |

**Builder:** uses `personaAwareGrade` so the chip respects the partner's accept band. Inside partner's band → green ("In the range"). Outside band → falls back to neutral grading.

---

## Card System — Non-Negotiables (REWRITTEN IN V3.0)

Three card templates. The five-template system from v2.x is dead.

### 1. Player Card
Topps-style for a player or asset with a portrait.
- **Front:** photo, name, position/team/age, marker chips (STUD / YOUTH / AGING), state stamps where applicable, optional memo corner, universal action button at the bottom.
- **Back:** the editor (tier picker + price adjuster + pick anchor toggles for Set Availability).
- **Used by:** R&S Set Availability (one card per roster player), R&S Set Availability Picks rail (one card per pick — see Pick Card Variant below), Hero Card cycler send/receive grid (Player Cards appear inside the Hero Card structure).

### 2. Selector Card
Small cards expressing a choice / state.
- **Front:** identity stamp + current state + universal action button (*"Edit"* or *"Toggle"*).
- **Back:** the choice mechanism — picker / toggle / multi-button. Selecting → flip back with a confirmation stamp.
- **Used by:** R&S Set Strategy (Wants More 4 cards, Position Market 4 cards), GM persona switching (if persona is retained — see GM Office spec).

### 3. Hero Card
Single-sided cycler card, no flip. The exception to the universal flip pattern.
- **Front only:** persona toggle, prev/next arrows, current deal as send/receive grid, AI advisor prose, balance chip, 3 buttons (*Pass* / *Edit* / *Make this offer*), counter (1/5).
- **Used by:** Trade Studio Shop Around AND Trade Builder (both workrooms now use the cycler).

### Pick Card Variant (Player Card template)
Each pick is its own card, individually swipable in the Picks rail of Set Availability. Card chrome shows the pick identifier (e.g., *"2026 2.04"*) plus contextual chips showing the user's other picks in that round (e.g., *"2 more in '26, 1 in '27, none in '28"*). Back of card = same editor as Player Card back.

### Killed in V3.0
- **Memo Card** — homeless after Wall + landing binder grids are gone.
- **List Card** — replaced by individual Pick Cards with contextual chips.

### Universal Flip Pattern
- Front = identity / content + universal action button at the bottom (*"Tap to view"* / *"Tap to update"* / *"Edit"* / *"Toggle"*).
- Back = the action / editor.
- Tap the action button → 3D rotateY flip, ~300ms ease-out.
- **Inline edit:** flip → make change → DONE stamp lands → card slides off the surface (where applicable, like Set Availability).
- **Mobile:** small X top-right of the back closes the flip without committing. Page-level scroll locks while a card is flipped on mobile.

Hero Card is the one exception (no flip — cycler).

### Memo Corner Indicator
Small folded-paper corner peeking out of any card the director has attached a note to. Icon only.
- Tap (or hover) → popover reveals the director's full note.
- Travels with the player. Same memo corner pattern across all surfaces the player appears.

---

## Killed in v3.0

A definitive list. If you find these in any spec or code reference, they are dead:

- **Lens engines on director landings.** No more lens-engine cards. Directors surface intel in chat.
- **R&S Wall** (binder grid landing of lens-engine cards). Replaced by R&S office chat.
- **Pro Personnel landing binder grid** (Acquire / Shop opportunity cards in a grid). Replaced by PP office chat + workrooms.
- **Scouting landing binder grid** (Rankings drift / Rankings reminders / Trade up-down intel cards). Replaced by Scouting office chat.
- **Top 10 players / top 10 teams landing on Trade Builder.** Replaced by Hero Card cycler with 5 director drafts.
- **Director briefings on the home screen.** Home screen is a clean menu.
- **Urgency tier system.** No green/yellow/red chips on director boxes. No tier computation at all.
- **Staff voices** (College Scout, Pro Scout, Research Analyst). Each director is the only voice in their office.
- **Memo Card template.** Card system is three templates only.
- **List Card template.** Replaced by individual Pick Cards with contextual chips.
- **GM Office sidebar** (Propose / Shop / Feed). Inbox is the whole GM Office. Deep links live on the home screen.
- **GM Office Propose popover** ("Scout Players or Scout Teams?"). Long dead.
- **Section divider pattern within director landings.** Landings don't exist.
- **PP Confirm Modal.** Long dead.
- **AssistantGmPanel as a staff role.** May survive as a renamed real-time draft assistant inside the Draft Room (build-time decision).

---

## AI Advisor — Non-Negotiables

### Cardinal Rules
1. **NEVER disclose point values.** No specific numbers, percentages, ratios, or multipliers in prose.
2. **NEVER say "accept."** The user is the PROPOSER. They can "send this", "pull the trigger", "this should work" — but they cannot accept.
3. **NEVER suggest players for the wrong side.** YOUR roster players → SEND suggestions only. THEIR roster players → RECEIVE suggestions only.
4. **NEVER suggest assets the user wants to keep.**
5. **Separate position needs from wants_more.** "Buying at WR" means wants MORE WRs, not elite WRs. wants_more is independent.
6. **Be honest about unrealistic deals.** If the gap is massive, say so. Suggest a 3rd team or a different target.
7. **Check stud availability.** When the other team wants studs, verify against [STUD] tags on the user's roster.
8. **Check asset type fit.** Even if values match, call out asset-type mismatches.
9. **No filler.**
10. **Pre-interpret the gap.** AI prose must agree with the verdict chip.
11. **NEVER speak in raw DB terms.** Translate "core at WR" to natural language.
12. **NEVER say "building around your core" if the trade ships out core players.**
13. **Reference other team's personality/negotiation style** when relevant.
14. **Acknowledge tradeoffs naturally.**
15. **2-4 sentences, name actual players.**
16. **Describe swap suggestions as swaps.**

### AI Suggestion Direction
- Suggestions are ALWAYS shown, regardless of gap size.
- Gap sized to the suggestion.
- Direction: user getting more → suggest THEIR assets to Send. User giving more → suggest OTHER TEAM's assets to Receive.
- Visual: "Send →" = blue filled chip, "← Receive" = blue outline chip, "↔ Swap" = purple filled chip.

### Value Lookups
- Player values: `final_value` from `cfc_team_trade_values_current` for the owning team.
- Pick values: `cfc_value` from `cfc_trade_values_current` via `display_name` lookup.
- No client-side value adjustment functions.
- Stud: `elite_multiplier_applied > 1.0` in `cfc_trade_values_current`.
- Youth: `age_multiplier_applied > 1.0` in `cfc_trade_values_current`.

---

## Value Pipeline — Non-Negotiables

### Sources
- ONLY: FantasyCalc, KeepTradeCut, DynastyProcess. ALL using Superflex/2QB endpoints.
- Pick values: each source's own 1.01 pick value is the denominator.
- Pick values for app use stay locked to manually-set anchors in `cfc_assets.manual_override_value` (1.01=$300, 1.02=$250, etc.).

### League-Level Multiplier Stack
1. Source consensus (median of multiples × $300 anchor)
2. Position multiplier — QB/WR 1.00, TE tiered, RB tiered
3. Elite multiplier — 1.20 above $300
4. Age multiplier — rookie 1.12, young 1.10, prime 1.00, aging 0.90
5. Per-player CFC scoring factor
6. Manual override

### Age Cutoffs
- QB: young ≤25, prime 26-32, aging 33+
- RB: young ≤23, prime 24-26, aging 27+
- WR/TE: young ≤24, prime 25-29, aging 30+

### Team-Level Modifier Stack
1. **Studs** — +5% if `base_value > $250` AND `wants_more` includes "studs"
2. **Youth** — +5% young / -5% aging / 0 prime, only if `wants_more` includes "youth"
3. **Attachment** (per-player):
   - untouchable: +10%
   - core_piece: +5%
   - listening: 0%
   - moveable: -5%

Max stack: +20%. Min stack: -10%.

### Manual Overrides
- Stored as absolute dollar amounts in `cfc_team_player_value_overrides`.
- NOT touched by cron.
- UI should surface auto_value vs override delta when they drift.

---

## Database — Non-Negotiables

- **NEVER guess at Supabase table schemas.** Query `information_schema.columns` first.
- Don't assume column names or data types.
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
