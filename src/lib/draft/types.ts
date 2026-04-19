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
}

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
