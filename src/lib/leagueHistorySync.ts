/**
 * League-history sync engine
 *
 * All functions are idempotent — safe to call multiple times.
 * Uses UPSERT (onConflict) everywhere so re-running never creates duplicates.
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
  fetchDraftPicks,
  type SleeperLeague,
  type SleeperBracketGame,
} from "./sleeperApi";

// ─── Helpers ─────────────────────────────────────────────────────────────────

/** Maximum number of weeks to attempt when fetching matchups and transactions. */
const MAX_SEASON_WEEKS = 18;

/** Convert Sleeper unix-ms timestamp to ISO string, or null. */
function fromUnixMs(ms: number | null | undefined): string | null {
  if (!ms) return null;
  return new Date(ms).toISOString();
}

/** Determine matchup type (regular / playoff / consolation) for a given week. */
function matchupType(week: number, playoffWeekStart: number): string {
  if (week < playoffWeekStart) return "regular";
  return "playoff";
}

// ─── Per-entity sync functions ────────────────────────────────────────────────

async function syncLeagueMetadata(
  db: SupabaseClient,
  league: SleeperLeague,
): Promise<void> {
  const settings = league.settings as Record<string, number | string | boolean | null>;
  const row = {
    league_id: league.league_id,
    season: league.season,
    name: league.name,
    status: league.status,
    sport: league.sport,
    season_type: league.season_type,
    total_rosters: league.total_rosters,
    playoff_week_start: (settings?.playoff_week_start as number) ?? null,
    last_scored_leg: (settings?.last_scored_leg as number) ?? null,
    settings: league.settings,
    scoring_settings: league.scoring_settings,
    roster_positions: league.roster_positions,
    previous_league_id: league.previous_league_id,
    draft_id: league.draft_id,
    metadata: league.metadata,
    raw_json: league as unknown as Record<string, unknown>,
    updated_at: new Date().toISOString(),
  };

  const { error } = await db
    .from("league_seasons")
    .upsert(row, { onConflict: "league_id" });

  if (error) throw new Error(`league_seasons upsert: ${error.message}`);
}

async function syncUsers(
  db: SupabaseClient,
  league: SleeperLeague,
): Promise<void> {
  const users = await fetchLeagueUsers(league.league_id);
  if (!users?.length) return;

  const rows = users.map((u) => ({
    league_id: league.league_id,
    season: league.season,
    user_id: u.user_id,
    display_name: u.display_name,
    team_name: u.metadata?.team_name ?? null,
    avatar: u.avatar,
    is_owner: u.is_owner ?? false,
    metadata: u.metadata,
    raw_json: u as unknown as Record<string, unknown>,
    updated_at: new Date().toISOString(),
  }));

  const { error } = await db
    .from("league_users")
    .upsert(rows, { onConflict: "league_id,user_id" });

  if (error) throw new Error(`league_users upsert: ${error.message}`);
}

async function syncTeams(
  db: SupabaseClient,
  league: SleeperLeague,
): Promise<void> {
  const [rosters, users] = await Promise.all([
    fetchLeagueRosters(league.league_id),
    fetchLeagueUsers(league.league_id),
  ]);

  if (!rosters?.length) return;

  const userMap: Record<string, string> = {};
  for (const u of users ?? []) {
    userMap[u.user_id] = u.metadata?.team_name ?? u.display_name ?? u.user_id;
  }

  const rows = rosters.map((r) => ({
    league_id: league.league_id,
    season: league.season,
    roster_id: r.roster_id,
    owner_id: r.owner_id,
    co_owners: r.co_owners,
    team_name: r.owner_id ? (userMap[r.owner_id] ?? null) : null,
    settings: r.settings,
    metadata: r.metadata,
    raw_json: r as unknown as Record<string, unknown>,
    updated_at: new Date().toISOString(),
  }));

  const { error } = await db
    .from("league_teams")
    .upsert(rows, { onConflict: "league_id,roster_id" });

  if (error) throw new Error(`league_teams upsert: ${error.message}`);
}

async function syncRosterSnapshots(
  db: SupabaseClient,
  league: SleeperLeague,
): Promise<void> {
  const rosters = await fetchLeagueRosters(league.league_id);
  if (!rosters?.length) return;

  for (const roster of rosters) {
    const snapshotRow = {
      league_id: league.league_id,
      season: league.season,
      roster_id: roster.roster_id,
      week: 0,
      snap_type: "season_end",
      snapped_at: new Date().toISOString(),
      raw_json: roster as unknown as Record<string, unknown>,
      updated_at: new Date().toISOString(),
    };

    const { error: upsertError } = await db
      .from("league_roster_snapshots")
      .upsert(snapshotRow, {
        onConflict: "league_id,season,roster_id,week,snap_type",
      });

    if (upsertError) {
      throw new Error(`league_roster_snapshots upsert: ${upsertError.message}`);
    }

    const { data: snapRow, error: findError } = await db
      .from("league_roster_snapshots")
      .select("id")
      .eq("league_id", league.league_id)
      .eq("season", league.season)
      .eq("roster_id", roster.roster_id)
      .eq("week", 0)
      .eq("snap_type", "season_end")
      .single();

    if (findError || !snapRow) continue;

    const snapshotId = snapRow.id as string;

    // Delete and re-insert players so the snapshot is always fresh.
    await db
      .from("league_roster_players")
      .delete()
      .eq("snapshot_id", snapshotId);

    const playerRows: {
      snapshot_id: string;
      player_id: string;
      slot_type: string;
    }[] = [];

    const starterSet = new Set(roster.starters?.filter(Boolean) ?? []);
    const irSet = new Set(roster.reserve?.filter(Boolean) ?? []);
    const taxiSet = new Set(roster.taxi?.filter(Boolean) ?? []);

    for (const pid of roster.players ?? []) {
      if (!pid) continue;
      let slot = "bench";
      if (starterSet.has(pid)) slot = "starter";
      else if (irSet.has(pid)) slot = "ir";
      else if (taxiSet.has(pid)) slot = "taxi";
      playerRows.push({ snapshot_id: snapshotId, player_id: pid, slot_type: slot });
    }

    if (playerRows.length) {
      const { error: insertError } = await db
        .from("league_roster_players")
        .insert(playerRows);
      if (insertError) {
        throw new Error(`league_roster_players insert: ${insertError.message}`);
      }
    }
  }
}

async function syncDrafts(
  db: SupabaseClient,
  league: SleeperLeague,
): Promise<void> {
  const drafts = await fetchLeagueDrafts(league.league_id);
  if (!drafts?.length) return;

  for (const draft of drafts) {
    const draftRow = {
      draft_id: draft.draft_id,
      league_id: league.league_id,
      season: league.season,
      draft_type: draft.type,
      status: draft.status,
      start_time: draft.start_time ? new Date(draft.start_time).toISOString() : null,
      draft_order: draft.draft_order,
      slot_to_roster_id: draft.slot_to_roster_id,
      settings: draft.settings,
      metadata: draft.metadata,
      raw_json: draft as unknown as Record<string, unknown>,
      updated_at: new Date().toISOString(),
    };

    const { error: draftError } = await db
      .from("league_drafts")
      .upsert(draftRow, { onConflict: "draft_id" });

    if (draftError) throw new Error(`league_drafts upsert: ${draftError.message}`);

    // Only sync picks for completed / in-progress drafts.
    if (draft.status === "pre_draft") continue;

    const picks = await fetchDraftPicks(draft.draft_id);
    if (!picks?.length) continue;

    const pickRows = picks.map((p) => ({
      draft_id: draft.draft_id,
      league_id: league.league_id,
      season: league.season,
      pick_no: p.pick_no,
      round: p.round,
      roster_id: p.roster_id,
      player_id: p.player_id,
      picked_by: p.picked_by,
      is_keeper: p.is_keeper ?? false,
      metadata: p.metadata,
      raw_json: p as unknown as Record<string, unknown>,
    }));

    const { error: pickError } = await db
      .from("league_draft_picks")
      .upsert(pickRows, { onConflict: "draft_id,pick_no" });

    if (pickError) throw new Error(`league_draft_picks upsert: ${pickError.message}`);
  }
}

async function syncMatchups(
  db: SupabaseClient,
  league: SleeperLeague,
): Promise<void> {
  const settings = league.settings as Record<string, number | string | boolean | null>;
  const playoffWeekStart = (settings?.playoff_week_start as number) ?? 15;

  for (let week = 1; week <= MAX_SEASON_WEEKS; week++) {
    const matchups = await fetchLeagueMatchups(league.league_id, week);
    if (!matchups?.length) continue;

    // Collect unique matchup_ids for this week.
    const matchupIds = [...new Set(matchups.map((m) => m.matchup_id))].filter(
      (id) => id !== null && id !== undefined,
    );

    const matchupRows = matchupIds.map((mid) => ({
      league_id: league.league_id,
      season: league.season,
      week,
      matchup_id: mid,
      matchup_type: matchupType(week, playoffWeekStart),
      updated_at: new Date().toISOString(),
    }));

    const { error: mError } = await db
      .from("league_matchups")
      .upsert(matchupRows, { onConflict: "league_id,season,week,matchup_id" });

    if (mError) throw new Error(`league_matchups upsert week ${week}: ${mError.message}`);

    const teamRows = matchups.map((m) => ({
      league_id: league.league_id,
      season: league.season,
      week,
      matchup_id: m.matchup_id,
      roster_id: m.roster_id,
      points: m.points ?? null,
      custom_points: m.custom_points ?? null,
      starters: m.starters,
      players: m.players,
      starters_points: m.starters_points,
      players_points: m.players_points,
      raw_json: m as unknown as Record<string, unknown>,
      updated_at: new Date().toISOString(),
    }));

    const { error: tError } = await db
      .from("league_matchup_teams")
      .upsert(teamRows, { onConflict: "league_id,season,week,roster_id" });

    if (tError) throw new Error(`league_matchup_teams upsert week ${week}: ${tError.message}`);
  }
}

async function syncTransactions(
  db: SupabaseClient,
  league: SleeperLeague,
): Promise<void> {

  for (let week = 1; week <= MAX_SEASON_WEEKS; week++) {
    const txns = await fetchLeagueTransactions(league.league_id, week);
    if (!txns?.length) continue;

    const txnRows = txns.map((tx) => ({
      transaction_id: tx.transaction_id,
      league_id: league.league_id,
      season: league.season,
      week,
      transaction_type: tx.type,
      status: tx.status,
      status_updated_at: fromUnixMs(tx.status_updated_at),
      leg: tx.leg,
      consenter_ids: tx.consenter_ids,
      roster_ids: tx.roster_ids,
      drops: tx.drops,
      adds: tx.adds,
      draft_picks: tx.draft_picks,
      waiver_budget: tx.waiver_budget,
      settings: tx.settings,
      metadata: tx.metadata,
      raw_json: tx as unknown as Record<string, unknown>,
      sleeper_created_at: fromUnixMs(tx.created),
      updated_at: new Date().toISOString(),
    }));

    const { error: txError } = await db
      .from("league_transactions")
      .upsert(txnRows, { onConflict: "transaction_id" });

    if (txError) throw new Error(`league_transactions upsert week ${week}: ${txError.message}`);

    // Sync transaction assets.
    for (const tx of txns) {
      const assets: {
        transaction_id: string;
        league_id: string;
        season: string;
        asset_type: string;
        player_id?: string;
        pick_season?: string;
        pick_round?: number;
        pick_roster_id?: number;
        from_roster_id?: number;
        to_roster_id?: number;
        direction?: string;
      }[] = [];

      // Player adds
      for (const [playerId, rId] of Object.entries(tx.adds ?? {})) {
        assets.push({
          transaction_id: tx.transaction_id,
          league_id: league.league_id,
          season: league.season,
          asset_type: "player",
          player_id: playerId,
          to_roster_id: rId as number,
          direction: "add",
        });
      }

      // Player drops
      for (const [playerId, rId] of Object.entries(tx.drops ?? {})) {
        assets.push({
          transaction_id: tx.transaction_id,
          league_id: league.league_id,
          season: league.season,
          asset_type: "player",
          player_id: playerId,
          from_roster_id: rId as number,
          direction: "drop",
        });
      }

      // Draft picks (trade)
      for (const pick of tx.draft_picks ?? []) {
        assets.push({
          transaction_id: tx.transaction_id,
          league_id: league.league_id,
          season: league.season,
          asset_type: "draft_pick",
          pick_season: pick.season,
          pick_round: pick.round,
          pick_roster_id: pick.roster_id,
          from_roster_id: pick.previous_owner_id,
          to_roster_id: pick.owner_id,
        });
      }

      if (!assets.length) continue;

      // Delete + re-insert for idempotency (assets have no natural unique key).
      await db
        .from("league_transaction_assets")
        .delete()
        .eq("transaction_id", tx.transaction_id);

      const { error: assetError } = await db
        .from("league_transaction_assets")
        .insert(assets);

      if (assetError) {
        throw new Error(
          `league_transaction_assets insert for ${tx.transaction_id}: ${assetError.message}`,
        );
      }
    }
  }
}

async function syncTradedPicks(
  db: SupabaseClient,
  league: SleeperLeague,
): Promise<void> {
  const picks = await fetchTradedPicks(league.league_id);
  if (!picks?.length) {
    // Delete stale traded-pick rows for this source season so re-runs stay clean.
    await db
      .from("league_traded_picks")
      .delete()
      .eq("league_id", league.league_id)
      .eq("source_season", league.season);
    return;
  }

  // Delete existing rows for this source season before re-inserting.
  await db
    .from("league_traded_picks")
    .delete()
    .eq("league_id", league.league_id)
    .eq("source_season", league.season);

  const rows = picks.map((p) => ({
    league_id: league.league_id,
    source_season: league.season,
    pick_season: p.season,
    round: p.round,
    owner_roster_id: p.roster_id,
    previous_owner_roster_id: p.previous_owner_id,
    original_owner_roster_id: p.original_owner_id,
    raw_json: p as unknown as Record<string, unknown>,
  }));

  const { error } = await db.from("league_traded_picks").insert(rows);
  if (error) throw new Error(`league_traded_picks insert: ${error.message}`);
}

async function syncPlayoffBrackets(
  db: SupabaseClient,
  league: SleeperLeague,
): Promise<void> {
  const [winners, losers] = await Promise.all([
    fetchWinnersBracket(league.league_id),
    fetchLosersBracket(league.league_id),
  ]);

  const upsertBracket = async (
    games: SleeperBracketGame[],
    bracketType: string,
  ) => {
    if (!games?.length) return;
    const rows = games.map((g) => ({
      league_id: league.league_id,
      season: league.season,
      bracket_type: bracketType,
      round: g.r,
      match_id: g.m,
      roster_id_1: g.t1,
      roster_id_2: g.t2,
      winner_roster_id: g.w,
      loser_roster_id: g.l,
      placement: g.p,
      raw_json: g as unknown as Record<string, unknown>,
      updated_at: new Date().toISOString(),
    }));

    const { error } = await db
      .from("league_playoff_bracket_games")
      .upsert(rows, {
        onConflict: "league_id,season,bracket_type,round,match_id",
      });

    if (error) {
      throw new Error(
        `league_playoff_bracket_games (${bracketType}) upsert: ${error.message}`,
      );
    }
  };

  await upsertBracket(winners, "winners");
  await upsertBracket(losers, "losers");
}

async function syncFinalStandings(
  db: SupabaseClient,
  league: SleeperLeague,
): Promise<void> {
  const rosters = await fetchLeagueRosters(league.league_id);
  if (!rosters?.length) return;

  // Sort by wins desc, then fpts desc for ranking.
  const sorted = [...rosters].sort((a, b) => {
    const wDiff = (b.settings?.wins ?? 0) - (a.settings?.wins ?? 0);
    if (wDiff !== 0) return wDiff;
    const fptsA = (a.settings?.fpts ?? 0) + (a.settings?.fpts_decimal ?? 0) / 100;
    const fptsB = (b.settings?.fpts ?? 0) + (b.settings?.fpts_decimal ?? 0) / 100;
    return fptsB - fptsA;
  });

  const rows = sorted.map((r, idx) => ({
    league_id: league.league_id,
    season: league.season,
    roster_id: r.roster_id,
    place: idx + 1,
    wins: r.settings?.wins ?? 0,
    losses: r.settings?.losses ?? 0,
    ties: r.settings?.ties ?? 0,
    fpts:
      (r.settings?.fpts ?? 0) + (r.settings?.fpts_decimal ?? 0) / 100,
    fpts_against:
      (r.settings?.fpts_against ?? 0) +
      (r.settings?.fpts_against_decimal ?? 0) / 100,
    ppts:
      (r.settings?.ppts ?? 0) + (r.settings?.ppts_decimal ?? 0) / 100,
    streak: r.settings?.streak ?? null,
    record: r.settings?.record ?? null,
    raw_json: r.settings as unknown as Record<string, unknown>,
    updated_at: new Date().toISOString(),
  }));

  const { error } = await db
    .from("league_final_standings")
    .upsert(rows, { onConflict: "league_id,season,roster_id" });

  if (error) throw new Error(`league_final_standings upsert: ${error.message}`);
}

async function syncChampion(
  db: SupabaseClient,
  league: SleeperLeague,
): Promise<void> {
  if (league.status !== "complete") return;

  const winners = await fetchWinnersBracket(league.league_id);
  if (!winners?.length) return;

  // Championship game = placement 1 in the winners bracket.
  const champGame = winners.find((g) => g.p === 1);
  if (!champGame || !champGame.w) return;

  // Fetch users to get team names.
  const [rosters, users] = await Promise.all([
    fetchLeagueRosters(league.league_id),
    fetchLeagueUsers(league.league_id),
  ]);

  const ownerMap: Record<number, string> = {};
  const teamNameMap: Record<number, string> = {};
  for (const r of rosters ?? []) {
    if (r.owner_id) {
      ownerMap[r.roster_id] = r.owner_id;
    }
  }
  for (const u of users ?? []) {
    const rid = rosters?.find((r) => r.owner_id === u.user_id)?.roster_id;
    if (rid !== undefined) {
      teamNameMap[rid] = u.metadata?.team_name ?? u.display_name ?? u.user_id;
    }
  }

  const winnerRosterId = champGame.w;
  const loserRosterId = champGame.l;

  const row = {
    league_id: league.league_id,
    season: league.season,
    winner_roster_id: winnerRosterId,
    winner_user_id: ownerMap[winnerRosterId] ?? null,
    winner_team_name: teamNameMap[winnerRosterId] ?? null,
    runner_up_roster_id: loserRosterId ?? null,
    runner_up_user_id: loserRosterId ? (ownerMap[loserRosterId] ?? null) : null,
    runner_up_team_name: loserRosterId ? (teamNameMap[loserRosterId] ?? null) : null,
    raw_json: champGame as unknown as Record<string, unknown>,
    updated_at: new Date().toISOString(),
  };

  const { error } = await db
    .from("league_champions")
    .upsert(row, { onConflict: "league_id,season" });

  if (error) throw new Error(`league_champions upsert: ${error.message}`);
}

// ─── Public API ───────────────────────────────────────────────────────────────

export interface SyncLeagueSummary {
  league_id: string;
  season: string;
  status: string;
  steps_completed: string[];
  error?: string;
}

/**
 * Sync all data for a single Sleeper league season into Supabase.
 * Each step is independent; if one fails the error is captured and returned.
 */
export async function syncLeagueSeason(
  db: SupabaseClient,
  leagueId: string,
): Promise<SyncLeagueSummary> {
  console.log(`[syncLeagueSeason] fetching league leagueId="${leagueId}"`);
  const league = await fetchLeague(leagueId);
  const completed: string[] = [];

  const step = async (name: string, fn: () => Promise<void>) => {
    await fn();
    completed.push(name);
  };

  try {
    await step("league_metadata", () => syncLeagueMetadata(db, league));
    await step("users", () => syncUsers(db, league));
    await step("teams", () => syncTeams(db, league));
    await step("roster_snapshots", () => syncRosterSnapshots(db, league));
    await step("drafts", () => syncDrafts(db, league));
    await step("matchups", () => syncMatchups(db, league));
    await step("transactions", () => syncTransactions(db, league));
    await step("traded_picks", () => syncTradedPicks(db, league));
    await step("playoff_brackets", () => syncPlayoffBrackets(db, league));
    await step("final_standings", () => syncFinalStandings(db, league));
    await step("champion", () => syncChampion(db, league));

    return {
      league_id: league.league_id,
      season: league.season,
      status: league.status,
      steps_completed: completed,
    };
  } catch (err) {
    return {
      league_id: league.league_id,
      season: league.season,
      status: league.status,
      steps_completed: completed,
      error: err instanceof Error ? err.message : String(err),
    };
  }
}
