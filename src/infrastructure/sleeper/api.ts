/**
 * Sleeper API helpers
 *
 * Typed fetch functions for every Sleeper endpoint used by the league-history
 * warehouse.  All calls are made server-side; no browser credentials required.
 */

const BASE_URL = "https://api.sleeper.app/v1";

async function sleeperFetch<T>(path: string): Promise<T> {
  console.log(`[sleeperFetch] GET ${BASE_URL}${path}`);
  const res = await fetch(`${BASE_URL}${path}`, { cache: "no-store" });
  if (!res.ok) {
    throw new Error(`Sleeper API error ${res.status} for ${path}`);
  }
  return res.json() as Promise<T>;
}

/** A single recorded Sleeper API call, used for debug=2 tracing. */
export interface DebugCall {
  fn: string;
  league_id: string;
  endpoint: string;
}

// ─── Shared Sleeper types ─────────────────────────────────────────────────────

export interface SleeperLeague {
  league_id: string;
  name: string;
  status: string;
  sport: string;
  season_type: string;
  season: string;
  total_rosters: number;
  settings: Record<string, number | string | boolean | null>;
  scoring_settings: Record<string, number>;
  roster_positions: string[];
  previous_league_id: string | null;
  draft_id: string | null;
  metadata: Record<string, unknown> | null;
}

export interface SleeperUser {
  user_id: string;
  display_name: string;
  avatar: string | null;
  metadata: { team_name?: string; [key: string]: unknown } | null;
  is_owner: boolean;
  league_id?: string;
}

export interface SleeperRosterSettings {
  wins: number;
  losses: number;
  ties: number;
  fpts: number;
  fpts_decimal: number;
  fpts_against: number;
  fpts_against_decimal: number;
  ppts: number;
  ppts_decimal: number;
  streak?: string;
  record?: string;
  [key: string]: unknown;
}

export interface SleeperRoster {
  roster_id: number;
  owner_id: string | null;
  co_owners: string[] | null;
  league_id: string;
  players: string[] | null;
  starters: string[] | null;
  reserve: string[] | null;
  taxi: string[] | null;
  draft_picks: SleeperRosterDraftPick[];
  settings: SleeperRosterSettings;
  metadata: Record<string, unknown> | null;
}

export interface SleeperRosterDraftPick {
  season: string;
  round: number;
  roster_id: number;
  original_roster_id: number;
  pick_no?: number;
}

export interface SleeperMatchup {
  matchup_id: number | null;  // null for bye weeks in playoff rounds
  roster_id: number;
  points: number;
  custom_points: number | null;
  starters: string[];
  players: string[] | null;
  starters_points: number[] | null;
  players_points: Record<string, number> | null;
}

export interface SleeperBracketGame {
  r: number;
  m: number;
  t1: number | null;
  t2: number | null;
  t1_from: { w?: number; l?: number } | null;
  t2_from: { w?: number; l?: number } | null;
  w: number | null;
  l: number | null;
  p: number | null;
}

export interface SleeperTransactionPick {
  season: string;
  round: number;
  roster_id: number;
  previous_owner_id: number;
  owner_id: number;
}

export interface SleeperTransaction {
  transaction_id: string;
  type: string;
  status: string;
  leg: number;
  roster_ids: number[];
  consenter_ids: number[] | null;
  drops: Record<string, number> | null;
  adds: Record<string, number> | null;
  draft_picks: SleeperTransactionPick[] | null;
  waiver_budget: Array<{ sender: number; receiver: number; amount: number }> | null;
  metadata: Record<string, unknown> | null;
  settings: Record<string, unknown> | null;
  status_updated_at: number | null;
  created: number | null;
}

export interface SleeperTradedPick {
  season: string;
  round: number;
  roster_id: number;
  previous_owner_id: number | null;  // null when the pick has never changed hands
  original_owner_id: number | null;  // null when Sleeper omits the field
}

export interface SleeperDraft {
  draft_id: string;
  league_id: string;
  season: string;
  type: string;
  status: string;
  start_time: number | null;
  draft_order: Record<string, number> | null;
  slot_to_roster_id: Record<string, number> | null;
  settings: { rounds: number; teams: number; [key: string]: unknown };
  metadata: Record<string, unknown> | null;
}

export interface SleeperDraftPick {
  draft_id: string;
  pick_no: number;
  round: number;
  roster_id: number;
  player_id: string;
  picked_by: string;
  is_keeper: boolean | null;
  metadata: Record<string, unknown> | null;
  draft_slot: number;
  season: string;
}

// ─── Fetch helpers ────────────────────────────────────────────────────────────

export const fetchLeague = (leagueId: string) =>
  sleeperFetch<SleeperLeague>(`/league/${leagueId}`);

export const fetchLeagueUsers = (leagueId: string) =>
  sleeperFetch<SleeperUser[]>(`/league/${leagueId}/users`);

export const fetchLeagueRosters = (leagueId: string) =>
  sleeperFetch<SleeperRoster[]>(`/league/${leagueId}/rosters`);

export const fetchLeagueMatchups = (leagueId: string, week: number) =>
  sleeperFetch<SleeperMatchup[]>(`/league/${leagueId}/matchups/${week}`);

export const fetchWinnersBracket = (leagueId: string) =>
  sleeperFetch<SleeperBracketGame[]>(`/league/${leagueId}/winners_bracket`);

export const fetchLosersBracket = (leagueId: string) =>
  sleeperFetch<SleeperBracketGame[]>(`/league/${leagueId}/losers_bracket`);

export const fetchLeagueTransactions = (leagueId: string, week: number) =>
  sleeperFetch<SleeperTransaction[]>(`/league/${leagueId}/transactions/${week}`);

export const fetchTradedPicks = (leagueId: string) =>
  sleeperFetch<SleeperTradedPick[]>(`/league/${leagueId}/traded_picks`);

export const fetchLeagueDrafts = (leagueId: string) =>
  sleeperFetch<SleeperDraft[]>(`/league/${leagueId}/drafts`);

export const fetchDraft = (draftId: string) =>
  sleeperFetch<SleeperDraft>(`/draft/${draftId}`);

export const fetchDraftPicks = (draftId: string) =>
  sleeperFetch<SleeperDraftPick[]>(`/draft/${draftId}/picks`);

/**
 * Walk the `previous_league_id` chain starting from `currentLeagueId`.
 * Returns leagues ordered from newest to oldest.
 *
 * Sleeper returns `"0"` (the string) on the oldest season to indicate there is
 * no previous league. We must treat it as null; otherwise the truthy string
 * `"0"` would cause an infinite loop that calls `/league/0`.
 *
 * @param currentLeagueId - Starting league ID (string, never numeric).
 * @param debugLog - Optional array to collect call-trace entries (debug=2).
 */
export async function fetchLeagueChain(
  currentLeagueId: string,
  debugLog?: DebugCall[],
): Promise<SleeperLeague[]> {
  const chain: SleeperLeague[] = [];
  let leagueId: string | null = currentLeagueId;

  while (leagueId) {
    const endpoint = `/league/${leagueId}`;
    console.log(`[fetchLeagueChain] fetchLeague league_id="${leagueId}" endpoint="${endpoint}"`);
    debugLog?.push({ fn: "fetchLeagueChain→fetchLeague", league_id: leagueId, endpoint });
    const league = await fetchLeague(leagueId);
    chain.push(league);
    // Sleeper uses "0" (string) to mean "no previous league". Guard against it
    // explicitly so the while-condition (which tests truthiness) does not loop
    // into a /league/0 request.
    const prev = league.previous_league_id;
    leagueId = prev && prev !== "0" ? prev : null;
  }

  return chain;
}
