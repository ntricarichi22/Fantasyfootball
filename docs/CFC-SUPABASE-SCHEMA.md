# CFC Front Office — Supabase Schema Reference

**Last Updated:** May 3, 2026

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
Canonical CFC base values with multiplier data. This is the universal baseline — not team-specific. Built on top of `cfc_asset_calculations`.

| Column | Type | Notes |
|--------|------|-------|
| sleeper_player_id | text | Player ID from Sleeper |
| display_name | text | Player name OR pick slot (e.g. "1.06", "2.04") |
| cfc_value | numeric | Base CFC value |
| asset_key | text | e.g. "pick 1.01" |
| asset_type | text | "player" or "pick_template" |
| elite_multiplier_applied | numeric | >1.0 = stud (typically 1.20) |
| age_multiplier_applied | numeric | rookie 1.12, young 1.10, prime 1.00, aging 0.90 |
| source_count | integer | Number of sources contributing |

**Key usage:** Pick values are looked up via `display_name` (e.g. "1.06" matches draft_log's `pick_number` format). Stud identification: `elite_multiplier_applied > 1.0`. Youth identification: `age_multiplier_applied > 1.0` (rookie or young).

### cfc_team_trade_values_current
Team-specific adjusted values. This is what the AI uses for gap calculations — each team values assets differently based on their strategy profile and per-player attachments.

| Column | Type | Notes |
|--------|------|-------|
| league_id | text | |
| team_id | text | |
| sleeper_player_id | text | |
| player_name | text | |
| position | text | |
| nfl_team | text | |
| base_value | numeric | Raw CFC value (from cfc_trade_values_current) |
| auto_value | numeric | Auto-calculated adjusted value (base × (1 + total_modifier_pct)) |
| manual_override_value | numeric | Manual override if set, else NULL |
| final_value | numeric | **THE VALUE TO USE** — manual override if set, else auto_value |
| studs_modifier_pct | numeric | +0.05 if applicable, else 0 |
| youth_modifier_pct | numeric | ±0.05 by age/position, else 0 |
| market_modifier_pct | numeric | Legacy column — always 0 (market modifier removed May 2026) |
| own_guys_modifier_pct | numeric | **Repurposed:** holds the per-player attachment modifier value |
| total_modifier_pct | numeric | Sum of studs + youth + attachment |
| is_overridden | boolean | True if manual_override_value is set |
| created_at | timestamp | |
| updated_at | timestamp | |

**Key usage:** Player values in trade builder use `final_value` from the team that owns the player. Picks are NOT in this table — use `cfc_trade_values_current` for pick values.

### cfc_asset_calculations
Output of `cfc_rebuild_value_layers()` — league-level final values with all multipliers applied.

| Column | Type | Notes |
|--------|------|-------|
| asset_key | text | PK |
| source_count | integer | |
| composite_101_multiple | numeric | Median of source multiples (raw_value / source_1.01_value) |
| composite_value | numeric | composite_101_multiple × $300 |
| elite_multiplier_applied | numeric | 1.20 if composite_value > $300, else 1.00 |
| position_multiplier_applied | numeric | Position tier (QB/WR 1.0, RB tiered, TE tiered) |
| age_multiplier_applied | numeric | rookie 1.12, young 1.10, prime 1.00, aging 0.90 |
| scoring_factor_applied | numeric | CFC-specific scoring factor (rookies 1.0, vets 0.5-1.5) |
| computed_cfc_value | numeric | Pre-override final |
| final_cfc_value | numeric | Manual override if set, else computed_cfc_value |
| rebuilt_at | timestamp | |

### cfc_asset_source_values
Per-source raw player values, refreshed daily by cron.

| Column | Type | Notes |
|--------|------|-------|
| id | uuid | PK |
| import_batch | text | e.g. "auto-2026-05-03" |
| asset_key | text | FK → cfc_assets.asset_key |
| source_key | text | "fantasycalc" / "keeptradecut" / "dynastyprocess" |
| raw_value | numeric | Source's reported value |
| source_101_value | numeric | The source's 1.01 pick value (used as denominator) |
| multiple_101 | numeric | raw_value / source_101_value |

**Constraints:** UNIQUE on (asset_key, source_key). FK on asset_key references cfc_assets.

### cfc_value_sources
Registry of valuation sources. `is_enabled` controls which sources feed into composite.

| Column | Type | Notes |
|--------|------|-------|
| source_key | text | PK ("fantasycalc", "keeptradecut", "dynastyprocess") |
| source_name | text | |
| source_type | text | "api" |
| is_enabled | boolean | Currently enabled: fantasycalc, keeptradecut, dynastyprocess. Disabled: draftsharks, fantasypros, yahoo, manual. |
| created_at | timestamp | |
| updated_at | timestamp | |

### cfc_value_settings
Global valuation settings (multipliers, thresholds, age cutoffs).

Key settings:
- `league_101_value` = 300
- `elite_threshold` = 300
- `elite_multiplier` = 1.20
- `rookie_multiplier` = 1.12
- `young_multiplier` = 1.10
- `aging_multiplier` = 0.90
- `young_age_threshold` = 24
- RB/TE tier floors

### cfc_assets
Master asset registry. ~650 rows (comprehensive dynasty universe, not curated to roster).

| Column | Type | Notes |
|--------|------|-------|
| asset_key | text | PK (e.g. "player.4046") |
| asset_type | text | "player" or "pick_template" |
| display_name | text | |
| sleeper_player_id | text | |
| position | text | |
| birth_date | text | |
| age_override | integer | |
| years_exp | integer | Added May 2026 — populated from Sleeper API in cron |
| manual_override_value | numeric | League-level manual override |
| manual_override_reason | text | |
| is_active | boolean | |

### cfc_player_alias_map
Manual name → sleeper_id overrides for ambiguous matches (e.g., "Kenneth Walker III" → 8151 since multiple Kenneth Walkers exist in Sleeper).

| Column | Type | Notes |
|--------|------|-------|
| source_key | text | |
| source_player_name | text | |
| sleeper_player_id | text | |

### cfc_unmapped_log
Anything that didn't auto-resolve during normalize step. Human review queue.

| Column | Type | Notes |
|--------|------|-------|
| id | uuid | PK |
| source_key | text | |
| source_player_name | text | |
| raw_value | numeric | |
| import_batch | text | |
| resolved | boolean | |
| created_at | timestamp | |

### cfc_player_scoring_factors
Per-player CFC scoring factor computed daily from Sleeper season stats.

| Column | Type | Notes |
|--------|------|-------|
| sleeper_player_id | text | PK |
| scoring_factor | numeric | Final blended factor (0.5 to 1.5) |
| factor_last_season | numeric | Factor from most recent season |
| factor_prior_season | numeric | Factor from prior season |
| source_count | integer | 0 (rookie), 1 (one season), or 2 (blended) |

**Formula:** `cfc_pts = standard_PPR - 1.0×rec + 1.0×rec_fd + 0.5×rush_fd + 0.01×pass_yd`. Factor = cfc_pts / standard_PPR. Vets blend last/prior 70/30. Rookies default to 1.00.

### cfc_team_asset_values_current (VIEW)
Team values with preference multipliers. Similar to cfc_team_trade_values_current.

---

## Team Strategy & Profiles

### cfc_team_strategy_profiles
Team strategy set during onboarding. Drives AI recommendations, trade partner rankings, and roster organization.

| Column | Type | Notes |
|--------|------|-------|
| league_id | text | |
| team_id | text | |
| wants_more | jsonb | Array of strings: "elite_producers", "draft_picks", "young_upside", "roster_depth" (alias: studs, picks, youth, depth) |
| qb_market | text | "buy" / "hold" / "sell" |
| rb_market | text | "buy" / "hold" / "sell" |
| wr_market | text | "buy" / "hold" / "sell" |
| te_market | text | "buy" / "hold" / "sell" |
| picks_market | text | "buy" / "hold" / "sell" |
| own_guys_preference | text | Legacy — no longer used in modifier math (replaced by per-player attachment) |
| created_at | timestamp | |
| updated_at | timestamp | |

**Key usage:** Position markets map to onboarding's Low/Med/High via: sell=Low, hold=Med, buy=High. The position market columns are kept for the LLM advisor's strategic reasoning, but the **market modifier no longer affects player values** — it was removed May 2026.

### cfc_team_player_attachment
Per-player availability tags. **The primary driver of team-level value adjustments as of May 2026.**

| Column | Type | Notes |
|--------|------|-------|
| league_id | text | |
| team_id | text | |
| sleeper_player_id | text | |
| attachment | text | "untouchable" / "core_piece" / "listening" / "moveable" |
| updated_at | timestamp | |

**Modifier values (applied in `rebuildTeamTradeValuesForTeam`):**
- untouchable: +10%
- core_piece: +5%
- listening: 0%
- moveable: -5%

**Display mapping:** Green (#007370) = Moveable, Yellow (#F5C230) = Listening, Black (#1A1A1A) = Core, Red (#E8503A) = Untouchable. All chips are filled with color, fixed width (62px).

### cfc_team_player_value_overrides
Manual value overrides per player per team. Absolute dollar amounts that don't change when league values change.

| Column | Type | Notes |
|--------|------|-------|
| league_id | text | |
| team_id | text | |
| sleeper_player_id | text | |
| manual_override_value | numeric | |
| override_note | text | |
| updated_at | timestamp | |

**Important:** When set, this value becomes the `final_value` directly, bypassing `auto_value`. Cron does NOT touch these — they represent the user's stable signal.

### cfc_team_value_preferences
Existed but currently unused (no rows). May be removed.

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

## League History (slp_*, flea_*, mfl_*)

Historical league data from prior platforms (Fleaflicker and MFL) plus Sleeper league history. Populated by admin ingestion routes (kept for historian troubleshooting). Tables include:

- `slp_raw_global`, `slp_raw_smoke` — raw Sleeper API payloads
- `slp_leagues_mirror`, `slp_transactions_mirror`, `slp_lineup_stats`, `slp_starters_enriched`, `slp_lineups_weekly`
- `slp_player_weekly_game_log`, `slp_player_weekly_presence`, `slp_transaction_items`
- `slp_mirror_draft_results`, `slp_playoff_true_games`, `slp_weekly_high_scores`
- `flea_raw_global`, `flea_raw_smoke`, `flea_mirror_*` — Fleaflicker history
- `mfl_raw_global`, `mfl_raw_smoke`, `mfl_mirror_*` — MFL history

Will be revisited during historian troubleshooting session.

---

## Orphaned / Removed Tables

- ❌ `definitive_values` — dropped May 2026 (old pipeline, replaced by `cfc_asset_calculations`)
- ❌ `cfc_value_upload_staging` — dropped during pipeline rebuild
- ⚠️ `tgif_pick_anchors` — orphaned, slated for drop

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
- The value pipeline rebuild (May 2026) means `cfc_asset_source_values` rows from before that date use a different multiple_101 formula (raw / source_max instead of raw / source_1.01). Old rows from disabled sources have been cleared. The "fix7-preview" import_batch tag on any remaining rows indicates pre-rebuild data.
