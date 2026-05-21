# CFC Front Office — Shared Files Reference

**A living map of `src/shared/`.** Update this whenever a shared file is added, changed, or retired. The goal: any future chat (or future Nick) can understand the shared layer without re-reading the code.

---

## Architecture principles

1. **Facts vs. analysis vs. valuation.** Three modules with hard boundaries.
   - **`league-data`** holds *facts* — undisputable data pulled from Sleeper and Supabase. Rosters, players, picks, pick ladder, values, strategy rows, last-season results, team nicknames. No opinions.
   - **`team-profiles`** holds *analysis* — anything that is a score, rank, weight, or classification (tiers, trajectory). It imports `league-data` and never the other way around.
   - **`asset-values`** holds *valuation* — the single front door for "what is this asset worth," for both players and picks, base or team-adjusted. It imports `league-data` and is server-only.
   - **Boundary test:** if two reasonable people couldn't disagree about it, it's a fact (→ league-data). If it involves a weight, threshold, or label, it's analysis (→ team-profiles). If it answers "what's it worth," it's valuation (→ asset-values).
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

### `types.ts` (~114 lines)
The vocabulary for the whole layer. No logic.
- **Core types:** `Position`, `POSITIONS`, `MarketStance` (`buy`/`hold`/`sell`/`unknown`), `AttachmentLevel` (`untouchable` / `core_piece` / `listening` / `moveable`).
- **Entity types:** `PlayerInfo`, `RosteredTeam` (`rosterId`, `teamName`, `ownerId`, `playerIds`, `starterIds`, `players`), `StrategyProfile`, `SeasonResult`, `LeagueSettings`, `ValueMaps`.
- **Pick types:**
  - `OwnedPick` — `{ key, season, round, slot|null, overall|null, kind, currentRosterId, originalRosterId }`. `kind` = `"current"` (season === cfcYear) or `"future"`. `originalRosterId` ≠ `currentRosterId` means the pick was acquired ("via"). `key` is the canonical pick key (see accessors).
  - `PickLadder` = `Map<string, number>` — zero-padded slot label (`"2.04"`) → consensus pick value.
- **`ResultsSource`** = `"current" | "previous" | "none"` — tells consumers where last-season production came from.
- **`LeagueData`** — the bundle returned by `getLeagueData()`: teams, players, values, `pickOwnership` (`Map<rosterId, OwnedPick[]>`), strategy, attachments, results map, settings, `cfcYear`, and a `diagnostics` block.

### `sleeper.ts` (~119 lines)
Raw, typed Sleeper API fetch helpers. The only file that talks to Sleeper.
- `getSleeperLeagueId()` — reads the env var.
- `getJson<T>(url, revalidate, fallback)` — internal fetch wrapper with the revalidate window + safe fallback.
- `fetchPlayers()`, `fetchRosters(leagueId)`, `fetchUsers(leagueId)`, `fetchTradedPicks(leagueId)`, `fetchLeague(leagueId)`.
- Helpers: `playerName(p, fallbackId)`, `playerAge(p)`.
- Sleeper response types: `SleeperPlayer`, `SleeperRoster(+Settings)`, `SleeperUser`, `SleeperLeague`.

### `accessors.ts` (~439 lines)
The public fact API. Composes Sleeper + Supabase into clean shapes. **Largest shared file — watch the 500-line ceiling; if it grows, split Supabase accessors into their own file.**
- Imports `getSupabaseAdminClient` from `@/infrastructure/supabase/admin` and `withComputedDraftPicks` (+ `DraftPick`, `TradedPick`) from `@/infrastructure/picks`.
- **Accessors:**
  - `getPlayerDictionary()` → `Map<sleeperId, PlayerInfo>`
  - `getRosters()` → `RosteredTeam[]` (joins rosters + users for team names)
  - `getPickOwnership()` → `Map<rosterId, OwnedPick[]>`. Enumerates current + future picks, drops spent ones (via draft log), and emits **canonical pick keys** byte-identical to the legacy targets route: current = `pick:${season}-${round}-${slot||"tbd"}-${originalRosterId}` (slot RAW, trailing id = ORIGINAL owner); future = `pick:${season}-${round}-${originalRosterId}`. This key is the join id everywhere picks are stored/valued.
  - `getPickValues()` → `PickLadder`. The pick price ladder from `cfc_trade_values_current` rows where `asset_type='pick_template'` (`display_name` zero-padded `"2.04"` → `cfc_value`). Keys use raw slot, ladder is padded → **pad on lookup**.
  - `getLeagueSettings()` → `LeagueSettings` (incl. `rosterPositions`, `previousLeagueId`)
  - `getValues()` → `ValueMaps` (consensus value + stud flag from `cfc_trade_values_current`)
  - `getStrategyProfiles()` → `{ strategy: Map, attachments: Map }` (from `cfc_team_strategy_profiles` + `cfc_team_player_attachment`)
  - `getLastSeasonResults()` → `{ results, source, previousLeagueId }`. **Reads the current league first; if stats are zeroed (fresh rollover), falls back to `previous_league_id`.** This is why `source` can be `"previous"`.
- **`getLeagueData()`** → `LeagueData | { error }`. Fetches everything in parallel, assembles the bundle, fills `diagnostics`. This is the one call most consumers should use.

### `nicknames.ts` (~24 lines)
Team nickname resolution — a shared FACT used anywhere a short team name is shown (e.g. "via Crossfitters").
- `teamNickname(fullName)` → short name. **General rule = last word** (`"Cleveland Founders"` → `Founders`), which also handles multi-word *cities* for free (`"Windy City Crossfitters"` → `Crossfitters`).
- The only case the rule can't infer is a multi-word *nickname*; those live in the `MULTI_WORD_NICKNAMES` map at the top of the file (key = how the full name ends, lowercased; value = display). Seeded with `"matzos balls" → "Matzos Balls"`. Add one line per new multi-word nickname.

### `index.ts` (~14 lines)
Barrel. Re-exports all types + the accessor functions (incl. `getPickOwnership`, `getPickValues`) + `teamNickname`. Always import from here, never deep paths.

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

## Module: `src/shared/asset-values/` — the VALUATION

The single front door for "what is this asset worth," players and picks alike, base or team-adjusted. **Server-only** (imports the Supabase admin client + `league-data`) — client components must NOT import from `@/shared/asset-values`; go through an API route. Public surface is the barrel (`index.ts`); import from `@/shared/asset-values`.

### `modifiers.ts` (~42 lines)
The pure valuation knobs. No I/O.
- **`TIER_TO_SLOT`** — `Record<Tier, number>`: maps an owner's tier to the draft slot a future pick is assumed to land at — championship → 11, playoff → 8, retooling → 5, rebuilding → 2.
- **`yearDiscount(yearsOut)`** — future-pick discount: 0.95 one year out, 0.90 beyond.
- **`AVAILABILITY_PCT`** — `Record<AttachmentLevel, number>`: untouchable +10, core_piece +5, listening 0, moveable −5.
- **`CLASS_STRENGTH_PCT`** — `Record<ClassStrength, number>` (`weak`/`average`/`stacked`): weak −10, average 0, stacked +10.
- **`ClassStrength`** type.
- **`applyModifiers(base, percents[])`** — stacks additive percent adjusters on a base value.

### `valuation.ts` (~135 lines)
The valuation engine.
- **`AssetRef`** = `{ type:"player", sleeperPlayerId }` | `{ type:"pick", key }`.
- **`ValuationContext`** — the prebuilt bundle (player values, pick ladder, team tiers, stored team-adjusted rows) so a batch of valuations shares one set of reads.
- **`buildValuationContext()`** — assembles the context once (call before valuing a set).
- **`valueAsset(asset, ctx, opts?)`** — returns a number.
  - No `perspective` → **base** value. Player = consensus value. Pick = current-year exact slot off the ladder; future = original owner's tier → `TIER_TO_SLOT` → slot → ladder × `yearDiscount`. (Current pick with a null slot falls back to the `R.06` ladder rung. Slot padded on ladder lookup.)
  - With `perspective` (a team id) → the **stored team-adjusted** value wins if present (the row written by the R&S pick rebuild / player engine).
- **`getAssetValue(asset, opts?)`** — convenience one-shot: builds a context and values a single asset.

### `index.ts` (~15 lines)
Barrel. Re-exports all modifier symbols + `ClassStrength`, and the valuation symbols (`AssetRef`, `ValuationContext`, `buildValuationContext`, `valueAsset`, `getAssetValue`).

> **Where adjusted values are written:** `asset-values` *reads* stored adjusted rows; it doesn't write them. The R&S domain owns the write — `pickService.rebuildPickValuesForTeam()` enumerates a team's picks via `getPickOwnership`, values each base via `valueAsset`, stacks availability + class-strength via `applyModifiers`, and upserts PICK rows into `cfc_team_trade_values_current` (keyed by pick key, `position="PICK"`, owner tag stashed in the repurposed `nfl_team` column). The Set Availability page reads those rows back through `/api/research-strategy/pick-values`.

---

---

## Module: `src/shared/components/` — shared UI

Cross-department React components. Pure presentation, `"use client"`, inline styles only (neobrutalist constraint). The only per-department inputs are passed as props; the layout/treatment is shared so directors don't drift apart.

### `DirectorTwoBox.tsx` (~95 lines)
The page-level director "two-box" intro panel — the director greeting you as you enter a room. Two cells in one 2.5px-bordered box (no rounded corners, no shadow): a black left cell with a circular avatar + stacked mono-caps label, and a paper right cell with one fluid-sized (`clamp`) message line.
- **Props:** `avatarSrc` (e.g. `/avatars/pro-personnel.png`, `/avatars/strategy.png`), `label` (e.g. `"Personnel Director"` / `"Strategy Director"` — each word stacks on its own line), `message` (the intro string for that surface/state).
- **Dumb presentation.** The parent decides the avatar, label, and copy; state-driven copy (intro / empty / returning) is chosen by the page and passed in.
- **Consumers:** Pro Personnel `BuilderCyclerView` + `TradeStudioView` (pass the Personnel avatar/label); Strategy `SetAvailabilityPage` (Strategy avatar/label) and `SetStrategyPage` when built. Avatars live in `public/avatars/`.
- Slim by design (48px avatar, tight padding) to protect vertical space on no-scroll pages.



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
4. `src/shared/league-data/nicknames.ts`
5. `src/shared/league-data/index.ts`
6. `src/shared/asset-values/modifiers.ts`
7. `src/shared/asset-values/valuation.ts`
8. `src/shared/asset-values/index.ts`
9. `src/shared/components/DirectorTwoBox.tsx`
10. `src/shared/team-profiles/types.ts`
11. `src/shared/team-profiles/strength.ts`
12. `src/shared/team-profiles/profiler.ts`
13. `src/shared/team-profiles/index.ts`
14. `src/app/api/league/profiles/route.ts`

---

## Extending this layer

- **New fact** (e.g. injuries, bye weeks, FAAB): add to `league-data` — types first, a fetch helper in `sleeper.ts` (or a Supabase accessor in `accessors.ts`), expose via `getLeagueData()` + barrel. Never put it in `team-profiles`.
- **New analysis** (e.g. positional needs, trade-fit scores, playoff odds): add to `team-profiles`, consuming `LeagueData`. If it's a distinct concern, give it its own file rather than bloating `profiler.ts`.
- **New valuation rule** (e.g. a new adjuster, a different pick model): add the knob to `asset-values/modifiers.ts` and the logic to `valuation.ts`. Keep `asset-values` server-only; never import it from a client component.
- **Watch line counts.** `accessors.ts` (~439) is the closest to the 500 ceiling. Split before it crosses.
- **Don't re-fetch in consumers.** Call `getLeagueData()` (or `buildValuationContext()`) once and pass the bundle down.

---

## Cleanup candidates (retire as we migrate)

These predate the shared layer and are now superseded — migrate their callers to `@/shared/...`, then delete:

- `src/scouting/intel/dataLayer.ts` — the predecessor of `league-data`. Re-point to `@/shared/league-data`.
- `src/scouting/intel/teamProfiles.ts` — the predecessor of `team-profiles`. Re-point to `@/shared/team-profiles`.
- `src/app/api/scouting/intel/profiles/route.ts` — superseded by `/api/league/profiles` (or keep one, not both).

When retiring a file: confirm no remaining imports, migrate callers, delete, and **update this doc.**
