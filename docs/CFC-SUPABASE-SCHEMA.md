# CFC Front Office — Supabase Schema Reference

**Last Updated:** April 29, 2026

---

## Trade System

### trade_threads
Thread grouping for trade negotiations between two teams.

| Column | Type | Notes |
|--------|------|-------|
| id | uuid | PK |
| league_id | text | |
| team_a_id | text | |
| team_b_id | text | |
| status | text | open / closed |
| created_at | timestamp | |
| updated_at | timestamp | |

### trade_offers
Individual offers within a trade thread.

| Column | Type | Notes |
|--------|------|-------|
| id | uuid | PK |
| thread_id | uuid | FK → trade_threads |
| league_id | text | |
| from_team_id | text | |
| to_team_id | text | |
| assets_from | jsonb | Array of {key, label, type, value} |
| assets_to | jsonb | Array of {key, label, type, value} |
| from_value | numeric | |
| to_value | numeric | |
| status | text | pending / accepted / declined / countered |
| ai_quip | text | JSON string with {to, from} perspective-aware quips |
| created_at | timestamp | |

### trade_messages
Chat messages within a trade thread.

| Column | Type | Notes |
|--------|------|-------|
| id | uuid | PK |
| thread_id | uuid | FK → trade_threads |
| league_id | text | |
| from_team_id | text | |
| message | text | |
| created_at | timestamp | |

### watchlist
Player/pick watchlist per team.

| Column | Type | Notes |
|--------|------|-------|
| id | uuid | PK |
| league_id | text | |
| team_id | text | |
| asset_key | text | e.g. "player:1234" or "pick:2027-1-5" |
| owner_team_id | text | Team that currently owns the asset |
| created_at | timestamp | |

---

## Value System

### cfc_trade_values_current (VIEW)
Canonical CFC base values with multiplier data. This is the universal baseline — not team-specific.

| Column | Type | Notes |
|--------|------|-------|
| sleeper_player_id | text | Player ID from Sleeper |
| display_name | text | Player name OR pick slot (e.g. "1.06", "2.04") |
| cfc_value | numeric | Base CFC value |
| asset_key | text | e.g. "pick 1.01" |
| asset_type | text | "player" or "pick_template" |
| elite_multiplier_applied | numeric | >1.0 = stud |
| age_multiplier_applied | numeric | =1.0 = youth (no age penalty) |
| source_count | integer | Number of sources contributing |

**Key usage:** Pick values are looked up via `display_name` (e.g. "1.06" matches draft_log's `pick_number` format). Stud identification: `elite_multiplier_applied > 1.0`. Youth identification: `age_multiplier_applied = 1.0`.

### cfc_team_trade_values_current
Team-specific adjusted values. This is what the AI uses for gap calculations — each team values assets differently based on their strategy profile.

| Column | Type | Notes |
|--------|------|-------|
| league_id | text | |
| team_id | text | |
| sleeper_player_id | text | |
| player_name | text | |
| position | text | |
| nfl_team | text | |
| base_value | numeric | Raw CFC value |
| auto_value | numeric | Auto-calculated adjusted value |
| manual_override_value | numeric | Manual override if set |
| final_value | numeric | **THE VALUE TO USE** — final adjusted value |
| studs_modifier_pct | numeric | |
| youth_modifier_pct | numeric | |
| market_modifier_pct | numeric | Position market modifier |
| own_guys_modifier_pct | numeric | |
| total_modifier_pct | numeric | |
| is_overridden | boolean | |
| created_at | timestamp | |
| updated_at | timestamp | |

**Key usage:** Player values in trade builder use `final_value` from the team that owns the player. Picks are NOT in this table — use `cfc_trade_values_current` for pick values.

### cfc_team_asset_values_current (VIEW)
Team values with preference multipliers. Similar to cfc_team_trade_values_current.

### cfc_asset_source_values
Raw source-level values from external valuation sources.

### cfc_value_sources
Registry of valuation sources.

| Column | Type | Notes |
|--------|------|-------|
| source_key | text | |
| source_name | text | |
| source_type | text | |

### cfc_value_settings
Global valuation settings.

### cfc_assets
Master asset registry.

| Column | Type | Notes |
|--------|------|-------|
| sleeper_player_id | text | |
| (other columns) | | |

---

## Team Strategy & Profiles

### cfc_team_strategy_profiles
Team strategy set during onboarding. Drives AI recommendations, trade partner rankings, and roster organization.

| Column | Type | Notes |
|--------|------|-------|
| league_id | text | |
| team_id | text | |
| wants_more | jsonb | Array of strings: "elite_producers", "draft_picks", "young_upside", "roster_depth" |
| qb_market | text | "buy" / "hold" / "sell" |
| rb_market | text | "buy" / "hold" / "sell" |
| wr_market | text | "buy" / "hold" / "sell" |
| te_market | text | "buy" / "hold" / "sell" |
| picks_market | text | "buy" / "hold" / "sell" |
| own_guys_preference | text | |
| created_at | timestamp | |
| updated_at | timestamp | |

**Key usage:** Position markets map to onboarding's Low/Med/High via: sell=Low, hold=Med, buy=High. `picks_market` is a full position-level market just like QB/RB/WR/TE — picks flow through the same scoring formula as players.

### cfc_team_player_attachment
Per-player availability tags set during onboarding.

| Column | Type | Notes |
|--------|------|-------|
| league_id | text | |
| team_id | text | |
| sleeper_player_id | text | |
| attachment | text | "untouchable" / "core_piece" / "listening" / "moveable" |

**Display mapping:** Green (#007370) = Moveable, Yellow (#F5C230) = Listening, Black (#1A1A1A) = Core, Red (#E8503A) = Untouchable. All chips are filled with color, fixed width (62px).

### cfc_team_player_value_overrides
Manual value overrides per player per team.

| Column | Type | Notes |
|--------|------|-------|
| league_id | text | |
| sleeper_player_id | text | |

### cfc_team_roster_players
Team roster player registry.

| Column | Type | Notes |
|--------|------|-------|
| sleeper_player_id | text | |

---

## Draft System

### draft_state
Single row per league controlling the draft clock. Uses Sleeper league ID (not canonical UUID).

| Column | Type | Notes |
|--------|------|-------|
| league_id | text | PK — Sleeper league ID |
| status | text | not_started / running / paused / completed |
| seconds_remaining | integer | |
| clock_started_at | timestamp | |
| current_pick_index | integer | |
| pick_submitted | boolean | |
| pick_announced_at | timestamp | |
| starts_at | timestamp | |

**Draft structure:** Two separate drafts per season. Day 1 = Round 1 (1 round, 12 picks). Day 2 = Rounds 2-3 (TBD). The app manages both drafts — not Sleeper. Need to add `draft_phase` column (integer, 1 or 2) to distinguish them. OR use `draft_log` pick exclusion logic instead.

### draft_log
One row per drafted pick. No league_id or season column yet — scope by timestamp for now. Adding league_id + season columns is planned for when Day 2 draft is built.

| Column | Type | Notes |
|--------|------|-------|
| pick_index | integer | Sequential (0-based) |
| pick_number | text | Formatted slot: "1.01", "2.04", "3.12" |
| team_count | integer | Always 12 |
| team_name | text | |
| roster_id | integer | |
| player_id | text | Sleeper player ID |
| player_name | text | |
| positions | jsonb | Array of position strings |
| nfl_team | text | |
| submitted_at | timestamp | Null if not yet picked |
| announced_at | timestamp | |
| is_announced | boolean | |
| is_skip | boolean | Auto-skipped picks |

**Pick exclusion logic:** Query `draft_log` for all rows where `submitted_at IS NOT NULL`. Any `pick_number` found there is a spent pick and should be excluded from trade builder/landing page. This is more precise than using `draft_state` status.

---

## Auth & Teams

### team_email_map
Maps authenticated users to their teams.

| Column | Type | Notes |
|--------|------|-------|
| id | uuid | PK |
| email | text | |
| team_name | text | Full team name (e.g. "Virginia Founders") |
| roster_id | integer | Matches Sleeper roster_id |
| profile_complete | boolean | |
| created_at | timestamp | |
| updated_at | timestamp | |

### active_teams

| Column | Type | Notes |
|--------|------|-------|
| league_id | text | |

---

## Season / League Mapping

### llm_seasons
Canonical season registry. Maps season years to canonical league IDs (not Sleeper IDs).

| Column | Type | Notes |
|--------|------|-------|
| season_id | uuid | Canonical league ID |
| season_year | integer | e.g. 2026 |
| league_name | text | "Cleveland Football Club" |
| regular_season_weeks | integer | |
| playoff_start_week | integer | |
| championship_week | integer | |
| platforms_present | jsonb | e.g. ["sleeper"] |

### ff_source_franchise_map
Bridges source (Sleeper) league IDs to canonical franchise IDs. Has `source_league_id` + `season_year` for mapping.

| Column | Type | Notes |
|--------|------|-------|
| source_franchise_map_id | uuid | PK |
| platform | text | e.g. "sleeper" |
| source_league_id | text | Sleeper league ID |
| season_year | integer | |
| source_team_id | text | |
| source_owner_id | text | |
| franchise_id | uuid | Canonical franchise ID |
| confidence_score | numeric | |
| mapping_method | text | |
| notes | text | |
| created_at | timestamp | |

---

## CFC Year Convention

The CFC year is determined by the March 1 boundary: if today is on or after March 1, CFC year = current calendar year. Before March 1, CFC year = previous calendar year. This drives draft pick exclusion (all picks before CFC year are excluded) and season scoping.

---

## Important Notes

- **Never guess at table schemas.** Always query `information_schema.columns` first.
- Sleeper creates a new `league_id` each season. The current Sleeper league ID is stored in `NEXT_PUBLIC_SLEEPER_LEAGUE_ID` env var.
- `draft_state` uses the Sleeper league ID directly, not the canonical UUID from `llm_seasons`.
- Pick values in `cfc_trade_values_current` use `display_name` format "1.06" (matches `draft_log.pick_number`). Do NOT use `asset_key` format "pick 1.06".
- Future draft picks (years beyond CFC year) use the middle slot value: 1sts = value of "1.06", 2nds = value of "2.06", 3rds = value of "3.06".
