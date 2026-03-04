/**
 * Sleeper ingestion pipeline — Layer 1 (raw) + Layer 2 (flattened)
 *
 * Layer 1: stores the exact Sleeper API payload as raw_json in slp_raw_* tables.
 * Layer 2: flattens each payload into queryable slp_* mirror tables.
 *
 * All writes are idempotent UPSERTs — safe to rerun without creating duplicates.
 */

import type { SupabaseClient } from "@supabase/supabase-js";
import {
  fetchLeague,
  fetchLeagueUsers,
  fetchLeagueRosters,
  fetchLeagueMatchups,
  fetchWinnersBracket,
  fetchLosersBracket,
  fetchLeagueTransactions,
  fetchTradedPicks,
  fetchLeagueDrafts,
  fetchDraft,
  fetchDraftPicks,
  fetchDraftTradedPicks,
  fetchNflPlayers,
  fetchLeagueChain,
  type SleeperLeague,
  type SleeperBracketGame,
} from "./sleeperApi";

// ─── Constants ────────────────────────────────────────────────────────────────

/** Maximum number of weeks to attempt when fetching matchups and transactions. */
const MAX_SEASON_WEEKS = 18;
const ROSTER_ID_STRIDE = 100_000;

/** Maximum batch size for Supabase upserts to avoid payload limits. */
const UPSERT_CHUNK_SIZE = 500;

// ─── Helpers ──────────────────────────────────────────────────────────────────

function fromUnixMs(ms: number | null | undefined): string | null {
  if (!ms) return null;
  return new Date(ms).toISOString();
}

function syntheticMatchupId(week: number, rosterId: number): number {
  return -(week * ROSTER_ID_STRIDE + rosterId);
}

// ─── Schema-safe payload helpers ──────────────────────────────────────────────

/**
 * Per-request cache of table column sets.
 *
 * On first access for a given table the column names are fetched via the
 * `slp_get_table_columns` RPC function (which reads `information_schema.columns`)
 * and then reused for every subsequent upsert in the same ingest run.
 *
 * If the RPC call fails the cache returns an empty set, causing payloads to be
 * passed through without filtering (fail-open) so a missing helper function
 * never silently drops data.
 */
export class SchemaCache {
  private readonly cols = new Map<string, Set<string>>();

  constructor(private readonly db: SupabaseClient) {}

  async get(table: string): Promise<Set<string>> {
    if (!this.cols.has(table)) {
      const { data, error } = await this.db.rpc("slp_get_table_columns", {
        p_table: table,
      });
      if (error) {
        console.warn(
          `[SchemaCache] Cannot fetch columns for "${table}": ${error.message} — payload will not be filtered.`,
        );
        return new Set<string>(); // empty → pass-through; NOT cached so the next call retries
      }
      // Cache the result even when the column list is empty (unknown/schema-less table).
      this.cols.set(table, new Set((data as string[] | null) ?? []));
    }
    return this.cols.get(table)!;
  }
}

/**
 * Strip keys from `row` that are not in `allowed`.
 * Returns the filtered row and an array of dropped key names.
 * When `allowed` is empty (schema unknown) the original row is returned as-is.
 */
function filterRow<T extends Record<string, unknown>>(
  row: T,
  allowed: Set<string>,
): { row: Partial<T>; dropped: string[] } {
  if (allowed.size === 0) return { row, dropped: [] };
  const out = {} as Partial<T>;
  const dropped: string[] = [];
  for (const [k, v] of Object.entries(row)) {
    if (allowed.has(k)) (out as Record<string, unknown>)[k] = v;
    else dropped.push(k);
  }
  return { row: out, dropped };
}

/**
 * Like `filterRow` but for an array of rows.
 * Returns the union of all dropped key names across the array.
 */
function filterRows<T extends Record<string, unknown>>(
  rows: T[],
  allowed: Set<string>,
): { rows: Partial<T>[]; dropped: string[] } {
  if (allowed.size === 0) return { rows, dropped: [] };
  const droppedSet = new Set<string>();
  const filtered = rows.map((r) => {
    const { row, dropped } = filterRow(r, allowed);
    for (const d of dropped) droppedSet.add(d);
    return row;
  });
  return { rows: filtered, dropped: [...droppedSet] };
}

// ─── Layer 1: raw storage ─────────────────────────────────────────────────────

async function rawUpsertLeague(
  db: SupabaseClient,
  league: SleeperLeague,
): Promise<void> {
  const { error } = await db.from("slp_raw_league").upsert(
    {
      league_id: league.league_id,
      raw_json: league as unknown as Record<string, unknown>,
      fetched_at: new Date().toISOString(),
    },
    { onConflict: "league_id" },
  );
  if (error) throw new Error(`slp_raw_league upsert: ${error.message}`);
}

async function rawUpsertRosters(
  db: SupabaseClient,
  leagueId: string,
): Promise<ReturnType<typeof fetchLeagueRosters>> {
  const rosters = await fetchLeagueRosters(leagueId);
  const { error } = await db.from("slp_raw_rosters").upsert(
    {
      league_id: leagueId,
      raw_json: rosters as unknown as Record<string, unknown>,
      fetched_at: new Date().toISOString(),
    },
    { onConflict: "league_id" },
  );
  if (error) throw new Error(`slp_raw_rosters upsert: ${error.message}`);
  return rosters;
}

async function rawUpsertUsers(
  db: SupabaseClient,
  leagueId: string,
): Promise<ReturnType<typeof fetchLeagueUsers>> {
  const users = await fetchLeagueUsers(leagueId);
  const { error } = await db.from("slp_raw_users").upsert(
    {
      league_id: leagueId,
      raw_json: users as unknown as Record<string, unknown>,
      fetched_at: new Date().toISOString(),
    },
    { onConflict: "league_id" },
  );
  if (error) throw new Error(`slp_raw_users upsert: ${error.message}`);
  return users;
}

async function rawUpsertMatchups(
  db: SupabaseClient,
  leagueId: string,
  week: number,
): Promise<ReturnType<typeof fetchLeagueMatchups>> {
  const matchups = await fetchLeagueMatchups(leagueId, week);
  if (!matchups?.length) return matchups;
  const { error } = await db.from("slp_raw_matchups").upsert(
    {
      league_id: leagueId,
      week,
      raw_json: matchups as unknown as Record<string, unknown>,
      fetched_at: new Date().toISOString(),
    },
    { onConflict: "league_id,week" },
  );
  if (error) throw new Error(`slp_raw_matchups upsert week ${week}: ${error.message}`);
  return matchups;
}

async function rawUpsertBrackets(
  db: SupabaseClient,
  leagueId: string,
): Promise<{ winners: SleeperBracketGame[]; losers: SleeperBracketGame[] }> {
  const [winners, losers] = await Promise.all([
    fetchWinnersBracket(leagueId),
    fetchLosersBracket(leagueId),
  ]);

  if (winners?.length) {
    const { error } = await db.from("slp_raw_winners_bracket").upsert(
      {
        league_id: leagueId,
        raw_json: winners as unknown as Record<string, unknown>,
        fetched_at: new Date().toISOString(),
      },
      { onConflict: "league_id" },
    );
    if (error) throw new Error(`slp_raw_winners_bracket upsert: ${error.message}`);
  }

  if (losers?.length) {
    const { error } = await db.from("slp_raw_losers_bracket").upsert(
      {
        league_id: leagueId,
        raw_json: losers as unknown as Record<string, unknown>,
        fetched_at: new Date().toISOString(),
      },
      { onConflict: "league_id" },
    );
    if (error) throw new Error(`slp_raw_losers_bracket upsert: ${error.message}`);
  }

  return { winners: winners ?? [], losers: losers ?? [] };
}

async function rawUpsertTransactions(
  db: SupabaseClient,
  leagueId: string,
  week: number,
): Promise<ReturnType<typeof fetchLeagueTransactions>> {
  const txns = await fetchLeagueTransactions(leagueId, week);
  if (!txns?.length) return txns;
  const { error } = await db.from("slp_raw_transactions").upsert(
    {
      league_id: leagueId,
      week,
      raw_json: txns as unknown as Record<string, unknown>,
      fetched_at: new Date().toISOString(),
    },
    { onConflict: "league_id,week" },
  );
  if (error) throw new Error(`slp_raw_transactions upsert week ${week}: ${error.message}`);
  return txns;
}

async function rawUpsertTradedPicks(
  db: SupabaseClient,
  leagueId: string,
): Promise<ReturnType<typeof fetchTradedPicks>> {
  const picks = await fetchTradedPicks(leagueId);
  const { error } = await db.from("slp_raw_traded_picks").upsert(
    {
      league_id: leagueId,
      raw_json: (picks ?? []) as unknown as Record<string, unknown>,
      fetched_at: new Date().toISOString(),
    },
    { onConflict: "league_id" },
  );
  if (error) throw new Error(`slp_raw_traded_picks upsert: ${error.message}`);
  return picks;
}

async function rawUpsertDrafts(
  db: SupabaseClient,
  leagueId: string,
): Promise<ReturnType<typeof fetchLeagueDrafts>> {
  const drafts = await fetchLeagueDrafts(leagueId);
  const { error } = await db.from("slp_raw_drafts").upsert(
    {
      league_id: leagueId,
      raw_json: (drafts ?? []) as unknown as Record<string, unknown>,
      fetched_at: new Date().toISOString(),
    },
    { onConflict: "league_id" },
  );
  if (error) throw new Error(`slp_raw_drafts upsert: ${error.message}`);
  return drafts;
}

async function rawUpsertDraft(
  db: SupabaseClient,
  draftId: string,
): Promise<ReturnType<typeof fetchDraft>> {
  const draft = await fetchDraft(draftId);
  const { error } = await db.from("slp_raw_draft").upsert(
    {
      draft_id: draftId,
      raw_json: draft as unknown as Record<string, unknown>,
      fetched_at: new Date().toISOString(),
    },
    { onConflict: "draft_id" },
  );
  if (error) throw new Error(`slp_raw_draft upsert: ${error.message}`);
  return draft;
}

async function rawUpsertDraftPicks(
  db: SupabaseClient,
  draftId: string,
): Promise<ReturnType<typeof fetchDraftPicks>> {
  const picks = await fetchDraftPicks(draftId);
  const { error } = await db.from("slp_raw_draft_picks").upsert(
    {
      draft_id: draftId,
      raw_json: (picks ?? []) as unknown as Record<string, unknown>,
      fetched_at: new Date().toISOString(),
    },
    { onConflict: "draft_id" },
  );
  if (error) throw new Error(`slp_raw_draft_picks upsert: ${error.message}`);
  return picks;
}

async function rawUpsertDraftTradedPicks(
  db: SupabaseClient,
  draftId: string,
): Promise<ReturnType<typeof fetchDraftTradedPicks>> {
  const picks = await fetchDraftTradedPicks(draftId);
  const { error } = await db.from("slp_raw_draft_traded_picks").upsert(
    {
      draft_id: draftId,
      raw_json: (picks ?? []) as unknown as Record<string, unknown>,
      fetched_at: new Date().toISOString(),
    },
    { onConflict: "draft_id" },
  );
  if (error) throw new Error(`slp_raw_draft_traded_picks upsert: ${error.message}`);
  return picks;
}

// ─── Layer 2: flattened mirrors ───────────────────────────────────────────────

async function flatLeague(
  db: SupabaseClient,
  league: SleeperLeague,
  sc: SchemaCache,
): Promise<void> {
  // playoff_week_start is NOT a top-level column in the deployed schema;
  // its value lives inside the settings JSONB blob alongside other settings.
  // raw_json is NOT NULL in the deployed schema — always include the full
  // league object so the constraint is satisfied even after payload filtering.
  const payload: Record<string, unknown> = {
    league_id: league.league_id,
    season: league.season,
    name: league.name,
    status: league.status,
    sport: league.sport,
    season_type: league.season_type,
    total_rosters: league.total_rosters,
    previous_league_id: league.previous_league_id,
    draft_id: league.draft_id,
    settings: league.settings,
    scoring_settings: league.scoring_settings,
    roster_positions: league.roster_positions,
    metadata: league.metadata,
    raw_json: league as unknown as Record<string, unknown>,
    updated_at: new Date().toISOString(),
  };
  const allowed = await sc.get("slp_leagues");
  const { row: filtered, dropped } = filterRow(payload, allowed);
  if (dropped.length) {
    console.warn(`[flatLeague] Dropping non-schema keys: ${dropped.join(", ")}`);
  }

  // Hard guard: raw_json must be present and non-null before we hit Supabase.
  if (filtered.raw_json == null) {
    throw new Error(
      `slp_leagues upsert: raw_json is missing/null for league_id=${league.league_id} season=${league.season}. ` +
        `This should never happen — raw_json was in the payload but was dropped by schema filtering, ` +
        `which means the deployed table no longer has a raw_json column.`,
    );
  }

  const { error } = await db
    .from("slp_leagues")
    .upsert(filtered, { onConflict: "league_id" });
  if (error) throw new Error(`slp_leagues upsert: ${error.message}`);
}

async function flatUsers(
  db: SupabaseClient,
  leagueId: string,
  users: Awaited<ReturnType<typeof fetchLeagueUsers>>,
  sc: SchemaCache,
): Promise<void> {
  if (!users?.length) return;
  const rawRows = users.map((u) => ({
    league_id: leagueId,
    user_id: u.user_id,
    display_name: u.display_name,
    team_name: u.metadata?.team_name ?? null,
    avatar: u.avatar,
    is_owner: u.is_owner ?? false,
    metadata: u.metadata,
    updated_at: new Date().toISOString(),
  }));
  const allowed = await sc.get("slp_league_users");
  const { rows, dropped } = filterRows(rawRows, allowed);
  if (dropped.length) {
    console.warn(`[flatUsers] Dropping non-schema keys: ${dropped.join(", ")}`);
  }
  const { error } = await db
    .from("slp_league_users")
    .upsert(rows, { onConflict: "league_id,user_id" });
  if (error) throw new Error(`slp_league_users upsert: ${error.message}`);
}

async function flatRosters(
  db: SupabaseClient,
  leagueId: string,
  rosters: Awaited<ReturnType<typeof fetchLeagueRosters>>,
  sc: SchemaCache,
): Promise<void> {
  if (!rosters?.length) return;

  const rawRosterRows = rosters.map((r) => ({
    league_id: leagueId,
    roster_id: r.roster_id,
    owner_id: r.owner_id,
    co_owners: r.co_owners,
    players: r.players,
    starters: r.starters,
    reserve: r.reserve,
    taxi: r.taxi,
    draft_picks: r.draft_picks,
    settings: r.settings,
    metadata: r.metadata,
    updated_at: new Date().toISOString(),
  }));

  const rosterAllowed = await sc.get("slp_league_rosters");
  const { rows: rosterRows, dropped: rDropped } = filterRows(rawRosterRows, rosterAllowed);
  if (rDropped.length) {
    console.warn(`[flatRosters] slp_league_rosters dropping: ${rDropped.join(", ")}`);
  }

  const { error: rError } = await db
    .from("slp_league_rosters")
    .upsert(rosterRows, { onConflict: "league_id,roster_id" });
  if (rError) throw new Error(`slp_league_rosters upsert: ${rError.message}`);

  // Batch-delete all existing player rows for this league, then re-insert
  const rosterIds = rosters.map((r) => r.roster_id);
  await db
    .from("slp_league_roster_players")
    .delete()
    .eq("league_id", leagueId)
    .in("roster_id", rosterIds);

  const allPlayerRows: Record<string, unknown>[] = [];
  const now = new Date().toISOString();

  for (const roster of rosters) {
    const starterSet = new Set(roster.starters?.filter(Boolean) ?? []);
    const irSet = new Set(roster.reserve?.filter(Boolean) ?? []);
    const taxiSet = new Set(roster.taxi?.filter(Boolean) ?? []);

    for (const pid of (roster.players ?? []).filter(Boolean)) {
      let slot = "bench";
      if (starterSet.has(pid)) slot = "starter";
      else if (irSet.has(pid)) slot = "ir";
      else if (taxiSet.has(pid)) slot = "taxi";
      allPlayerRows.push({
        league_id: leagueId,
        roster_id: roster.roster_id,
        sleeper_player_id: pid,
        slot_type: slot,
        updated_at: now,
      });
    }
  }

  if (allPlayerRows.length) {
    const playerAllowed = await sc.get("slp_league_roster_players");
    const { rows: playerRows, dropped: pDropped } = filterRows(allPlayerRows, playerAllowed);
    if (pDropped.length) {
      console.warn(`[flatRosters] slp_league_roster_players dropping: ${pDropped.join(", ")}`);
    }
    const { error } = await db.from("slp_league_roster_players").insert(playerRows);
    if (error) throw new Error(`slp_league_roster_players insert: ${error.message}`);
  }
}

async function flatMatchups(
  db: SupabaseClient,
  leagueId: string,
  week: number,
  matchups: Awaited<ReturnType<typeof fetchLeagueMatchups>>,
  sc: SchemaCache,
): Promise<void> {
  if (!matchups?.length) return;

  const effective = matchups.map((m) => ({
    ...m,
    matchup_id: m.matchup_id ?? syntheticMatchupId(week, m.roster_id),
  }));

  const rawTeamRows = effective.map((m) => ({
    league_id: leagueId,
    week,
    roster_id: m.roster_id,
    matchup_id: m.matchup_id,
    points: m.points ?? null,
    custom_points: m.custom_points ?? null,
    starters: m.starters,
    players: m.players,
    starters_points: m.starters_points,
    players_points: m.players_points,
    updated_at: new Date().toISOString(),
  }));

  const teamAllowed = await sc.get("slp_league_matchup_team_rows");
  const { rows: teamRows, dropped: tDropped } = filterRows(rawTeamRows, teamAllowed);
  if (tDropped.length) {
    console.warn(`[flatMatchups] slp_league_matchup_team_rows dropping: ${tDropped.join(", ")}`);
  }

  const { error: tError } = await db
    .from("slp_league_matchup_team_rows")
    .upsert(teamRows, { onConflict: "league_id,week,roster_id" });
  if (tError) throw new Error(`slp_league_matchup_team_rows upsert week ${week}: ${tError.message}`);

  // Batch-delete all lineup player rows for this week, then re-insert
  await db
    .from("slp_league_matchup_lineup_players")
    .delete()
    .eq("league_id", leagueId)
    .eq("week", week);

  const allLineupRows: Record<string, unknown>[] = [];
  const now = new Date().toISOString();

  for (const m of effective) {
    const starterSet = new Set(m.starters?.filter(Boolean) ?? []);
    const pointsMap: Record<string, number> = (m.players_points as Record<string, number>) ?? {};

    for (const pid of (m.players ?? []).filter(Boolean)) {
      allLineupRows.push({
        league_id: leagueId,
        week,
        roster_id: m.roster_id,
        sleeper_player_id: pid,
        slot_type: starterSet.has(pid) ? "starter" : "bench",
        points: pointsMap[pid] ?? null,
        updated_at: now,
      });
    }
  }

  if (allLineupRows.length) {
    const lineupAllowed = await sc.get("slp_league_matchup_lineup_players");
    const { rows: lineupRows, dropped: lDropped } = filterRows(allLineupRows, lineupAllowed);
    if (lDropped.length) {
      console.warn(`[flatMatchups] slp_league_matchup_lineup_players dropping: ${lDropped.join(", ")}`);
    }
    const { error } = await db
      .from("slp_league_matchup_lineup_players")
      .insert(lineupRows);
    if (error) {
      throw new Error(`slp_league_matchup_lineup_players insert week ${week}: ${error.message}`);
    }
  }
}

async function flatBrackets(
  db: SupabaseClient,
  leagueId: string,
  winners: SleeperBracketGame[],
  losers: SleeperBracketGame[],
  sc: SchemaCache,
): Promise<void> {
  const allowed = await sc.get("slp_league_bracket_games");

  const upsertGames = async (games: SleeperBracketGame[], bracketType: string) => {
    if (!games?.length) return;
    const rawRows = games.map((g) => ({
      league_id: leagueId,
      bracket_type: bracketType,
      round: g.r,
      match_id: g.m,
      roster_id_1: g.t1,
      roster_id_2: g.t2,
      t1_from: g.t1_from,
      t2_from: g.t2_from,
      winner_roster_id: g.w,
      loser_roster_id: g.l,
      placement: g.p,
      updated_at: new Date().toISOString(),
    }));
    const { rows, dropped } = filterRows(rawRows, allowed);
    if (dropped.length) {
      console.warn(`[flatBrackets] slp_league_bracket_games (${bracketType}) dropping: ${dropped.join(", ")}`);
    }
    const { error } = await db
      .from("slp_league_bracket_games")
      .upsert(rows, { onConflict: "league_id,bracket_type,round,match_id" });
    if (error) {
      throw new Error(`slp_league_bracket_games (${bracketType}) upsert: ${error.message}`);
    }
  };

  await upsertGames(winners, "winners");
  await upsertGames(losers, "losers");
}

async function flatTransactions(
  db: SupabaseClient,
  leagueId: string,
  week: number,
  txns: Awaited<ReturnType<typeof fetchLeagueTransactions>>,
  sc: SchemaCache,
): Promise<void> {
  if (!txns?.length) return;

  const rawTxnRows = txns.map((tx) => ({
    transaction_id: tx.transaction_id,
    league_id: leagueId,
    week,
    transaction_type: tx.type,
    status: tx.status,
    status_updated_at: fromUnixMs(tx.status_updated_at),
    leg: tx.leg,
    roster_ids: tx.roster_ids,
    consenter_ids: tx.consenter_ids,
    drops: tx.drops,
    adds: tx.adds,
    draft_picks: tx.draft_picks,
    waiver_budget: tx.waiver_budget,
    settings: tx.settings,
    metadata: tx.metadata,
    sleeper_created_at: fromUnixMs(tx.created),
    updated_at: new Date().toISOString(),
  }));

  const txnAllowed = await sc.get("slp_league_transactions");
  const { rows: txnRows, dropped: txDropped } = filterRows(rawTxnRows, txnAllowed);
  if (txDropped.length) {
    console.warn(`[flatTransactions] slp_league_transactions dropping: ${txDropped.join(", ")}`);
  }

  const { error: txError } = await db
    .from("slp_league_transactions")
    .upsert(txnRows, { onConflict: "transaction_id" });
  if (txError) throw new Error(`slp_league_transactions upsert week ${week}: ${txError.message}`);

  // Transaction assets: batch-delete all for this week's txn IDs, then re-insert
  const txnIds = txns.map((tx) => tx.transaction_id);
  await db
    .from("slp_league_transaction_assets")
    .delete()
    .in("transaction_id", txnIds);

  const allAssets: Record<string, unknown>[] = [];

  for (const tx of txns) {
    for (const [playerId, rId] of Object.entries(tx.adds ?? {})) {
      allAssets.push({
        transaction_id: tx.transaction_id,
        league_id: leagueId,
        asset_type: "player",
        sleeper_player_id: playerId,
        to_roster_id: rId as number,
        direction: "add",
      });
    }

    for (const [playerId, rId] of Object.entries(tx.drops ?? {})) {
      allAssets.push({
        transaction_id: tx.transaction_id,
        league_id: leagueId,
        asset_type: "player",
        sleeper_player_id: playerId,
        from_roster_id: rId as number,
        direction: "drop",
      });
    }

    for (const pick of tx.draft_picks ?? []) {
      allAssets.push({
        transaction_id: tx.transaction_id,
        league_id: leagueId,
        asset_type: "draft_pick",
        pick_season: pick.season,
        pick_round: pick.round,
        pick_roster_id: pick.roster_id,
        from_roster_id: pick.previous_owner_id,
        to_roster_id: pick.owner_id,
      });
    }
  }

  if (allAssets.length) {
    const assetAllowed = await sc.get("slp_league_transaction_assets");
    const { rows: assetRows, dropped: aDropped } = filterRows(allAssets, assetAllowed);
    if (aDropped.length) {
      console.warn(`[flatTransactions] slp_league_transaction_assets dropping: ${aDropped.join(", ")}`);
    }
    const { error } = await db.from("slp_league_transaction_assets").insert(assetRows);
    if (error) {
      throw new Error(`slp_league_transaction_assets insert week ${week}: ${error.message}`);
    }
  }
}

async function flatTradedPicks(
  db: SupabaseClient,
  leagueId: string,
  picks: Awaited<ReturnType<typeof fetchTradedPicks>>,
  sc: SchemaCache,
): Promise<void> {
  // Delete existing rows for this league before re-inserting so stale picks
  // that were un-traded are removed.
  await db.from("slp_league_traded_picks").delete().eq("league_id", leagueId);

  if (!picks?.length) return;

  const rawRows = picks.map((p) => ({
    league_id: leagueId,
    season: p.season,
    round: p.round,
    roster_id: p.roster_id,
    previous_owner_id: p.previous_owner_id,
    original_owner_id: p.original_owner_id,
    updated_at: new Date().toISOString(),
  }));

  const allowed = await sc.get("slp_league_traded_picks");
  const { rows, dropped } = filterRows(rawRows, allowed);
  if (dropped.length) {
    console.warn(`[flatTradedPicks] Dropping non-schema keys: ${dropped.join(", ")}`);
  }

  const { error } = await db
    .from("slp_league_traded_picks")
    .upsert(rows, { onConflict: "league_id,season,round,roster_id" });
  if (error) throw new Error(`slp_league_traded_picks upsert: ${error.message}`);
}

async function flatDrafts(
  db: SupabaseClient,
  leagueId: string,
  drafts: Awaited<ReturnType<typeof fetchLeagueDrafts>>,
  sc: SchemaCache,
): Promise<void> {
  if (!drafts?.length) return;

  // slp_league_drafts: association table
  const rawLinkRows = drafts.map((d) => ({
    league_id: leagueId,
    draft_id: d.draft_id,
    updated_at: new Date().toISOString(),
  }));
  const linkAllowed = await sc.get("slp_league_drafts");
  const { rows: linkRows, dropped: lDropped } = filterRows(rawLinkRows, linkAllowed);
  if (lDropped.length) {
    console.warn(`[flatDrafts] slp_league_drafts dropping: ${lDropped.join(", ")}`);
  }
  const { error: linkError } = await db
    .from("slp_league_drafts")
    .upsert(linkRows, { onConflict: "league_id,draft_id" });
  if (linkError) throw new Error(`slp_league_drafts upsert: ${linkError.message}`);

  // slp_drafts: full draft detail
  const rawDraftRows = drafts.map((d) => ({
    draft_id: d.draft_id,
    league_id: d.league_id,
    season: d.season,
    type: d.type,
    status: d.status,
    start_time: d.start_time ? new Date(d.start_time).toISOString() : null,
    draft_order: d.draft_order,
    slot_to_roster_id: d.slot_to_roster_id,
    settings: d.settings,
    metadata: d.metadata,
    updated_at: new Date().toISOString(),
  }));
  const draftAllowed = await sc.get("slp_drafts");
  const { rows: draftRows, dropped: dDropped } = filterRows(rawDraftRows, draftAllowed);
  if (dDropped.length) {
    console.warn(`[flatDrafts] slp_drafts dropping: ${dDropped.join(", ")}`);
  }
  const { error: draftError } = await db
    .from("slp_drafts")
    .upsert(draftRows, { onConflict: "draft_id" });
  if (draftError) throw new Error(`slp_drafts upsert: ${draftError.message}`);
}

async function flatDraftPicks(
  db: SupabaseClient,
  draftId: string,
  picks: Awaited<ReturnType<typeof fetchDraftPicks>>,
  sc: SchemaCache,
): Promise<void> {
  if (!picks?.length) return;

  const rawRows = picks.map((p) => ({
    draft_id: draftId,
    pick_no: p.pick_no,
    round: p.round,
    draft_slot: p.draft_slot,
    roster_id: p.roster_id,
    sleeper_player_id: p.player_id,
    picked_by: p.picked_by,
    is_keeper: p.is_keeper ?? false,
    metadata: p.metadata,
    updated_at: new Date().toISOString(),
  }));

  const allowed = await sc.get("slp_draft_picks");
  const { rows, dropped } = filterRows(rawRows, allowed);
  if (dropped.length) {
    console.warn(`[flatDraftPicks] Dropping non-schema keys: ${dropped.join(", ")}`);
  }

  const { error } = await db
    .from("slp_draft_picks")
    .upsert(rows, { onConflict: "draft_id,pick_no" });
  if (error) throw new Error(`slp_draft_picks upsert: ${error.message}`);
}

async function flatDraftTradedPicks(
  db: SupabaseClient,
  draftId: string,
  picks: Awaited<ReturnType<typeof fetchDraftTradedPicks>>,
  sc: SchemaCache,
): Promise<void> {
  // Delete + re-insert so removed traded picks are cleared.
  await db.from("slp_draft_traded_picks").delete().eq("draft_id", draftId);

  if (!picks?.length) return;

  const rawRows = picks.map((p) => ({
    draft_id: draftId,
    season: p.season,
    round: p.round,
    roster_id: p.roster_id,
    previous_owner_id: p.previous_owner_id,
    original_owner_id: p.original_owner_id,
    updated_at: new Date().toISOString(),
  }));

  const allowed = await sc.get("slp_draft_traded_picks");
  const { rows, dropped } = filterRows(rawRows, allowed);
  if (dropped.length) {
    console.warn(`[flatDraftTradedPicks] Dropping non-schema keys: ${dropped.join(", ")}`);
  }

  const { error } = await db
    .from("slp_draft_traded_picks")
    .upsert(rows, { onConflict: "draft_id,season,round,roster_id" });
  if (error) throw new Error(`slp_draft_traded_picks upsert: ${error.message}`);
}

// ─── Per-season orchestration ─────────────────────────────────────────────────

/**
 * Ingest a single Sleeper league season into Layer 1 and Layer 2.
 *
 * Returns a summary object describing what was processed.
 *
 * @param sc  Optional shared SchemaCache. If omitted a new one is created.
 *            Pass a shared instance from `ingestLeagueChain` to reuse
 *            already-fetched column lists across multiple seasons.
 */
export async function ingestLeagueSeason(
  db: SupabaseClient,
  leagueId: string,
  sc?: SchemaCache,
): Promise<{
  league_id: string;
  season: string | null;
  steps: string[];
  error?: string;
}> {
  const cache = sc ?? new SchemaCache(db);
  const steps: string[] = [];

  // ── Layer 1 + 2: league metadata ──────────────────────────────────────────
  const league = await fetchLeague(leagueId);
  await rawUpsertLeague(db, league);
  steps.push("raw_league");
  await flatLeague(db, league, cache);
  steps.push("slp_leagues");

  // ── Layer 1 + 2: users ────────────────────────────────────────────────────
  const users = await rawUpsertUsers(db, leagueId);
  steps.push("raw_users");
  await flatUsers(db, leagueId, users, cache);
  steps.push("slp_league_users");

  // ── Layer 1 + 2: rosters ──────────────────────────────────────────────────
  const rosters = await rawUpsertRosters(db, leagueId);
  steps.push("raw_rosters");
  await flatRosters(db, leagueId, rosters, cache);
  steps.push("slp_league_rosters");

  // ── Layer 1 + 2: matchups (all weeks) ─────────────────────────────────────
  for (let week = 1; week <= MAX_SEASON_WEEKS; week++) {
    const matchups = await rawUpsertMatchups(db, leagueId, week);
    if (matchups?.length) {
      await flatMatchups(db, leagueId, week, matchups, cache);
    }
  }
  steps.push("raw_matchups");
  steps.push("slp_league_matchup_team_rows");
  steps.push("slp_league_matchup_lineup_players");

  // ── Layer 1 + 2: playoff brackets ─────────────────────────────────────────
  const { winners, losers } = await rawUpsertBrackets(db, leagueId);
  steps.push("raw_brackets");
  await flatBrackets(db, leagueId, winners, losers, cache);
  steps.push("slp_league_bracket_games");

  // ── Layer 1 + 2: transactions (all weeks) ─────────────────────────────────
  for (let week = 1; week <= MAX_SEASON_WEEKS; week++) {
    const txns = await rawUpsertTransactions(db, leagueId, week);
    if (txns?.length) {
      await flatTransactions(db, leagueId, week, txns, cache);
    }
  }
  steps.push("raw_transactions");
  steps.push("slp_league_transactions");
  steps.push("slp_league_transaction_assets");

  // ── Layer 1 + 2: traded picks ─────────────────────────────────────────────
  const tradedPicks = await rawUpsertTradedPicks(db, leagueId);
  steps.push("raw_traded_picks");
  await flatTradedPicks(db, leagueId, tradedPicks, cache);
  steps.push("slp_league_traded_picks");

  // ── Layer 1 + 2: drafts ───────────────────────────────────────────────────
  const drafts = await rawUpsertDrafts(db, leagueId);
  steps.push("raw_drafts");
  await flatDrafts(db, leagueId, drafts, cache);
  steps.push("slp_league_drafts");
  steps.push("slp_drafts");

  // Per-draft: detail, picks, and traded picks
  for (const draft of drafts ?? []) {
    await rawUpsertDraft(db, draft.draft_id);
    steps.push(`raw_draft:${draft.draft_id}`);

    if (draft.status !== "pre_draft") {
      const draftPicks = await rawUpsertDraftPicks(db, draft.draft_id);
      steps.push(`raw_draft_picks:${draft.draft_id}`);
      await flatDraftPicks(db, draft.draft_id, draftPicks, cache);
      steps.push(`slp_draft_picks:${draft.draft_id}`);
    }

    const draftTradedPicks = await rawUpsertDraftTradedPicks(db, draft.draft_id);
    steps.push(`raw_draft_traded_picks:${draft.draft_id}`);
    await flatDraftTradedPicks(db, draft.draft_id, draftTradedPicks, cache);
    steps.push(`slp_draft_traded_picks:${draft.draft_id}`);
  }

  return { league_id: leagueId, season: league.season ?? null, steps };
}

/**
 * Walk the `previous_league_id` chain and ingest every season.
 *
 * Returns a per-league summary array ordered from newest to oldest.
 * A single SchemaCache is shared across all seasons so column lists are only
 * fetched once per table regardless of how many seasons are processed.
 */
export async function ingestLeagueChain(
  db: SupabaseClient,
  startingLeagueId: string,
): Promise<
  Array<{
    league_id: string;
    season: string | null;
    steps: string[];
    error?: string;
  }>
> {
  const chain = await fetchLeagueChain(startingLeagueId);
  // Shared across all seasons — column lists are fetched once per table.
  const sc = new SchemaCache(db);
  const results = [];

  for (const league of chain) {
    try {
      const result = await ingestLeagueSeason(db, league.league_id, sc);
      results.push(result);
    } catch (err) {
      results.push({
        league_id: league.league_id,
        season: league.season ?? null,
        steps: [],
        error: err instanceof Error ? err.message : String(err),
      });
    }
  }

  return results;
}

/**
 * Ingest all NFL players from the Sleeper players endpoint.
 *
 * Stores the raw dictionary in slp_raw_players_nfl, then upserts individual
 * rows into slp_players and records a snapshot entry in slp_players_snapshot.
 */
export async function ingestNflPlayers(db: SupabaseClient): Promise<{
  player_count: number;
  steps: string[];
}> {
  const steps: string[] = [];
  const sc = new SchemaCache(db);

  const playersDict = await fetchNflPlayers();
  const playerCount = Object.keys(playersDict ?? {}).length;

  // Layer 1: raw snapshot
  const { error: rawError } = await db.from("slp_raw_players_nfl").insert({
    raw_json: playersDict as unknown as Record<string, unknown>,
    fetched_at: new Date().toISOString(),
  });
  if (rawError) throw new Error(`slp_raw_players_nfl insert: ${rawError.message}`);
  steps.push("raw_players_nfl");

  // Layer 2: upsert individual player rows (batch in chunks to avoid payload limits)
  const entries = Object.entries(playersDict ?? {});
  const now = new Date().toISOString();
  const playerAllowed = await sc.get("slp_players");

  for (let i = 0; i < entries.length; i += UPSERT_CHUNK_SIZE) {
    const chunk = entries.slice(i, i + UPSERT_CHUNK_SIZE);
    const rawRows = chunk.map(([playerId, p]) => ({
      sleeper_player_id: playerId,
      full_name: p.full_name ?? null,
      first_name: p.first_name ?? null,
      last_name: p.last_name ?? null,
      position: p.position ?? null,
      team: p.team ?? null,
      status: p.status ?? null,
      sport: p.sport ?? "nfl",
      age: p.age ?? null,
      number: p.number ?? null,
      depth_chart_position: p.depth_chart_position ?? null,
      depth_chart_order: p.depth_chart_order ?? null,
      years_exp: p.years_exp ?? null,
      college: p.college ?? null,
      injury_status: p.injury_status ?? null,
      fantasy_positions: p.fantasy_positions ?? null,
      metadata: p.metadata ?? null,
      raw_json: p as unknown as Record<string, unknown>,
      updated_at: now,
    }));
    const { rows, dropped } = filterRows(rawRows, playerAllowed);
    if (dropped.length && i === 0) {
      console.warn(`[ingestNflPlayers] slp_players dropping: ${dropped.join(", ")}`);
    }
    const { error } = await db
      .from("slp_players")
      .upsert(rows, { onConflict: "sleeper_player_id" });
    if (error) throw new Error(`slp_players upsert chunk ${i}: ${error.message}`);
  }
  steps.push("slp_players");

  // Record snapshot metadata
  const { error: snapError } = await db.from("slp_players_snapshot").insert({
    player_count: playerCount,
    fetched_at: now,
  });
  if (snapError) throw new Error(`slp_players_snapshot insert: ${snapError.message}`);
  steps.push("slp_players_snapshot");

  return { player_count: playerCount, steps };
}

// ─── Debug / dry-run helper ───────────────────────────────────────────────────

/**
 * Fetch the league chain and compute what the `slp_leagues` upsert payload
 * would look like — without writing anything to Supabase.
 *
 * Used by the admin route when `?debug=1` is present.
 */
export async function debugLeaguePayload(
  db: SupabaseClient,
  startingLeagueId: string,
): Promise<{
  league_chain: { league_id: string; season: string | null }[];
  slp_leagues: {
    raw_keys: string[];
    filtered_keys: string[];
    dropped_keys: string[];
    deployed_columns: string[];
    raw_json_present: boolean;
    raw_json_null: boolean;
    raw_json_type: string;
  };
}> {
  const chain = await fetchLeagueChain(startingLeagueId);
  const league = await fetchLeague(startingLeagueId);

  const rawPayload: Record<string, unknown> = {
    league_id: league.league_id,
    season: league.season,
    name: league.name,
    status: league.status,
    sport: league.sport,
    season_type: league.season_type,
    total_rosters: league.total_rosters,
    previous_league_id: league.previous_league_id,
    draft_id: league.draft_id,
    settings: league.settings,
    scoring_settings: league.scoring_settings,
    roster_positions: league.roster_positions,
    metadata: league.metadata,
    raw_json: league as unknown as Record<string, unknown>,
    updated_at: new Date().toISOString(),
  };

  const sc = new SchemaCache(db);
  const allowed = await sc.get("slp_leagues");
  const rawKeys = Object.keys(rawPayload);
  const { row: filtered, dropped } = filterRow(rawPayload, allowed);

  const rawJsonValue = filtered.raw_json;

  return {
    league_chain: chain.map((l) => ({
      league_id: l.league_id,
      season: l.season ?? null,
    })),
    slp_leagues: {
      raw_keys: rawKeys,
      filtered_keys: Object.keys(filtered),
      dropped_keys: dropped,
      deployed_columns: [...allowed].sort(),
      raw_json_present: "raw_json" in filtered,
      raw_json_null: rawJsonValue == null,
      raw_json_type: rawJsonValue == null ? "null" : typeof rawJsonValue,
    },
  };
}
