-- 011_per_position_intent.sql
--
-- Per-position trade intent — the new signal the trade engine consumes.
-- Replaces the global wants_more array (which conflated "what I want to acquire"
-- with a value modifier on my own roster). Strategy is now engine-signal only;
-- availability stays the sole value modifier.
--
-- ADDITIVE migration: adds the new intent columns ONLY. wants_more is left in
-- place on purpose and is dropped in a later cleanup migration, AFTER the app
-- (research-strategy/api/service.ts) and the brain (team-narratives) stop
-- reading it. This avoids any window where a deployed build queries a column
-- that no longer exists.
--
-- All intent columns are MULTI-SELECT, stored as text[] defaulting to an empty
-- array ( = nothing selected / roster-only ). The app layer normalizes and
-- validates the contents (same approach wants_more used) — no DB-level CHECK on
-- array elements, so the vocabulary can evolve without a migration.
--
-- Vocabularies:
--   <pos>_buy_intent : 'difference_maker' | 'insurance' | 'young'
--                      (gated by <pos>_market = 'buy' — "what do we need here?")
--   picks_buy_kind   : 'premium' | 'day2' | 'future'
--                      (gated by picks_market = 'buy' — "what kind of picks?")
--   <pos>_sell_move  : 'consolidate' | 'fill_need'
--                      (gated by <pos>_market = 'sell' — "what's the move?")
--
-- Positions are QB / RB / PC (pass-catcher = WR+TE merged), matching the live
-- *_market columns. Picks have NO sell-move column: selling picks has no
-- consolidate-vs-shed ambiguity, so "we're deep on picks" just shops them.

-- Buy side — "What do we need here?"
ALTER TABLE public.cfc_team_strategy_profiles
  ADD COLUMN IF NOT EXISTS qb_buy_intent text[] NOT NULL DEFAULT '{}',
  ADD COLUMN IF NOT EXISTS rb_buy_intent text[] NOT NULL DEFAULT '{}',
  ADD COLUMN IF NOT EXISTS pc_buy_intent text[] NOT NULL DEFAULT '{}';

-- Picks side — "What kind?"
ALTER TABLE public.cfc_team_strategy_profiles
  ADD COLUMN IF NOT EXISTS picks_buy_kind text[] NOT NULL DEFAULT '{}';

-- Sell side — "What's the move?"
ALTER TABLE public.cfc_team_strategy_profiles
  ADD COLUMN IF NOT EXISTS qb_sell_move text[] NOT NULL DEFAULT '{}',
  ADD COLUMN IF NOT EXISTS rb_sell_move text[] NOT NULL DEFAULT '{}',
  ADD COLUMN IF NOT EXISTS pc_sell_move text[] NOT NULL DEFAULT '{}';