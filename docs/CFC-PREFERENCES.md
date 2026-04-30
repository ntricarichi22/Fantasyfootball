# CFC Front Office — Preferences & Non-Negotiables

**Last Updated:** April 29, 2026

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
- Be direct and concise. No over-hedging, no excessive caveats.
- Plain English, not jargon. Use real-world analogies (sports, business, apps).
- Nick pushes back fast. Don't take it personally — just adapt.
- If given a direction, run with it. Don't second-guess unless something is genuinely unclear.
- Don't give a wall of bullet points when a few sentences will do.
- Don't ask more than 2-3 questions at a time.

### Code Delivery
- All code goes into downloadable .tsx / .ts files. Never markdown with code fences — raw code only.
- Full file replacements always. Nick never wants to hunt for specific lines.
- Keep files under 500 lines. If something gets big, split into logical sub-components.
- Tell the exact file path for each file (e.g. `src/components/gm-office/InboxPage.tsx`).
- Use `window.location.href` for navigation (not `router.push`) unless `router.push` is already explicitly used.

### Deployment
- Nick uses the GitHub web editor — can only commit one file at a time.
- Give files in the right order so each commit builds cleanly. Standalone components first, then files that import them, page wrappers last.
- If a deletion might break the build because something else imports it, warn and give the safe order.
- After database changes, give a verification query.
- Build order: database changes → API routes → UI components. Foundation first.

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

### Grade Chip Colors
| Color | Meaning | Range |
|-------|---------|-------|
| Red (#E8503A) | Way off (either direction) | >20% gap |
| Yellow (#F5C230) | On the line (either direction) | 10-20% gap |
| Green (#007370) | Close / should work | <10% gap |

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

### AI Suggestion Direction
- Suggestions are ALWAYS shown, regardless of gap size
- Gap sized to the suggestion: big gap → high-value suggestions, small gap → small sweeteners, zero gap → 5% sweetener
- Direction: user getting more (good deal for them) → suggest THEIR assets to Send (sweeten for other side). User giving more → suggest OTHER TEAM's assets to Receive (get more back)
- Visual: "Send →" = blue filled chip, "← Receive" = blue outline chip

### Value Lookups
- Player values: use `final_value` from `cfc_team_trade_values_current` for the team that owns the player
- Pick values: use `cfc_value` from `cfc_trade_values_current` via `display_name` lookup
- No client-side value adjustment functions — values come pre-adjusted from the database
- Stud: `elite_multiplier_applied > 1.0` in `cfc_trade_values_current`
- Youth: `age_multiplier_applied = 1.0` in `cfc_trade_values_current`

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

### Team Nicknames in Tabs
- Everything AFTER the first word: "Virginia Founders" → "Founders", "Midwest Matzo Balls" → "Matzo Balls"
- NOT just the last word (would give "Balls" for Matzo Balls)
- 3-team tabs use dynamic font sizing so full nicknames always fit

---

## Database — Non-Negotiables

- **NEVER guess at Supabase table schemas.** Always query `information_schema.columns` first and confirm with Nick before writing code that references tables.
- Don't assume column names exist. Don't assume data types. Ask first.
- After any database change, provide a verification query.

---

## General Non-Negotiables

- No rounded corners anywhere (border-radius: 0)
- No values displayed to users anywhere — AI speaks in relative terms only
- Navigation uses `window.location.href` (not router.push)
- Components use inline styles matching the neobrutalist system
- All components under 500 lines
- Files delivered as full replacements, one commit at a time
- Copy matters. Think like a real GM would talk, not a generic app.
