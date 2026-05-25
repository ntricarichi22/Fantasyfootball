# CFC Front Office — `src/shared/` Map

**The shared layer = anything spanning more than one department.** Scouting-only, trade-only, etc. logic does NOT live here (golden rule). Three modules: `league-data` (raw facts), `team-profiles` (analysis), `team-dossier` (plain-English framing). Each is `getX()`-accessor + pure builders; call `getLeagueData()` once and pass the bundle down.

> **Updated this arc (draft-engine build).** Three small additions, all consumed by the scouting `draft-fit` / `draft-sim` layers (which themselves live in `src/scouting/`, NOT here):
> 1. `team-profiles`: **`SLOT_ELIGIBLE` now exported**, and **`StrengthBreakdown.bucketAge`** added.
> 2. `league-data`: **`ValueMaps.rookieQbBoost`** added (reads the `rookie_qb_boost` column).

---

## `src/shared/league-data/` — raw facts (no scores, no judgment)

- **`types.ts`** — the vocabulary. `Position` (QB/RB/WR/TE), `PlayerInfo`, `RosteredTeam`, `OwnedPick` (current+future, canonical `key`, `slot`/`overall`), `StrategyProfile` (incl. merged `pcMarket`), `SeasonResult`, `LeagueSettings`, `PickLadder`, and the full `LeagueData` bundle.
  - **`ValueMaps` = `{ value, isStud, rookieQbBoost }`** — all `Map<sleeperPlayerId, …>`. `value` = `cfc_value`; `isStud` = `elite_multiplier_applied > 1.0`; **`rookieQbBoost`** = the `rookie_qb_boost` multiplier (1.25 #1 overall … 1.05 top-15/20, ~1.0 otherwise). NEW this arc.
- **`accessors.ts`** — Supabase + Sleeper readers. `getValues()` reads `sleeper_player_id, cfc_value, elite_multiplier_applied, rookie_qb_boost` from `cfc_trade_values_current`. `getLeagueData()` assembles the full bundle. `getPickOwnership()` backs out spent picks via `draft_log`. (Note: the live prospect pool consumed by scouting still includes drafted players until that cleanup lands — see handoff §9.)
- **`sleeper.ts`** — low-level Sleeper API (players dict, rosters, users, traded picks, league), with revalidate windows. `playerName`, `playerAge`.
- **`nicknames.ts`** — `teamNickname(fullName)`: last-word rule, with `MULTI_WORD_NICKNAMES` overrides.
- **`index.ts`** — barrel: re-exports types + all `getX` accessors + `teamNickname`.

## `src/shared/team-profiles/` — analysis (tiers, trajectory, needs, strength)

- **`types.ts`** — `Tier` (championship/playoff/retooling/rebuilding), `LineupSlot`, `StrengthBreakdown`, `ProductionBreakdown`, `CurrentState`, `Trajectory`, the need vocabulary (`NeedBucket` = QB/RB/PASS_CATCHER, `NeedLevel`, `NeedDetail`, `TeamNeeds`), and `TeamProfile`.
  - **`StrengthBreakdown.bucketAge: Record<NeedBucket, number|null>`** — per-bucket average starter age, alongside `avgStarterAge`. Raw fact only (no old/young label). NEW this arc; computed in `strength.ts`.
- **`strength.ts`** — `computeStrength(team, values, rosterPositions)`: builds the optimal legal lineup (greedy, most-restrictive-slot-first), sums value, computes `avgStarterAge` + `bucketAge`. **Exports `SLOT_ELIGIBLE`** (what position starts in what slot — QB, RB, WR, TE, FLEX, WRRB_FLEX, REC_FLEX, SUPER_FLEX + aliases). NEW export this arc — scouting reads it for startable-upgrade math. Also `computeProduction(result)`.
- **`needs.ts`** — `computeNeeds(data)` → `Map<rosterId, TeamNeeds>`. League-relative per bucket: starter-unit value (top-K) + depth man, min-maxed across 12 teams. `score = 0.75*(1-starterNorm) + 0.25*(1-depthNorm)`; levels high ≥ 0.70 / med ≥ 0.34 / low. **Deliberately age-free and posture-free** (those belong to the dossier / scouting POV, not raw need).
- **`profiler.ts`** — `buildTeamProfiles(data, ourRosterId?)`: current-state score (0.6 starterValue + 0.4 production) → natural-break tiers; trajectory (ascending/steady/declining, contendIntent); bakes `needs` onto each profile. Sorted by tier.
- **`index.ts`** — barrel: types + `computeStrength`, `computeProduction`, **`SLOT_ELIGIBLE`**, `buildTeamProfiles`, `computeNeeds`.

## `src/shared/team-dossier/` — plain-English framing (computes nothing new)

- **`types.ts`** — `Window` (contending/ascending/closing/rebuilding), `Confidence` (strong/thin), `TeamDossier` (`verdict`, `window`, `wants`, `sells`, `coreLabel`, `tradeStance`, `persona`, `picksLocked`, `confidence`).
- **`builder.ts`** — `buildTeamDossiers(profiles, data)`: frames existing profile fields + live strategy/attachment rows into a scout-voice report. Window from tier + age + trajectory; reads `pcMarket`; `coreLabel` splits untouchable players from locked picks; `picksLocked` boolean for the trade engine. Reads live strategy so it reflects app updates with no rewiring.
- **`index.ts`** — barrel.

---

## Debug routes over the shared layer
- **`/api/league/profiles`** — tiers, trajectory, `avgStarterAge`, `bucketAge`, `rosterPositions` (diagnostics).
- **`/api/league/needs`** — per-team-per-bucket need (level + score).
- **`/api/league/dossiers`** — the framing layer.

## Consumers (NOT in shared — they live in `src/scouting/`)
- `src/scouting/draft-fit/` — the fit grid (need/upgrade/asset). Reads `SLOT_ELIGIBLE`, `TeamProfile.needs`, `ValueMaps`.
- `src/scouting/draft-sim/` — the draft engine. Reads the fit grid + dossiers + `rookieQbBoost` + `bucketAge`.

## Extending the shared layer (rule of thumb)
Bake on **new, expensive, shared** computation (e.g. `needs`); do NOT bake on trivial thresholds of data already present (e.g. an old/young label — derive it in the layer above). New analysis a single department needs stays in that department's folder. A raw fact that a *future* second consumer might want (e.g. `bucketAge`) can live in shared even if only one department reads it today — but only because shared can't import from a department, so a fact the dossier might need can't live in scouting.
