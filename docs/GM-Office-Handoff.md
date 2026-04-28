# GM Office Build — Session Handoff

**Last Updated:** April 28, 2026

---

## What Was Completed This Session

### Database Changes
- Dropped 7 orphaned tables: trades, player_values, definitive_values, "trade values raw upload", trade_values_debug_patch, "unmatched players", audit_draft_pick_player_fix_* (both)
- Dropped orphaned view: v_player_values_definitive
- Removed legacy columns from trade_messages: trade_id, sender_team, offer_id
- Added ai_quip (text) column to trade_offers
- Created watchlist table: id, league_id, team_id, asset_key, owner_team_id, created_at

### Owner's Box Refactor
- Old monolith TeamHqView.tsx (~700 lines) split into 5 files under src/components/owners-box/
  - OwnersBoxView.tsx — main shell with tabs
  - StrategyTab.tsx — strategy editing with buy/hold/sell ↔ low/med/high mapping fix
  - DepthChartTab.tsx — depth chart (unchanged logic, hardcoded data)
  - TradeChartTab.tsx — trade chart (unchanged logic)
  - Card.tsx — shared Card component
- Deleted: src/components/TeamHqView.tsx, src/components/TeamHqTabs.tsx
- Updated: src/app/(app)/team-hq/page.tsx and src/app/(app)/team-snapshot/page.tsx to import OwnersBoxView

### Onboarding Fix
- OnboardingPosture.tsx: added NEED_TO_MARKET mapping so Low/Med/High correctly stores as sell/hold/buy in cfc_team_strategy_profiles

### New API Routes (Deployed)
- /api/trades/insider (GET) — CFC Insider feed with 4 item types: done_deal, active_talks, on_the_block, multiple_calls
- /api/trades/ai-quip (POST) — generates perspective-aware AI quips for trade offers, stores as JSON {to, from} in ai_quip column, falls back to deterministic value math if Anthropic unavailable

### New UI Components (Deployed)
- src/components/gm-office/FilterBar.tsx — All/Open/Closed pills + search input
- src/components/gm-office/InsiderPanel.tsx — left column CFC Insider feed with auto-refresh
- src/components/gm-office/TradeCard.tsx — trade offer card with action buttons (Accept/Reject/Counter/View)
- src/components/gm-office/InboxPage.tsx — main inbox layout with sticky marquee, insider panel, trade card feed
- Updated: src/app/(app)/trades/page.tsx to render new InboxPage

---

## Design Decisions (Locked)

### GM Office Inbox Layout
- Three-column sticky marquee at top: CFC Insider header (210px, black) + Make an Offer (blue) + Shop Around (yellow)
- Left column (210px): continuous black panel with CFC Insider feed
- Right column: filter pills (All/Open/Closed) + search bar, then trade cards
- "Active negotiations" separator (ink line) before active cards
- "Closed" separator (muted line) before closed cards
- Empty state: "No deals on the table. Let's change that." with two action buttons

### Trade Card Design (Concept 1 — Geometric)
- Two-column asset grid: "You receive" / "You send" with equal weight on players and picks
- AI quip line with yellow AI icon (square, not circle)
- No status/grade chips — all info baked into AI quip
- Action buttons stacked vertically on right edge:
  - Your court: Accept (ink) / Reject (red) / Counter (blue) / View (outline)
  - Their court: View (outline) only
  - Closed: History (muted outline) only
- Bauhaus color restraint — ink/red/blue for buttons, no other color accents on cards
- No shadow differentiation between your-court and their-court cards

### Trade Thread Detail Page (Designed, Not Built)
- Default mode: full-width unified timeline (offers + chat interleaved chronologically)
  - Offer cards: yellow border (2.5px #F5C230) + bottom-only yellow shadow (0 4px 0 #F5C230)
  - Chat bubbles: black borders (1.5px #1A1A1A), their messages left-aligned on white, your messages right-aligned on ink
  - Latest pending offer: full-size with Accept/Reject/Counter action buttons inline
  - Previous offers: compact, muted
  - Chat input pinned at bottom full-width
- Counter mode: drawer slides open from right (60% drawer / 40% timeline)
  - Timeline dims to 40% opacity, stays scrollable for reference
  - Current offer lifts from timeline into drawer (pinned at top)
  - Dashed placeholder left in timeline showing "Current offer moved to counter panel →"
  - Drawer flow top to bottom:
    1. Pinned offer card (compact)
    2. AI negotiation brief (2-4 sentences summarizing chat dynamics + deal context, updates with slider)
    3. Aggression slider (Conservative ↔ Aggressive)
    4. 3 AI counter suggestions (delta-based modifications, not full new offers)
       - Unselected: light border
       - Selected: black fill, white text, "Send counter" button appears inside card
    5. "Build it yourself" — blue button linking to Trade Machine with pre-populated deal
  - Send flow: tap suggestion → card goes black/selected → "Send counter" button inside card → modal: text input + "Send" button (message optional)
  - Close: ✕ button or cancel returns to full-width read mode
- Closed thread: drawer auto-closes, timeline goes full width, status badge at top
- Accept flow: tap Accept → modal with "Accept now" and "Shop this deal for 24 hours"
- Reject flow: tap Reject → confirmation modal

### CFC Insider Feed
- League-wide only (no personal intel toggle — killed during design)
- 4 item types: Done deal, Active talks, On the block, Multiple calls
- No "new thread opened" items (too noisy)
- Active talks only fires when 2+ offers exchanged in a thread
- On the block uses different verbs: "is actively shopping" (moveable) vs "is listening to offers on" (listening)

### Watchlist (Designed, Not Built)
- Lightweight feature: tap a "watch" icon on any player you don't own to add to watchlist
- Managed in Owner's Box (not in the inbox)
- Activity triggers push notifications (not inbox items)
- No inline watchlist panel in the inbox

### Shop This Deal (Designed, Not Built)
- Appears in Accept confirmation modal, not as a standalone button
- Flow: tap Accept → "Accept now" or "Shop this deal for 24 hours" → if shopping, anonymous broadcast to relevant teams (watchlist + position needs matches)
- Broadcast shows player name + value threshold, not specific assets or counterpart identity
- 24-hour time window with countdown
- Competing offers tagged with "COMPETING OFFER" chip in inbox

---

## Still To Build (Next Session)

### Priority 1: Trade Thread Detail Page
- Build ThreadPage.tsx with unified timeline (both modes)
- Build CounterDrawer.tsx with AI suggestions
- Build ChatBubble.tsx for timeline
- Build AcceptModal.tsx and RejectModal.tsx
- Build /api/trades/counter-suggest route (Anthropic-powered)
- Wire counter flow: Counter button → drawer open → AI suggestions → send

### Priority 2: Integration & Cleanup
- Delete orphaned API routes:
  - /api/trade-offers/route.ts
  - /api/player-values-definitive/route.ts
  - /api/definitive-player-values-smoke/route.ts
  - /api/player-values/refresh/route.ts
  - /api/trade/llm-rerank/route.ts
  - /api/trades/[id]/messages/route.ts
- Delete TradeCenterTabs.tsx (after thread detail page no longer imports it)
- Integration test: full offer → counter → accept/reject flow

### Priority 3: Mobile
- Mobile inbox layout
- Mobile thread detail layout
- Mobile counter drawer (probably full-screen overlay instead of side drawer)

### Deferred
- Trade Machine redesign
- AI Trade Studio redesign
- Watchlist management UI
- Shop This Deal mechanic
- Email notifications / Sleeper push integration
- Global notification badge on nav bar

---

## Key Files Reference

### New Files (This Session)
| File | Purpose |
|------|---------|
| src/components/gm-office/InboxPage.tsx | Main inbox layout |
| src/components/gm-office/FilterBar.tsx | Filter pills + search |
| src/components/gm-office/InsiderPanel.tsx | CFC Insider feed panel |
| src/components/gm-office/TradeCard.tsx | Trade offer card with actions |
| src/components/owners-box/OwnersBoxView.tsx | Owner's Box main shell |
| src/components/owners-box/StrategyTab.tsx | Strategy editing with mapping fix |
| src/components/owners-box/DepthChartTab.tsx | Depth chart tab |
| src/components/owners-box/TradeChartTab.tsx | Trade chart tab |
| src/components/owners-box/Card.tsx | Shared Card component |
| src/app/api/trades/insider/route.ts | CFC Insider feed API |
| src/app/api/trades/ai-quip/route.ts | AI quip generation API |

### Existing Files That Will Be Modified Next Session
| File | Change Needed |
|------|---------------|
| src/app/(app)/trades/[id]/page.tsx | Full replacement with new ThreadPage |

### Files To Delete Next Session
| File | Reason |
|------|--------|
| src/components/TradeCenterTabs.tsx | Replaced by inbox layout (delete after thread page rebuilt) |
| src/app/api/trade-offers/route.ts | Superseded by /api/trades/create + /api/trades/list |
| src/app/api/player-values-definitive/route.ts | Orphaned test route |
| src/app/api/definitive-player-values-smoke/route.ts | Orphaned smoke test |
| src/app/api/player-values/refresh/route.ts | Writes to deleted player_values table |
| src/app/api/trade/llm-rerank/route.ts | OpenAI-based, replaced by Anthropic |
| src/app/api/trades/[id]/messages/route.ts | Duplicate of /api/trades/threads/[threadId]/messages |

---

## Design System Notes
- All trade offer cards: yellow border (2.5px #F5C230) + bottom-only yellow shadow (0 4px 0 #F5C230)
- Chat bubbles: black borders, white bg (theirs), ink bg (yours)
- AI icon: 18×18 square, #F5C230 bg, #1A1A1A text, "AI"
- Buttons: ink for primary action, red for destructive, blue for constructive, outline for navigation
- No rounded corners anywhere
- Fonts: Syne 800 for headlines, DM Sans for body, JetBrains Mono for data/labels
- Colors restrained: only use red/blue/yellow for functional meaning, not decoration

## Supabase Tables — Active Trade System
- trade_threads — thread grouping (team_a_id, team_b_id, status, timestamps)
- trade_offers — individual offers (from/to team, assets JSON, values, status, ai_quip, thread_id)
- trade_messages — chat within threads (thread_id, from_team_id, message)
- watchlist — player/pick watchlist (team_id, asset_key, owner_team_id)

## Supabase Tables — Value System
- cfc_trade_values_current (VIEW) — canonical CFC values with multipliers
- cfc_asset_source_values — raw source-level values
- cfc_team_trade_values_current — team-specific adjusted values
- cfc_team_asset_values_current (VIEW) — team values with preference multipliers
- cfc_team_strategy_profiles — team strategy (wants_more, position markets, own_guys)
- cfc_team_player_attachment — per-player availability (untouchable/core_piece/listening/moveable)
- cfc_team_player_value_overrides — manual value overrides per player
- cfc_team_value_preferences — legacy preferences (may consolidate later)
- cfc_value_sources — source registry
- cfc_value_settings — global settings
