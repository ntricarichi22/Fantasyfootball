# CFC Front Office — Shared Files Reference

**A living map of `src/shared/`.** Update this whenever a shared file is added, changed, or retired. The goal: any future chat (or future Nick) can understand the shared layer without re-reading the code.

---

## Architecture principles

1. **Facts vs. analysis.** Two separate modules with a hard boundary.
   - **`league-data`** holds *facts* — undisputable data pulled from Sleeper and Supabase. Rosters, players, picks, values, strategy rows, last-season results. No opinions.
   - **`team-profiles`** holds *analysis* — anything that is a score, rank, weight, or classification. It imports `league-data` and never the other way around.
   - **Boundary test:** if two reasonable people couldn't disagree about it, it's a fact (→ league-data). If it involves a weight, threshold, or label, it's analysis (→ team-profiles).
2. **Functions, not routes.** Shared modules export importable functions. They are *not* HTTP endpoints — that avoids the self-fetch trap (a route calling its own API over the network). Routes import these functions.
3. **Live reads, no new tables.** Every accessor reads fresh on call. We added zero database tables for this layer.
4. **Additive.** This whole layer was built without editing a single pre-existing file.
5. **Golden rule.** Anything spanning more than one department belongs in `src/shared/`.

### Freshness model

- Sleeper reads go through Next's `fetch` with a `revalidate` window, so identical URLs are **deduped within a single request** (fetch-once-per-request) and kept fresh across requests. Windows: players 86400s, league/rosters/picks/users 300s.
- Supabase queries run once each per `getLeagueData()` call.
- Net effect: one `getLeagueData()` call = one coherent snapshot, cheaply.

---

## Module: `src/shared/league-data/` — the FACTS

Public surface is the barrel (`index.ts`); import from `@/shared/league-data`.

### `types.ts` (~101 lines)
The vocabulary for the whole layer. No logic.
- **Core types:** `Position`, `POSITIONS`, `MarketStance` (`buy`/`hold`/`sell`/`unknown`), `AttachmentLevel`.
- **Entity types:** `PlayerInfo`, `RosteredTeam`, `PickInfo`, `StrategyProfile`, `SeasonResult`, `LeagueSettings`, `ValueMaps`.
- **`ResultsSource`** = `"current" | "previous" | "none"` — tells consumers where last-season production came from.
- **`LeagueData`** — the bundle returned by `getLeagueData()`: teams, players, values, picks, strategy, attachments, results map, settings, and a `diagnostics` block.

### `sleeper.ts` (~119 lines)
Raw, typed Sleeper API fetch helpers. The only file that talks to Sleeper.
- `getSleeperLeagueId()` — reads the env var.
- `getJson<T>(url, revalidate, fallback)` — internal fetch wrapper with the revalidate window + safe fallback.
- `fetchPlayers()`, `fetchRosters(leagueId)`, `fetchUsers(leagueId)`, `fetchTradedPicks(leagueId)`, `fetchLeague(leagueId)`.
- Helpers: `playerName(p, fallbackId)`, `playerAge(p)`.
- Sleeper response types: `SleeperPlayer`, `SleeperRoster(+Settings)`, `SleeperUser`, `SleeperLeague`.

### `accessors.ts` (~373 lines)
The public fact API. Composes Sleeper + Supabase into clean shapes. **Largest shared file — watch the 500-line ceiling; if it grows, split Supabase accessors into their own file.**
- Imports `getSupabaseAdminClient` from `@/infrastructure/supabase/admin` and `withComputedDraftPicks` (+ `DraftPick`, `TradedPick`) from `@/infrastructure/picks`.
- **Accessors:**
  - `getPlayerDictionary()` → `Map<sleeperId, PlayerInfo>`
  - `getRosters()` → `RosteredTeam[]` (joins rosters + users for team names)
  - `getPickOwnership()` → `Map<rosterId, PickInfo[]>` (uses `withComputedDraftPicks`, same call shape as the targets route)
  - `getLeagueSettings()` → `LeagueSettings` (incl. `rosterPositions`, `previousLeagueId`)
  - `getValues()` → `ValueMaps` (consensus value + stud flag from `cfc_trade_values_current`)
  - `getStrategyProfiles()` → `{ strategy: Map, attachments: Map }` (from `cfc_team_strategy_profiles` + `cfc_team_player_attachment`)
  - `getLastSeasonResults()` → `{ results, source, previousLeagueId }`. **Reads the current league first; if stats are zeroed (fresh rollover), falls back to `previous_league_id`.** This is why `source` can be `"previous"`.
- **`getLeagueData()`** → `LeagueData | { error }`. Fetches everything in parallel, assembles the bundle, fills `diagnostics`. This is the one call most consumers should use.

### `index.ts` (~11 lines)
Barrel. Re-exports all types + the accessor functions. Always import from here, never deep paths.

---

## Module: `src/shared/team-profiles/` — the ANALYSIS

Public surface is the barrel (`index.ts`); import from `@/shared/team-profiles`.

### `types.ts` (~69 lines)
- **`Tier`** = `championship | playoff | retooling | rebuilding`; `TIERS` (ordered array); `TIER_LABELS` (display strings).
- **Breakdown types:** `LineupSlot`, `StrengthBreakdown` (starterValueRaw / depthBonus / starterValue / benchValue / avgStarterAge / lineup), `ProductionBreakdown` (points / wins / losses / ties / winPct), `CurrentState` (the norms + blended score), `Trajectory` (ascending / contendIntent / tradeLean / direction / nudge / notes).
- **`TeamProfile`** — the final per-team object the whole app consumes.

### `strength.ts` (~107 lines)
Pure roster math. No tiering, no posture.
- `computeStrength(team, values, rosterPositions)` — builds the **optimal starting lineup** for the league's real slots (superflex-aware) via a `SLOT_ELIGIBLE` map (QB / RB / WR / TE / FLEX / WRRB_FLEX / REC_FLEX / SUPER_FLEX), filling restrictive slots first (greedy). Returns starter value, depth bonus (`benchValue × DEPTH_FACTOR`, 0.1), and average starter age.
- `computeProduction(result)` — turns a `SeasonResult` into points / record / winPct.

### `profiler.ts` (~170 lines) — currently revision **07b**
The brain. Turns facts into tiers.
- **Tunable knobs** at the top (see handoff §7): current-state weights, production weights, age thresholds, gap threshold, fire-sale lean, tier count.
- `minMax(values)` — normalizes each axis 0–1 across the league.
- `naturalBreakTiers(scores, k)` — assigns tiers by the `k-1` largest gaps in the sorted current-state curve (same idea as the Big Board auto-tiering). **Strength sets the tier.**
- `computeTrajectory(...)` — **informational only.** Produces `ascending` (age + value/production gap), `contendIntent` (from `wantsMore` + `picksMarket`, accepting BOTH short and long want labels), and `direction`. Does not move tiers.
- `isSellSignal(wantsMore, tradeLean)` — the **lone demote trigger**: only-stated-want-is-picks, OR `tradeLean <= FIRE_SALE_LEAN` (dormant until trades exist).
- `buildTeamProfiles(data, ourRosterId?)` → sorted `TeamProfile[]`. Computes strengths + productions, normalizes, blends the current-state score, assigns base tiers, applies the ±1 sell-signal nudge, and returns profiles sorted by tier then score. (`ourRosterId` is reserved for flagging "us" downstream.)

### `index.ts` (~3 lines)
Barrel. Re-exports types + `computeStrength` / `computeProduction` / `buildTeamProfiles`.

---

## Debug route (not shared, but part of this work)

### `src/app/api/league/profiles/route.ts` — currently revision **09b** (~58 lines)
`GET /api/league/profiles`. The verification surface for the whole layer.
- `force-dynamic`, `maxDuration` 30.
- Calls `getLeagueData()` + `buildTeamProfiles()`.
- Returns: `diagnostics`, `keyCheck` (strategyKeys vs rosterIds — catches key mismatches), a flat `summary` table (tier / base / final / nudge / score / norms / record / age / ascending / contendIntent / **echoed wantsMore + markets + persona + intentResolved**), and full `profiles`.
- Keep this around — it's how we tune without guessing.

---

## Commit / deploy order for this layer

Dependencies first, then importers, route last:

1. `src/shared/league-data/types.ts`
2. `src/shared/league-data/sleeper.ts`
3. `src/shared/league-data/accessors.ts`
4. `src/shared/league-data/index.ts`
5. `src/shared/team-profiles/types.ts`
6. `src/shared/team-profiles/strength.ts`
7. `src/shared/team-profiles/profiler.ts`
8. `src/shared/team-profiles/index.ts`
9. `src/app/api/league/profiles/route.ts`

---

## Extending this layer

- **New fact** (e.g. injuries, bye weeks, FAAB): add to `league-data` — types first, a fetch helper in `sleeper.ts` (or a Supabase accessor in `accessors.ts`), expose via `getLeagueData()` + barrel. Never put it in `team-profiles`.
- **New analysis** (e.g. positional needs, trade-fit scores, playoff odds): add to `team-profiles`, consuming `LeagueData`. If it's a distinct concern, give it its own file rather than bloating `profiler.ts`.
- **Watch line counts.** `accessors.ts` (~373) is the closest to the 500 ceiling. Split before it crosses.
- **Don't re-fetch in consumers.** Call `getLeagueData()` once and pass the bundle down.

---

## Cleanup candidates (retire as we migrate)

These predate the shared layer and are now superseded — migrate their callers to `@/shared/...`, then delete:

- `src/scouting/intel/dataLayer.ts` — the predecessor of `league-data`. Re-point to `@/shared/league-data`.
- `src/scouting/intel/teamProfiles.ts` — the predecessor of `team-profiles`. Re-point to `@/shared/team-profiles`.
- `src/app/api/scouting/intel/profiles/route.ts` — superseded by `/api/league/profiles` (or keep one, not both).

When retiring a file: confirm no remaining imports, migrate callers, delete, and **update this doc.**
