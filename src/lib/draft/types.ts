import type { DraftPick } from "../picks";

export interface Team {
  id: number;
  name: string;
  ownerId?: string | null;
}

export interface League {
  roster_positions: string[];
  draft_order?: Record<string, number>;
  season?: string;
}

export interface Roster {
  roster_id: number;
  owner_id: string | null;
  starters?: (string | number | null)[];
  players?: (string | number | null)[];
  draft_picks?: DraftPick[];
}

export interface UserMetadata {
  team_name?: string;
}

export interface SleeperUser {
  user_id: string;
  display_name?: string;
  metadata?: UserMetadata;
}

export interface SleeperPlayer {
  player_id?: string;
  full_name?: string;
  first_name?: string;
  last_name?: string;
  position?: string;
  fantasy_positions?: string[];
  team?: string;
  status?: string;
  active?: boolean;
  years_exp?: number;
  birth_date?: string;
  age?: number;
  // Optional bio / draft fields populated by Sleeper's player dictionary.
  college?: string | null;
  height?: string | null;
  weight?: string | null;
  draft_round?: number | null;
  draft_pick?: number | null;
}

export interface DraftedPlayer {
  id: string;
  name: string;
  positions: string[];
  team?: string;
}

export interface AvailablePlayer {
  id: string;
  name: string;
  position: string;
  team: string;
  ageLabel: string;
  /** True when Sleeper marks the player with 0 years of experience. */
  isRookie: boolean;
  /** College name (rookies) or empty string. Used as the school/team column source. */
  school: string;
  /** Normalized 0-100 value derived from board sort rank. */
  valueScore: number;
  /** Personalized 0-100 fit derived from the logged-in owner's positional weakness. */
  fitScore: number;
  /** Raw trade value from cfc_trade_values_current (0 if missing). */
  tradeValue: number;
}

/** Filter chip selection for the draft board. */
export type DraftBoardFilter = "ALL" | "QB" | "RB" | "PASS" | "ROOKIE" | "VET";

export interface DraftLogEntry {
  pickIndex: number;
  pickNumber: string;
  teamCount: number; // number of teams at the time of the pick, used to rebuild pick order from cache
  teamName: string;
  rosterId?: string;
  playerId: string;
  playerName: string;
  positions: string[];
  nflTeam?: string;
}

export type ActiveTeamRecord = {
  rosterId: string;
  sessionId: string;
};

export type ActiveTeamApiRow = {
  rosterId?: string;
  roster_id?: string;
  sessionId?: string;
  session_id?: string;
};

/**
 * Curated rookie-prospect bio loaded from Supabase `rookie_prospects`. Used
 * as a per-field fallback when the live Sleeper player dictionary is missing
 * data (college, age, height_inches, weight) and as the source of NFL
 * Draft outcome fields (nfl_team, nfl_draft_round, nfl_draft_pick).
 */
export interface RookieProspect {
  player_id: string;
  name?: string | null;
  position?: string | null;
  college?: string | null;
  age?: number | null;
  height_inches?: number | null;
  weight?: number | null;
  nfl_team?: string | null;
  nfl_draft_round?: number | null;
  nfl_draft_pick?: number | null;
  avatar_url?: string | null;
}

export type RookieProspectMap = Record<string, RookieProspect>;

/**
 * Lowercase + strip everything except a-z/0-9. Used to key rookie_prospects
 * rows by player name so the fallback works regardless of whether the
 * Supabase row's `player_id` matches Sleeper's (e.g. when bootstrap rows
 * use `tmp_*` placeholders pre-NFL-draft).
 */
export function normalizeProspectName(name: string | null | undefined): string {
  return (name ?? "")
    .toLowerCase()
    .normalize("NFKD")
    .replace(/[\u0300-\u036f]/g, "")
    .replace(/[^a-z0-9]/g, "");
}
