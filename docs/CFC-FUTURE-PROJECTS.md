# CFC Front Office — Deferred Projects

**Last Updated:** May 7, 2026

A living list of work that's been intentionally deferred, deprioritized, or parked. Items are grouped by theme. Each has a short rationale and (where useful) a pointer to where the conversation left off.

---

## Trade Engine — AI & Generator

### LLM hybrid re-ranking pass
Generator stays rule-based. LLM gets the top 15–20 candidates and picks 5 with explanations. Best of both — rule engine handles deterministic value math, LLM handles fuzzy contextual judgment (depth chart, age curves, "this rookie is buried"). Significant architectural addition. Cost/latency/determinism tradeoffs to think through. New chat.

### Layer 2 personality learner
Nightly job summarizing each team's negotiating personality from accepted offers + chat history. Would make the static `personality.ts` map dynamic. Out of scope until the trade engine usage settles.

---

## UI / UX

### Overall UI and copy review
Top-to-bottom pass on the entire app — visual consistency, microcopy, error states, empty states, button labels, hover states, animations. Once feature work settles, this becomes the next focus. Likely a multi-session effort.

### Depth Chart tab buildout
Owner's Box has a Depth Chart tab placeholder that needs to be built out. Goal: roster organized by position with clear depth at each spot so the user can see roster construction at a glance — and pair the view with strategy/persona context for trade planning.

### Manual override drift surfacing
Manual override values in `cfc_team_player_value_overrides` are absolute dollars and don't update when league values change. By design — the override is the user's stable signal. Open: the UI doesn't surface when an override has drifted significantly from the auto-calculated value, so the user can decide whether to revisit. UI work, no backend changes.

### Mobile layouts
All desktop features need mobile equivalents:
- Inbox (GM Office)
- Thread detail (timeline + counter mode)
- Trade Builder (landing + builder)
- Counter drawer
- Trade Studio
- Owner's Box

### Watchlist management UI
The `watchlist` table exists but has no UI for managing it. Needs an add/remove flow, and a way to surface watchlist hits in the inbox or homepage.

### "Shop This Deal" mechanic
24-hour competing offer window. When an offer is on the table, broadcast it to other teams who could match or beat it. Real GM-style "let me see if anyone else wants in." Location TBD — most natural fit is a button on incoming pending offers in the thread page, alongside Accept/Reject/Counter. Requires inbox + notification work.

---

## Notifications & Integrations

### Email notifications
Trade offers, draft picks, league events. Standard transactional email pipeline. Probably Resend or similar.

### Sleeper push integration
Push notifications via Sleeper's existing infrastructure. Lower priority since most users will check the app directly.

---

## Drafts & Seasons

### Day 2 Draft
Rounds 2-3 draft room. Slow draft format same as Day 1. Need to:
- Add `draft_phase` column (integer, 1 or 2) to `draft_state` OR rely on `draft_log` exclusion logic
- Add `league_id` + `season` columns to `draft_log` for cross-season queries

### Phase 5 alias seeding
Manual seeding of `cfc_player_alias_map` for new unmapped names that appear in `cfc_unmapped_log` over time. Low priority — auto-resolve handles 95%+.

---

## Historian

### Historian section rebuild
Nick noticed issues with the historian section. Tackle in a separate session. Keeping the slp/flea/mfl admin ingestion routes around until then in case re-ingestion is needed.

---

## Infra

### Error monitoring / logging
No Sentry or similar currently. Production error visibility is limited to Vercel logs.

---

## ML / Training Pipeline (Long-Term)

Out of scope for the app's current phase. The `cfc_trade_studio_feedback` table preserves training data through `works_for_you` / `works_for_them` synthesized from `valueGap.ratio` so when this becomes active, there's continuity.

---

## Resolved

Recent items kept here for context, not active work.

- ~~Delete no-op stub files~~ — done May 7. `FitBar.tsx` and `MoreLikeThisModal.tsx` removed; verified no remaining imports.
- ~~Drop `tgif_pick_anchors` table~~ — done May 7. 36 orphaned rows, no FK references.
- ~~Drop `cfc_team_value_preferences` table~~ — done May 7. CASCADE'd the dead `cfc_team_asset_values_current` view too (cross-joined the empty table → always returned 0 rows; pre-dated per-team value materialization into `cfc_team_trade_values_current`).
- ~~Clear stale `cfc_asset_source_values`~~ — verified May 7. No `fix7-preview` rows remained; only batch is `auto-2026-05-07`.
- ~~GM personas in Owner's Box~~ — shipped May 7. Strategy tab persona picker (Closer / Straight Shooter / Architect / Hustler) writes to `cfc_team_strategy_profiles.gm_persona`. Builder's `personaAwareGrade` and Studio's offer-gen default already read this column, so the picker feeds the existing wiring without any engine changes.
- ~~AI Advisor smoke test~~ — completed May 7. Iterated through 11 fixes across the trade engine, persona definitions, threading model, and player-quality filters.
- ~~Studio prose not firing~~ — fixed via TradeStudioView refactor (in-flight Set ref instead of AbortController dance).
- ~~Studio Edit routing~~ — fixed via `?seed=studio` URL param + sessionStorage handoff.
- ~~Hustler band misalignment~~ — fixed by flipping band to 1.00–99 and dropping `isSimpleShape` shape gate.
- ~~Inbox showing only most recent offer~~ — fixed via threading model rewrite (1 thread per deal).
- ~~CFC Insider firing on solo offers~~ — fixed via chain-aware sender check.
- ~~Studio offers padding with scrubs~~ — fixed via partner pool quality filter (scrubs excluded, youth gated on buy markets, max 1 youth per receive).
- ~~parsePickKey cleanup in `advisor/engine.ts`~~ — `isLatePick` and `isCurrentYearPick` now call `parsePickKey` directly. Resolved in v3.7 advisor mirror.
- ~~"Shop Around" screen~~ — shipped as Trade Studio.
- ~~Wire `isAging` flag through client payload~~ — made obsolete by the broader scrub filter, which excludes aging bench guys by definition (non-stud, non-starter, non-youth).
- ~~Pick-first candidate generation~~ — not needed. Picks surface naturally now that scrubs are filtered out of the partner pool.
- ~~Stud/starter market filter~~ — decision made: stud receives are valid even when the position is in sell market. Consolidation play.
