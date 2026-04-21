# CLAUDE.md — Agent Reference

> Canonical schemas and conventions for AI coding agents working in this repo.
> This file supplements AGENTS.md. Read both before making changes.

---

## Canonical Database Schemas

These are the exact column names used in Supabase. Do not rename, alias, or assume alternatives.

### `rookie_prospects`

Columns confirmed in `src/app/api/draft/rookie-prospects/route.ts` and `src/app/api/admin/populate-rookies/route.ts`.

| Column | Type | Notes |
|--------|------|-------|
| `player_id` | text | Sleeper player id; bootstrap rows use a `tmp_<normalized-name>` placeholder until the NFL draft assigns a real id. Primary key for upserts (`onConflict: "player_id"`). |
| `player_name` | text | Full prospect name as it appears in source data. Used as the lookup key after `normalizeName()`. |
| `position` | text | QB / RB / WR / TE / etc. |
| `college` | text | College program. |
| `age` | numeric | Prospect age. |
| `height_inches` | integer | Height in inches. |
| `weight` | integer | Weight in pounds. |
| `nfl_team` | text (nullable) | Drafting NFL team; null pre-draft. |
| `nfl_draft_round` | integer (nullable) | NFL draft round; null pre-draft. |
| `nfl_draft_pick` | integer (nullable) | NFL overall pick number; null pre-draft. |
| `avatar_url` | text (nullable) | ESPN headshot URL. |

### `draft_log`

Columns confirmed in `src/app/api/draft-log/route.ts` and `src/lib/draftAutoAdvance.ts`.

| Column | Type | Notes |
|--------|------|-------|
| `pick_index` | integer | 0-based position in the draft order. Primary key. |
| `pick_number` | text | Display form like `"1.01"` (round.pick-in-round). |
| `team_count` | integer | Number of teams in the draft (used to derive round/pick). |
| `team_name` | text | Drafting team's display name. |
| `roster_id` | text | Sleeper roster id of the drafting team. |
| `player_id` | text | Sleeper player id of the selection. |
| `player_name` | text | Name of the drafted player. |
| `positions` | text[] | Eligible fantasy positions for the player. |
| `nfl_team` | text | Player's NFL team code. |
| `is_announced` | boolean | Whether the pick has been publicly revealed. |
| `is_skip` | boolean | Whether this pick was auto-skipped (clock expired). |
| `submitted_at` | timestamptz | When the pick was submitted by the team. |
| `announced_at` | timestamptz | When the pick was revealed to the league. |

### `draft_state`

Columns confirmed in `src/app/api/draft-state/shared.ts` (`SELECT_COLS`) and `src/app/api/draft-log/route.ts`.

| Column | Type | Notes |
|--------|------|-------|
| `league_id` | text | Sleeper league identifier. Primary key (`onConflict: "league_id"`). |
| `status` | text | Draft lifecycle state (e.g., `pre_draft`, `in_progress`, `complete`). |
| `seconds_remaining` | integer | Time left on the current pick clock. |
| `clock_started_at` | timestamptz | When the current pick clock began. |
| `current_pick_index` | integer | Index of the pick currently on the clock. |
| `pick_submitted` | boolean | Whether the current pick owner has submitted their selection. |
| `pick_announced_at` | timestamptz | When the current pick was revealed to the league. |
| `starts_at` | timestamptz | Scheduled start time for the draft. |

---

## Column Name Discipline

When writing queries against these tables:
- Use the exact column names above. Do not use camelCase equivalents.
- If you need to reference a column not listed here, check the Supabase dashboard or `src/lib/llm/schema-context.ts` for the full schema.
- `src/lib/llm/schema-context.ts` documents the `llm_*` warehouse tables — consult it as the source of truth for any table not listed in this file.

---

## Conventions

- **Name normalization:** Use `normalizeName()` from `src/lib/normalize.ts` for all player/prospect name matching. Do not create local normalization functions.
- **Supabase admin client:** Import from `src/lib/supabaseAdmin.ts`. Do not instantiate `createClient` with service role keys inline in route handlers.
- **Stored team selection:** Use `readStoredTeam()` from `src/lib/storedTeam.ts`. Do not read sessionStorage/localStorage directly in components.
