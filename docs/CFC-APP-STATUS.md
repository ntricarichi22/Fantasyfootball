# CFC Front Office — App Status

**Last Updated:** May 7, 2026
**Live URL:** https://fantasyfootball-six.vercel.app

---

## Project Overview

CFC Front Office is a bespoke dynasty fantasy football web app for a 12-team Sleeper league called the Cleveland Football Club. It provides team owners with a premium, club-like experience for managing rosters, making trades, running the rookie draft, and analyzing their dynasty assets.

---

## Tech Stack

- **Framework:** Next.js 16 (App Router), React 19, TypeScript
- **Styling:** Tailwind 4 + inline styles (neobrutalist design system)
- **Database:** Supabase (PostgreSQL + Realtime subscriptions)
- **Hosting:** Vercel
- **Data Source:** Sleeper API (rosters, players, draft picks, traded picks)
- **AI:** Anthropic API (Claude Sonnet 4.5) for trade advisor, AI quips, counter suggestions
- **Auth:** Supabase Auth (email/password) with cookie-based profile completion check

---

## League Configuration

- **League ID (Sleeper):** `1328902558617473024` (new league ID each season)
- **Teams:** 12
- **Draft:** 2 drafts per season — Day 1 (Round 1), Day 2 (Rounds 2-3). Slow draft format, 30-min pick windows.
- **Pick announcement:** Snaps to :00/:30 wall-clock boundaries
- **Scoring:** Dynasty/SuperFlex (QB, 2×RB, 2×WR, TE, FLEX, SUPERFLEX). 0.05/passing yard, 1.0/receiving first down, 0.5/rushing first down, otherwise standard PPR (no per-reception).

---

## Routes

| Route | File | Purpose |
|-------|------|---------|
| `/` | `src/app/page.tsx` | Root — HomeScreen or Draft Room based on state |
| `/draft` | `src/app/(app)/draft/page.tsx` | 5-line wrapper importing root page |
| `/trade-builder` | `src/app/(app)/trade-builder/page.tsx` | Trade builder (landing page ↔ builder flow) |
| `/trades` | `src/app/(app)/trades/page.tsx` | Trade inbox (GM Office) |
| `/trades/[id]` | `src/app/(app)/trades/[id]/page.tsx` | Trade thread detail |
| `/trade-studio` | `src/app/(app)/trade-studio/page.tsx` | AI-generated trade offer carousel |
| `/onboarding` | `src/app/(app)/onboarding/page.tsx` | 4-screen onboarding flow |
| `/login` | `src/app/(app)/login/page.tsx` | Login |
| `/signup` | `src/app/(app)/signup/page.tsx` | Signup |

---

## Trade Engine — Unified Architecture (May 7, 2026)

A 25-commit refactor across 6 stages consolidated Builder and Studio under a single shared brain. Before: each feature had its own gap math, grading, and warnings logic that could disagree about the same deal. After: pure-math primitives in `core/` are the single source of truth — both features call them.

**The shared brain (`src/lib/trade/core/`)** — 7 files defining the vocabulary and the math:
- `types.ts` — canonical types (RosterAsset, Gap, Grade, PersonaKey, etc.)
- `gap.ts` — `computeGap` (sums values, produces verdict like FAIR or STRONG_FAVOR_USER), `gradeFromVerdict` (verdict → chip label + color), `personaAwareGrade` (chip respects partner persona's ratio band)
- `liquidity.ts` — S/A/B/C tradeability tiers (drives premium-floor rule)
- `warnings.ts` — post-trade roster simulation, alarm/warning/info severities
- `shape.ts` — structural mismatch detector (depth pieces for studs, etc.)
- `classification.ts` — predicates (isStud, isYouth, isAging, isStarterLevel, etc.) + getCFCYear + parsePickKey (handles both 3-part future-year and 4-part current-year pick keys as of May 7)
- `ranking.ts` — wants-match counter + market-complementarity counter

**Builder side (`src/lib/trade/advisor/`)** — uses core for everything:
- `engine.ts` (v3.7) — Suggestion engine. Per-asset direction, three shapes (single, same-direction combo, swap). Architect partners get swap combos + future-pick weighting + a single-asset cap so the slate skews creative. Player-quality filters mirror Studio: receive pool excludes scrubs, gates youth-depth on user's buy markets, max 1 youth-depth per multi-asset suggestion.
- `context.ts` — translates raw fields to AI-prompt prose (`qb_market: "buy"` → "you're shopping for QBs"). Formats suggestions including swap shapes ("send X AND receive Y").
- `route.ts` — `/api/trades/advisor` endpoint. Loads profiles (including `gm_persona`), runs gap math, calls `personaAwareGrade`, generates suggestions, asks Sonnet for prose.

**Studio side (`src/lib/trade/studio/`)** — also uses core:
- `types.ts` — Studio's offer shape (carries valueGap + gradeLabel + gradeColor; FitScore dropped)
- `persona.ts` — four personas with ratio bounds + shape rules (SS 0.90–1.10 simple, Closer 0.90–1.15 any, Hustler 1.00–99 any, Architect 0.90–1.10 exotic)
- `classification.ts` — re-export shim from core/
- `candidates.ts` (v3.11) — per-persona candidate generator (SS clean shapes, Closer/Hustler add sweetener picks, Architect builds 4+ asset packages / pick swaps / future-pick deals). Player-quality filters: scrubs (non-stud, non-starter, non-youth) excluded entirely from the partner pool; youth-depth players (isYouth + not starter + not stud) included only if their position is in the user's buy markets; max 1 youth-depth per receive set.
- `engine.ts` — scores via `computeGap`, filters dealbreakers (untouchables, alarms, AGING BENCH GUY), enforces persona ratio band, ranks by wants-match → complementarity → ratio-closeness, returns top 5
- `route.ts` — `/api/trade-studio/generate` endpoint

**Shared UI:**
- `src/components/trade/shared/TradeBalanceChip.tsx` — single chip component used by both Builder and Studio. Replaces Studio's old two-bar fit-score UI.

**Persona-aware grading example:** A +12% deal with a Closer partner grades green ("In the range") because their accept band goes to +15%. The same deal with a Straight Shooter partner grades yellow ("You're ahead") because their band caps at +10%. Studio doesn't need this layer because Studio offers are already filtered to your selected persona.

**What was removed:**
- Studio's five-component `FitScore` math (fairValue / positionNeed / wantsMore / rosterShape / attachment)
- Studio's "More Like This" feature (added complexity, low signal)
- Studio's fallback Pass-3 in slate building (empty slate is now the right answer when nothing fits)
- Two component files emptied to no-op stubs: `FitBar.tsx`, `MoreLikeThisModal.tsx` (deletable when convenient)

---

## Threading Model (May 7, 2026)

**One thread per deal proposal.** A "deal" = the original offer + any counter-offers chained via `parent_offer_id`. Two separate proposals between the same teams = two separate threads = two separate cards in the inbox. Each can be accepted, declined, withdrawn, or countered independently of the others.

Resolution logic in `/api/trades/create`:
- `parent_offer_id` present → use parent offer's `thread_id` (counter stays in the same chain)
- `parent_offer_id` absent → always create a new thread

The previous behavior — find-or-create one open thread per team-pair — is gone. Eliminated the orphan-pending-offer problem by construction (terminal status on one thread doesn't affect siblings because there are no siblings inside a thread).

Schema unchanged. Pre-May 7 multi-offer threads remain in the DB as legacy and continue to read/write correctly through the other routes; they close out naturally over time.

---

## Completed Features

### Auth & Onboarding
- Supabase Auth with email/password
- `middleware.ts` checks `cfc_profile_complete` cookie, redirects to `/onboarding` if false
- 4-screen onboarding: Welcome (envelope animation) → Player Attachment (2×2 grid per player) → Wants More (Topps cards) → Team Needs (sliding bars for Low/Med/High + picks)
- Onboarding saves to `cfc_team_strategy_profiles` (position markets + picks_market + wants_more + gm_persona) and `cfc_team_player_attachment` (per-player availability)

### Homepage
- Responsive: 2-column mobile, 4-column desktop
- Cards: War Room, GM Office, Owner's Box, Historian
- Dynamic draft subtext with 2026 date

### Draft Room (Day 1 — Complete)
- Real-time draft with 30-minute pick windows
- Auto-start at scheduled time via `/api/draft-tick` (Vercel cron job in place)
- Pick announcement on :00/:30 wall-clock boundaries with 3-phase reveal animation
- Auto-skip on timeout, auto-advance, draft completion at 12 picks
- Collapsible roster panel with lineup/bench/picks view
- Start/Pause/Resume controls visible to all users
- Mute toggle for draft chime
- "Trade up" / "Shop this pick" buttons in ClockBar linking to trade builder

### Owner's Box
- Refactored from monolith into: OwnersBoxView, StrategyTab, DepthChartTab, TradeChartTab, Card
- Strategy editing with buy/hold/sell ↔ Low/Med/High mapping fix
- Player attachment editing (untouchable/core_piece/listening/moveable)
- **Open:** GM persona is not yet a user-editable setting in the Strategy tab

### GM Office — Trade Inbox
- Three-column sticky marquee: CFC Insider (black) + Make an Offer (blue) + Shop Around (yellow)
- Left column: CFC Insider feed (4 item types: done_deal, active_talks, on_the_block, multiple_calls)
- Right column: filter pills (All/Open/Closed) + search, trade cards
- Trade cards with perspective-aware AI quips, action buttons (Accept/Reject/Counter/View)
- Active/closed deal separators
- One card per pending offer in open threads; one card per closed thread

### Trade Thread Detail Page
Two modes, both fully built and deployed:

**Default mode:** Full-width unified timeline. Offers (yellow 2.5px border, bottom shadow) and chat bubbles (black borders, white for theirs, ink for yours) interleaved chronologically. Latest pending offer shows Accept/Reject/Counter. Previous offers compact at 60% opacity. Chat input pinned at bottom with red arrow. Scroll-to-bottom button. Height fixed to `calc(100vh - 44px)`.

**Counter mode:** Timeline slides to 40% width at 40% opacity. Counter drawer takes 60% on right. Flow: pinned current offer → AI negotiation brief → aggression slider ("How do you want to play this counter?" with "Get it done" ↔ "Test their floor") → 3 numbered AI counter suggestions (Syne 800 numerals, selected = ink fill) → "Build it yourself" (outline blue). Send flow: tap suggestion → goes black → "Send counter" → modal with optional message.

### Trade Builder — Persona-Aware
Two-screen flow.

**Landing Page ("Who are you targeting?"):** search bar, "On the block" top 10 driven by MY needs, "Trade partners" 11-team ranked list, cart sidebar.

**Trade Builder:**
- Left 58%: Dark blue deal card → AI advisor card → Pinned send button
- Right 42%: Team name tabs → Search → Roster by position with filled chips
- AI advisor: persona-aware chip (uses partner's `gm_persona` when known) + Sonnet prose (debounced 2s) + suggestion rows. Suggestions carry per-asset direction with three rendering modes: same-direction collapsed, or stacked two-row layout for swap suggestions with "↔ Swap" pill.
- Architect partners trigger swap suggestions in pass 2 of the engine, ahead of same-direction combos. Architect partners also cap singles at 1 so the slate has room for creative shapes.
- Tapping a suggestion routes each asset to its specified direction — swap suggestions populate both sides of the deal at once.
- 2-team: per-side +Add buttons in deal card, auto-routing. **Row interactions:** clicking anywhere on a deal-card row removes the asset; small × icon shows visual affordance.
- 3-team: universal +Add at bottom, routing popup for every tap. Row interactions: popover with reroute options + remove.

### Trade Studio
Single-page flow with persona-driven offer generation.

**Layout:**
- Left 40% (or 100% before generation): roster panel with shop-list toggles, persona toggle, Generate button
- Right 60% (after generation): offer carousel — partner team name + balance chip in flex row, send/receive grid in dark blue panel, AI advisor prose, action buttons (Pass / Edit / Make this offer)

**Offer generation pipeline (`/api/trade-studio/generate`):**
1. Hydrate rosters from client payload (no DB lookup for value flags — client provides isStud/isYouth)
2. Enrich with computed isStarterLevel + parsed pick fields
3. Call `generateStudioOffers` (studio/engine.ts) with selected persona
4. Engine: candidates → score (computeGap) → filter dealbreakers → persona ratio gate → rank → top 5

**Persona behavior:**
- **Straight Shooter** (0.90–1.10, simple shapes): clean 1-for-1 / 1-for-2 / 2-for-1 / 1-for-3 bundles, no future picks, no pick swaps
- **Closer** (0.90–1.15, any shape): SS base + adds your 3rd or 2nd round pick to send side as sweetener
- **Hustler** (1.00–99, any shape): SS base + adds partner's 3rd or 2nd round pick to receive side as the lift; no upper cap on the final ratio (the persona is "always come out ahead")
- **Architect** (0.90–1.10, exotic only): 4+ asset packages, pick swaps (different round/year), future picks, and augmented-send variants where you add a pick to enable swap shapes

**Offer card UI:** persona toggle + prev/next + counter at top, partner team name with balance chip on the right, send/receive grid, AI advisor prose, two secondary buttons (Pass + Edit), primary CTA (Make this offer). Swipe-style carousel with `1 / 5` indicator.

**Pass action:** Posts feedback to `/api/trade-studio/feedback`. The endpoint accepts `works_for_you` / `works_for_them` for ML-training continuity — TradeStudioView synthesizes those from `valueGap.ratio` (formula: `85 + (ratio - 1) × 50`, clamped 0-100).

### Value Pipeline
Three sources (FantasyCalc, KeepTradeCut, DynastyProcess) feed `cfc_asset_source_values` → `cfc_rebuild_value_layers()` Postgres function → `cfc_asset_calculations` → `cfc_trade_values_current` (VIEW) → `rebuildTeamTradeValuesForTeam` per team → `cfc_team_trade_values_current`. Daily cron at 4am ET.

---

## Known Issues / Active Bugs

### League Historian
Nick noticed issues with the historian section. Will be tackled in a separate session. Keeping the slp/flea/mfl admin ingestion routes around until then in case re-ingestion is needed.

### Manual Override Drift
Manual override values stored in `cfc_team_player_value_overrides` are absolute dollar amounts that don't update when league values change. By design — overrides represent the user's stable signal ("what would I trade this player for"). However, the UI does not currently surface when an override has drifted significantly from the auto-calculated value. Slated for future session.

---

## API Routes

| Route | Method | Purpose | Status |
|-------|--------|---------|--------|
| `/api/draft-state` | GET/POST | Draft state read/write | ✅ Working |
| `/api/draft-tick` | GET/POST | Draft heartbeat | ✅ Working |
| `/api/draft/submit-pick` | POST | Submit draft pick | ✅ Working |
| `/api/draft/rookie-prospects` | GET | Rookie prospect data | ✅ Working |
| `/api/player-values` | GET | CFC base player values | ✅ Working |
| `/api/trades/create` | POST | Create trade offer (1 thread per deal) | ✅ Working |
| `/api/trades/list` | GET | List trade offers | ✅ Working |
| `/api/trades/threads/[id]` | GET | Trade thread detail | ✅ Working |
| `/api/trades/ai-quip` | POST | AI quips for trade cards | ✅ Working |
| `/api/trades/insider` | GET | CFC Insider feed (chain-aware) | ✅ Working |
| `/api/trades/ai-counter` | POST | Counter suggestions for thread page | ✅ Working |
| `/api/trades/targets` | GET | Landing page targets + rankings | ✅ Working |
| `/api/trades/advisor` | POST | Builder AI advisor (persona-aware, scrub/youth filtered) | ✅ Working |
| `/api/trade-studio/generate` | POST | Studio offer generation (persona-driven, scrub/youth filtered) | ✅ Working |
| `/api/trade-studio/feedback` | POST | Studio offer Pass feedback | ✅ Working |
| `/api/internal/refresh-values` | GET/POST | Daily value refresh (cron) | ✅ Working |
| `/api/onboarding/player-attachment` | POST | Save attachments | ✅ Working |
| `/api/onboarding/complete` | POST | Mark onboarding complete | ✅ Working |
| `/api/auth/finalize` | POST | Set profile cookie on login | ✅ Working |
| `/api/active-teams` | GET | Active teams | ✅ Working |

### Admin/Ingestion Routes (Kept until historian session)
| Route | Purpose |
|-------|---------|
| `/api/admin/sleeper-history` | Backfill Sleeper league history |
| `/api/admin/sleeper-players` | Refresh Sleeper player dictionary |
| `/api/admin/sleeper-smoke` | Sleeper draft data ingestion |
| `/api/admin/lineup-stats` | Populate slp_starters_enriched |
| `/api/admin/build-player-weekly-game-log` | Populate slp_player_weekly_game_log |
| `/api/admin/build-player-weekly-presence` | Populate slp_player_weekly_presence |
| `/api/admin/build-transaction-items` | Populate slp_transaction_items |
| `/api/admin/ingest/sleeper-draft-results` | Populate slp_mirror_draft_results |
| `/api/admin/ingest/fleaflicker` | Legacy Fleaflicker league ingestion |
| `/api/admin/ingest/fleaflicker-roster-detail` | Legacy Fleaflicker roster detail |
| `/api/admin/ingest/mfl` | Legacy MFL league ingestion |
| `/api/admin/ingest/mfl-players` | Legacy MFL player metadata |
| `/api/admin/populate-rookies` | One-time rookie pool bootstrap |

---

## Key Libraries

### Trade engine — shared brain (`src/lib/trade/core/`)
| File | Purpose |
|------|---------|
| `core/types.ts` | Canonical types: RosterAsset, DealAsset, Gap, Grade, PersonaKey, etc. |
| `core/gap.ts` | computeGap, gradeFromVerdict, personaAwareGrade — single source of truth for fairness |
| `core/liquidity.ts` | getLiquidityTier (S/A/B/C), isPremiumAsset |
| `core/warnings.ts` | computePostTradeWarnings — alarm/warning/info severities |
| `core/shape.ts` | detectShapeMismatch — structural mismatches (depth-for-studs, etc.) |
| `core/classification.ts` | parsePickKey (handles both 3-part and 4-part keys), getCFCYear, predicates (isStud, isYouth, isStarterLevel, isAgingBenchGuy, etc.), enrichRosters, inferTeamMode |
| `core/ranking.ts` | scoreWantsMatch, countComplementarity |

### Trade engine — Builder (`src/lib/trade/advisor/`)
| File | Purpose |
|------|---------|
| `advisor/engine.ts` | generateSuggestions (per-asset direction, swap support, Architect bias, scrub/youth filters). Re-exports from core for backward compat. |
| `advisor/context.ts` | translateStrategy, summarizeRoster, translateGap, describeSuggestions, describeWarnings, describeShapeMismatch — AI prompt translation layer |
| `advisor/prompt.ts` | SYSTEM_PROMPT + buildUserPrompt — final prompt assembly |
| `advisor/personality.ts` | Static team-personality map (negotiation style, dealer type) |

### Trade engine — Studio (`src/lib/trade/studio/`)
| File | Purpose |
|------|---------|
| `studio/types.ts` | StudioOffer (carries valueGap + gradeLabel + gradeColor); aliases of core types |
| `studio/persona.ts` | PERSONAS map with ratio bounds + shape rules; getPersona, isValidPersona |
| `studio/classification.ts` | Re-export shim from core/ (kept for backward compat) |
| `studio/candidates.ts` | Per-persona candidate generators (SS / Closer / Hustler / Architect) with scrub/youth filters |
| `studio/engine.ts` | generateStudioOffers — candidates → score → filter → rank → slate |

### Other
| File | Purpose |
|------|---------|
| `src/lib/draftState.ts` | Draft types, constants (INITIAL_PICK_SECONDS=1800, TOTAL_DRAFT_PICKS=12) |
| `src/lib/draftAutoAdvance.ts` | Auto-announce, auto-skip, auto-advance, draft completion |
| `src/lib/picks.ts` | Pick utilities: labels, values, traded pick computation, withComputedDraftPicks |
| `src/lib/trade/value.ts` | getPickValue, getPlayerValue, getCFCPickKey |
| `src/lib/trade/profile.ts` | Team strategy profiles |
| `src/lib/team-hq/service.ts` | rebuildTeamTradeValuesForTeam, team-level modifier math |
| `src/lib/values/normalize.ts` | Multi-tier player name → Sleeper ID resolution |
| `src/lib/storedTeam.ts` | readStoredTeam() — cookie-first auth |
| `src/lib/config.ts` | LEAGUE_ID, getLeagueId() |
| `src/lib/supabaseAdmin.ts` | Supabase admin client |

---

## What's Next

### Priority 1: GM personas in Owner's Box
Add `gm_persona` as a user-editable setting in the Strategy tab. Once set, becomes the default for the Studio persona toggle (which serves as a re-roll override on top of the persisted default). Builder's `personaAwareGrade` already reads partner persona from the same column, so the new setting also affects how chips render when other users target the team.

### Priority 2: Manual Override UI Enhancement
Surface auto_value vs override delta in the UI. Show user when their override has drifted significantly from current auto_value so they can decide whether to revisit. UI work, no backend changes.

### Priority 3: Overall UI and Copy Review
Top-to-bottom pass on the entire app — visual consistency, microcopy, error states, empty states, button labels, hover states, animations. Likely a multi-session effort.

### Priority 4: League Historian Troubleshooting
Tackle in a separate session.

### Priority 5: Mobile Layouts
Mobile inbox, thread detail, trade builder, counter drawer. All desktop features need mobile equivalents.

### Priority 6: Day 2 Draft
Build draft room for Rounds 2-3. Add league_id + season columns to draft_log.

### Deferred / Parking Lot
See `docs/deferred-projects.md` for the full inventory.

---

## Known unmapped players (low priority — safe to ignore)

These show up in `cfc_unmapped_log` but aren't worth aliasing:
- KTC: Chigoziem Okonkwo, Bam Knight, Frank Gore Jr.
- DynastyProcess: Hollywood Brown (Sleeper has him as Marquise Brown)

---

## Useful SQL Commands

```sql
-- Check current draft state
SELECT * FROM draft_state WHERE league_id = '1328902558617473024';
```

```sql
-- Check drafted picks
SELECT pick_index, pick_number, player_name, team_name, submitted_at
FROM draft_log WHERE submitted_at IS NOT NULL ORDER BY pick_index;
```

```sql
-- Check a team's strategy profile (including persona)
SELECT team_id, gm_persona, wants_more, qb_market, rb_market, wr_market, te_market, picks_market
FROM cfc_team_strategy_profiles WHERE team_id = '2';
```

```sql
-- Check personas across all teams (useful for smoke testing)
SELECT team_id, gm_persona FROM cfc_team_strategy_profiles ORDER BY team_id;
```

```sql
-- Check a team's player attachments
SELECT sleeper_player_id, attachment
FROM cfc_team_player_attachment WHERE team_id = '2';
```

```sql
-- Check team-adjusted values for specific players
SELECT player_name, base_value, auto_value, manual_override_value, final_value,
       studs_modifier_pct, youth_modifier_pct, own_guys_modifier_pct as attachment_pct, total_modifier_pct
FROM cfc_team_trade_values_current
WHERE team_id = '2'
ORDER BY final_value DESC;
```

```sql
-- Check base pick values
SELECT display_name, cfc_value
FROM cfc_trade_values_current
WHERE display_name IN ('1.06', '2.06', '3.06');
```

```sql
-- Check value pipeline freshness
SELECT MAX(rebuilt_at) FROM cfc_asset_calculations;
SELECT source_key, COUNT(DISTINCT asset_key) as players, MAX(import_batch)
FROM cfc_asset_source_values GROUP BY source_key;
```

```sql
-- Spot check a player with multipliers
SELECT a.display_name, a.position, a.years_exp,
  c.source_count, c.composite_value,
  c.position_multiplier_applied, c.elite_multiplier_applied,
  c.age_multiplier_applied, c.scoring_factor_applied,
  c.final_cfc_value
FROM cfc_assets a
JOIN cfc_asset_calculations c ON c.asset_key = a.asset_key
WHERE a.display_name = 'Patrick Mahomes';
```

```sql
-- Recent unmapped players from value pipeline
SELECT source_key, source_player_name, MAX(raw_value) as raw_value
FROM cfc_unmapped_log
WHERE created_at > NOW() - INTERVAL '24 hours'
GROUP BY source_key, source_player_name
ORDER BY raw_value DESC NULLS LAST;
```

```sql
-- Trade threads with offer counts (post-May 7: 1 thread = 1 deal)
SELECT t.id, t.team_a_id, t.team_b_id, t.status, COUNT(o.id) as offer_count
FROM trade_threads t
LEFT JOIN trade_offers o ON o.thread_id = t.id
WHERE t.league_id = '1328902558617473024'
GROUP BY t.id ORDER BY t.created_at DESC;
```

```sql
-- Check all table columns (ALWAYS DO THIS BEFORE GUESSING)
SELECT column_name, data_type
FROM information_schema.columns
WHERE table_name = 'YOUR_TABLE_NAME'
ORDER BY ordinal_position;
```
