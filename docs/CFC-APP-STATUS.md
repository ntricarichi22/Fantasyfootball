# CFC Front Office — Preferences & Non-Negotiables

**Last Updated:** May 13, 2026

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
- Don't provide long, multi-step responses. Keep it tight and guide the conversation, focusing on one thing at a time. Never ask for decisions on more than one thing at time.

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
- Closer: 0.80–1.0 (the persona is 'always pay extra to get the deal done')
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
| Red | #E8503A | Destructive actions, untouchable chip, red urgency chip |
| Yellow | #F5C230 | AI elements, offer card borders, alerts, yellow urgency chip |
| Muted | #8C7E6A | Secondary text, timestamps, labels |
| Green | **#019942** | Moveable chip, "In the range" grade, green urgency chip — universal green across the entire app |
| Purple | #7A4BC9 | Swap suggestion badge in AIAdvisor |

**Note:** Green was previously #007370. As of the May 12, 2026 master design session, all green usages across the app standardize on #019942. This is a universal swap — Moveable chip, "In the range" grade, the door-level green urgency chip, and any other green usage all read with #019942.

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

**Studio:** uses neutral `gradeFromVerdict` because offers are already filtered to the user's chosen persona. Verdict → label + color:

| Verdict | Label | Color |
|---------|-------|-------|
| MASSIVE_FAVOR_USER / STRONG_FAVOR_USER | "Too good to be true" | Red (#E8503A) |
| SLIGHT_FAVOR_USER | "You're coming out on top" | Yellow (#F5C230) |
| FAIR | "In the range" | Green (#019942) |
| SLIGHT_FAVOR_OTHER | "Slight overpay" | Yellow (#F5C230) |
| STRONG_FAVOR_OTHER / MASSIVE_FAVOR_OTHER | "No chance" | Red (#E8503A) |
| RECV_ONLY | "Add your pieces" | Yellow |
| SEND_ONLY | "Pick your targets" | Yellow |

**Builder:** uses `personaAwareGrade` so the chip respects the partner's accept band. Inside partner's band → green ("In the range"). Outside band → falls back to neutral grading. Example: a +12% deal grades green with a Closer (band goes to +15%) but yellow with a Straight Shooter (band caps at +10%).

---

## Urgency Tier System — Non-Negotiables (May 12, 2026)

The home screen's three director doors (Scouting, Pro Personnel, Research & Strategy) use a unified three-tier urgency system. The GM box has no tier — it's the user.

### Three Tiers
| Tier | Color | Hex | Meaning |
|------|-------|-----|---------|
| Default / All clear | Green | #019942 | Normal state, nothing pressing |
| Attention | Yellow | #F5C230 | Something approaching or unresolved |
| Urgent | Red | #E8503A | Needs action now |

### Universal Rules
- **All three director doors can hit any tier.** No door is locked out of red. 
- **Green chip is always rendered.** Default state shows the green chip; absence of a chip is not a state. 
- **Highest tier wins.** A door's tier = the highest tier of any item on that door's landing. One red card → red door.
- **Chip lives only on the home screen door display.** Inside rooms, urgency is conveyed by surface-specific UI (card-level chips on the wall, aged indicators in the inbox, live countdown in War Room). No mandated door-level chip once past the threshold.
- **Trigger rules per door** are defined in each door's spec (see Section 7 of `CFC-HOME-SCREEN-SPEC.md` for the table).

---

## Card System — Non-Negotiables (May 12, 2026)

The card system is one of the universal foundations of the app. Every place in the app that displays a discrete unit of director-curated content or user-editable settings uses a card from one of five templates. They share visual language; their shapes differ by content and surface.

### Five Templates

#### 1. Player Card
Topps-style for a player or asset with a portrait.
- **Front:** photo, name, position/team/age, marker chips (STUD / YOUTH / AGING), state stamps where applicable, optional memo corner if the director has a note, universal action button at the bottom.
- **Back:** the action, editor, or follow-up that the action button promised.
- **Used by:** R&S Wall (player-anchored findings), R&S Set Availability, Pro Personnel Acquire/Shop cards (Topps card of the target/own player), Scouting (Rankings drift, Trade up/down intel when player-anchored), Scouting War Room (Scout's Take during live draft — see exception in §Scout's Take Card).

#### 2. Memo Card
Uniform *"Re: ..."* aesthetic for findings about anything other than a single player — topics, positions, picks, teams, strategy, league events.
- **Front:** subject chrome (*"Re: ..."*), director's headline in quotes, optional supporting line, optional memo corner, universal action button at the bottom.
- **Back:** the action / editor / follow-up.
- **Used by:** R&S Wall (position misalignment, wants more suggestion, championship comparison when not player-anchored), Scouting (Rankings reminders, Trade up/down intel when not player-anchored).

#### 3. List Card
One card holding multiple rows, drill-in by row.
- **Front:** card-level identity (e.g., round chrome) + N rows, each a compact data row with its own state stamp + edit affordance.
- **Back:** per-row editor for the tapped row.
- **Used by:** R&S Set Availability Pick Card (round-grouped picks, each row a specific pick).
- **Note:** List Card is now only used for management surfaces. It is no longer used for landing pages (the binder grid pattern replaces it there).

#### 4. Selector Card
Small cards expressing a choice / state.
- **Front:** identity stamp + current state + universal action button (*"Edit"* or *"Toggle"*).
- **Back:** the choice mechanism — picker / toggle / multi-button. Selecting → flip back with a confirmation stamp.
- **Used by:** R&S Set Strategy (Wants More 4 cards, Position Market 4 cards), GM Office (Persona 4 cards).
- **Quip:** all Selector Cards can carry a director quip except Persona. Persona is the only template that is quip-free.

#### 5. Hero Card
Single-sided cycler card, no flip. The exception to the universal flip pattern.
- **Front only:** persona toggle, prev/next arrows, current deal as send/receive grid, AI advisor prose, balance chip, 3 buttons (*Pass* / *Edit* / *Make this offer*), counter (1/5).
- **Used by:** Trade Studio Shop Around (the cycler IS this card). No flip; navigation happens via prev/next inside the card.
- **Where Hero Card does NOT appear anymore:** Pro Personnel landing. The old "Director's Pick" hero card on the PP landing was killed; PP landing now uses individual Acquire and Shop cards (Player Card variants).

### Universal Flip Pattern
Every two-sided card uses the same mechanic:
- Front = Topps-style identity / content + universal action button at the bottom (*"Tap to view"* / *"Tap to update"* / *"Edit"* / *"Toggle"*).
- Back = the action / editor / follow-up.
- Tap the action button → 3D rotateY flip, ~300ms ease-out.
- **Inline edit:** flip → make change → DONE stamp lands → card slides off the surface. Next card promotes in.
- **Route-out:** flip → navigate. The card is absent on return.
- **Dismiss:** flip + slide. Every action carries flip vocabulary; deferral is the one motion that may slide without flipping (per-surface choice).
- **Mobile:** small X top-right of the back closes the flip without committing. While a card is flipped on mobile, page-level scroll locks.

Selector Cards do edit-on-back even though it's a 2-tap change (one to flip into edit, one to commit the change). Friction is accepted for system consistency.

### Memo Corner Indicator
Small folded-paper corner peeking out of any card the director has attached a note to. Icon only — no *"Re:"* text inside the indicator itself.
- **Tap (or hover, build-time decision)** → popover reveals the director's full note.
- **Travels with the player.** Same memo corner pattern across all surfaces — Roster Player Card on Set Availability, Top Targets row, Wall card, anywhere the same player appears.
- **Absence = clean card.** When the director has no note attached, no memo corner is rendered.
- Acts as connective tissue between the director's findings (the Wall) and the rest of the app — a Mahomes card on Set Availability with a memo corner is the same Mahomes the director was just briefing on.

---

## Voice & Authorial Rules — Non-Negotiables (May 12, 2026)

Each director door has two voices: the director's voice (on cards, briefings, headlines) and the staff voice (in the chat). The split mirrors how a real front office works: the director presents conclusions; staff pulls data.

### Cast of Voices Per Door

| Door | Director (cards, briefings) | Staff (chat) |
|------|------------------------------|--------------|
| Director of Scouting | Director of Scouting | College Scout |
| Director of Pro Personnel | Director of Pro Personnel | Pro Scout |
| Director of Research & Strategy | Director of R&S | Research Analyst |
| General Manager (GM Office) | n/a (user is the GM) | n/a |

### Director Voice (cards, briefings, headlines)
- **First person, "we" voice.** Always "our roster," "our pick," "we should." Never "you" or "your."
- **Real director voice with lead-ins.** Briefings are conversational, ~30–50 words, addressing the GM directly. Lead-ins like *"Boss, …"* or *"Three things I want your read on …"* are encouraged.
- **Has a point of view.** Director doesn't just report; they imply or recommend action.
- **In quotes.** Director's voice is rendered in quotation marks on cards and briefings, signaling that it's spoken language.
- **Director examples:**
  - Scouting (red, draft live): *"Boss, we're on the clock. Let's go."*
  - Scouting (yellow): *"We have Mendoza in our Top 5 but his stock is sliding. Let's revisit our board."*
  - Pro Personnel (red): *"Founders have been waiting three days. Time to give them an answer."*
  - R&S (red): *"Its been 37 days since we updated our strategy. Worth a refresh"*
  - All quiet (green): *"Nothing pressing, boss. Settle in."*

### Staff Voice (chat)
- The chat panel on each door's landing speaks with the staff role — College Scout / Pro Scout / Research Analyst.
- Identity is carried by the **input placeholder** in muted italic DM Sans (#8C7E6A):
  - R&S → *"Ask the Research Analyst…"*
  - Pro Personnel → *"Ask the Pro Scout…"*
  - Scouting → *"Ask the College Scout…"*
- No separate header label above the chat panel. Tabs (Active / History) sit at the top; the placeholder carries the role identity.

### Chat Opener Chips (locked per door)
Three chips per door appear in the empty Active state. They fade out when a conversation starts. History tab never shows chips. Clicking a chip autofills the input (does not auto-send).

| Door | Chip 1 | Chip 2 | Chip 3 |
|------|--------|--------|--------|
| R&S Research Analyst | *"How does my roster compare to last year's title teams?"* | *"What's my biggest roster weakness?"* | *"Who's won the most CFC championships?"* |
| Pro Personnel Pro Scout | *"Which teams might trade a first?"* | *"Who's hot in the trade market?"* | *"Which GMs are easiest to deal with?"* |
| Scouting College Scout | *"Compare two prospects for me"* | *"Who'll likely be there at my pick?"* | *"Who's rising on draft boards?"* |

Note Scouting uses "prospects" not "players."

### Empty State Voice Rules
- **Director-owned surface (landing with no cards, empty queue):** director's voice. Acknowledge the calm + optional non-urgent CTA. Examples:
  - PP: *"Quiet out there. I'll keep watching."*
  - R&S: *"Roster's set, signals are clean. I'll flag anything that shifts."*
  - Scouting: *"Board's locked. We're ready."*
- **Staff-owned surface (chat History tab empty, etc.):** system voice, neutral. *"No saved conversations yet."*
- **Neutral surface (GM Office Inbox, Trade screens):** system voice. No director owns the surface, so no director quip.
- **Settings screens (Set Availability, Set Strategy):** N/A. State always exists.

---

## Landing Page Pattern — Non-Negotiables (May 12, 2026)

All three director landings (Pro Personnel, R&S, Scouting) share one layout template.

### Desktop (≥768px)
- **Top:** action buttons + page title row.
- **Main area (~70%):** **trading card binder grid, 3 columns, multiple rows visible.** Each card ~280×392 (5:7 playing card ratio). 6–9 cards visible at a glance.
- **Persistent chat right rail (~30%).**
- **Click a card** → flips in place to reveal options / back content. No reflow, no modal.
- Scroll vertically for more cards below the fold. Native browser scroll affordance — no custom indicators.

### Mobile (<768px)
- **Top:** InnerTopbar (hamburger / logo / settings).
- **Pinned action buttons** below the topbar.
- **Middle:** one card at a time, horizontal swipe between cards. Dots indicator at the bottom of the card area.
- **Bottom:** chat input pinned. Tap → full-screen takeover for the chat.
- **Peek of the next card is killed on mobile doors.** Dots are the only swipe signal.
- **Scroll lock:** while a card is flipped on mobile, page-level scroll locks.

### Chat Panel (every director landing)
- **Desktop:** persistent right rail (~30%). Tabs (Active / History) at the top. Conversation thread below. Input pinned at the bottom of the panel. Empty Active state shows 3 opener chips (see Voice & Authorial Rules).
- **Mobile:** single-line pinned input at the bottom of the landing. Tap → full-screen takeover with the same Active / History tabs and the 3 opener chips in the empty state. Close → returns to the landing.

---

## Door Display Pattern — Non-Negotiables (May 12, 2026)

Director door boxes on the home screen surface **one thing at a time** — the single most critical item from that door's lens queue. Pattern A from the master design session, generalized.

### Composition
- **Nameplate chrome** at the top of the box. Carries the door title and the urgency chip. No internal title in the box body.
- **Icon placement TBD** at mockup — small in nameplate alongside title, or larger as body graphic. Lean nameplate.
- **Body:** real director voice briefing, ~30–50 words, in quotes. Conversational, "our" possessives, lead-ins like *"Boss, …"*.
- **Contextual action button** below the briefing — shortcut to the briefing's destination. Present only when something pressing surfaces. Green state has no action button.

### Two click paths
- Click the door body → land on the door's landing page (full binder grid / queue).
- Click the action button → go directly to the critical destination (the draft room, the inbox thread, the Set Strategy screen, etc.).

### Example states
| Door | Tier | Briefing | Action button |
|------|------|----------|---------------|
| Scouting | Red | *"Boss, we're on the clock. Let's go."* | Enter the draft room |
| Scouting | Yellow | *"Our board hasn't been updated in 12 days and Mendoza's stock is sliding. Let's get in there."* | Set rankings |
| Pro Personnel | Red | *"Founders have been waiting three days. Time to give them an answer."* | Open thread |
| R&S | Red | *"Strategy's gone 37 days. Worth a refresh before the deadline."* | Set strategy |
| Any | Green | *"Nothing pressing, boss. Settle in."* | (no button) |

---

## Animation Patterns — Non-Negotiables (May 12, 2026)

All transitions ease-out (no bounces or springs — neobrutalist restraint). All animations respect `prefers-reduced-motion`.

| Pattern | Duration | Notes |
|---------|----------|-------|
| Card flip | ~300ms | 3D rotateY, ease-out |
| Stamp + slide-off | ~600ms total | Stamp lands (~200ms), brief pause, card slides laterally off (~300ms), next card slides in |
| Drawer open/close | ~250ms | Slides from its edge (right / left / bottom) |
| Modal open/close | ~200ms | Fade + slight scale-in |
| Popover open/close | ~150ms | Fade + scale from anchor point |
| Persona switcher cascade | ~300ms desktop / ~250ms mobile | Desktop: horizontal cascade. Mobile: vertical accordion |
| Mobile carousel swipe | CSS scroll-snap | No custom animation |

### Universal principles
- Ease-out for everything. No bounces.
- No fade-in flickers on initial page load. Content appears immediately.
- No skeleton loaders for fast loads; only show a loading state if > 500ms.
- Reduced motion preference: flip becomes instant fade, slides become instant moves, drawers/modals appear and disappear without motion.

---

## Modal / Drawer / Popover Inventory — Non-Negotiables (May 12, 2026)

Catalog of every persistent overlay surface and what it does. Anything not on this list shouldn't exist; if a new pattern is needed, decide here first.

### Drawers
| Element | Surface | Behavior |
|---------|---------|----------|
| Chat panel | Pro Personnel, R&S, Scouting landings | Persistent right rail on desktop (~30%); full-screen takeover on mobile triggered by pinned input |
| Insider drawer | GM Office landing | Slides in from the right of the content area on desktop; full-screen on mobile, triggered by Feed nav |
| Persona switcher cascade | GM Office landing | Reveal mechanism for the other 3 Persona Selector Cards. Desktop: horizontal cascade. Mobile: vertical accordion. Persona Cards inside use the universal flip pattern with a "Selected" confirmation stamp |
| Hamburger menu | Any landing or screen (mobile only) | Global nav drawer from left edge |
| Mobile bottom sheets | Scouting War Room (mobile) | Existing tab content for Roster / Asst GM / Trade |
| CounterDrawer | GM Office inbox thread screen | Compose counter offer. Inherited from the existing implementation; out of scope for the master design pass |

### Modals
| Element | Surface | Behavior |
|---------|---------|----------|
| Partner-picker | Trade Builder screen | *"Pick a trade partner"* search + 11-team list. Fires from empty +Add on the deal card. Blocks until a partner is selected |
| AcceptModal / RejectModal | GM Office inbox thread | Confirm accepting / rejecting an offer. Inherited from the existing implementation; out of scope for the master design pass |

### Popovers
| Element | Surface | Behavior |
|---------|---------|----------|
| Memo corner reveal | Any card with a memo corner indicator | Shows the director's full note when tapped (or hovered — desktop hover-vs-click settled at build time) |
| Trade Studio persona popover | Trade Studio offer card | Change the partner's assumed persona on that specific offer |

### Killed by the new system
- Pro Personnel "Confirm Modal" (the old *"While we have them on the phone…"* modal) — replaced by the universal card flip pattern.
- R&S Set Availability availability picker popover — moved to the back of the Player Card. The popover is gone; the tier picker lives on the card back.

---

## Section Divider Pattern — Non-Negotiables (May 12, 2026)

The SectionBar pattern (full-width black ink bar, white Syne text, with a horizontal rule extending right) persists across the app on **management screens**. It is NOT used on director landings.

- **Director landings (PP / R&S / Scouting)** — no section dividers. Landings are a single binder grid of cards, one section.
- **GM Office landing** — section dividers apply (Inbox / Insider / etc.).
- **R&S Set Availability** — keeps section dividers (QB / RB / Pass Catchers / Picks).
- **R&S Set Strategy** — keeps section dividers (Where we're going / Where we stand).
- **Trade Builder / Trade Studio screens** — keep existing section dividers.
- **Scouting War Room** — keeps existing section dividers (during draft).

---

## Scroll & Swipe Indicator Pattern — Non-Negotiables (May 12, 2026)

- **Mobile director landings (horizontal swipe through cards)** — dots indicator at the bottom of the card area. Peek of the next card is killed; dots are the only swipe signal.
- **Desktop binder grids** — native vertical scroll, no custom indicator.
- **Mobile vertical lists (inbox, insider feed, Set Availability roster)** — native vertical scroll.
- **Desktop vertical lists** — native vertical scroll.
- **Mobile flip state** — scroll locks on the page while a card is flipped.

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

### Offer Card UI (Hero Card template)
- Top row: "Deal shape as [Persona ▾]" + prev/next + "1 / 5" counter
- Team name row: partner team name on left, balance chip (label + color) on right — flex space-between
- Send/receive grid in dark blue (#185FA5) panel
- AI advisor prose
- Two secondary buttons: Pass (red border), Edit (black border)
- Primary CTA: "Make this offer" (blue filled, ink border with offset shadow)
- No "More like this" button — feature was removed
- This card now lives ONLY in Trade Studio Shop Around. The old "Director's Pick" version on the Pro Personnel landing is killed.

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

## Cross-Director Signal Flow — Non-Negotiables (May 12, 2026)

Directors talk to each other, but each surfaces cards whose actions live in their own domain. No duplicate cards across surfaces.

### Signal flow map
- **R&S → Pro Personnel:** aging, value drift, position market (selling) feed PP Shop cards. Wants more + position market (buying) feed PP Acquire cards.
- **R&S → Scouting:** wants more + position market feed Scouting Trade up/down intel relevance (*"we want studs, this class has 2 — worth moving up"*).
- **Scouting → Pro Personnel:** NO direct flow. Scouting's draft-related trade intel stays in Scouting (its actions route to Trade Builder, but the cards live on the Scouting landing).
- **R&S** generates settings signals only: aging, wants more, position market, value, availability tier.
- **Pro Personnel** consumes signals from R&S + its own league-scouting signals. All veteran trade cards live here.
- **Scouting** has its own internal signals (board state, rankings drift, class strength) + reads R&S's wants more for trade-intel relevance.

### Three concerns to track at build (deferred from master design session)
1. **Signal volume management.** Aging fires on many players continuously. Need prioritization so the user isn't flooded.
2. **Cooldowns / thresholds per signal.** When does a signal cross the line from "interesting" to "surface a card"?
3. **Multi-card from one signal.** If aging Mahomes fires both an R&S tier-update card AND a PP Shop card, decide if both fire or only one, and which takes priority.

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
