import type { League, Roster, Team } from "./types";

export const DEMO_TEAM_ID = 0;
export const DEMO_TEAMS: Team[] = [{ id: DEMO_TEAM_ID, name: "Demo Team" }];
export const DEMO_ROSTERS: Roster[] = [
  { roster_id: DEMO_TEAM_ID, owner_id: null, starters: [], players: [], draft_picks: [] },
];
export const DEMO_LEAGUE: League = { roster_positions: ["QB", "RB", "WR", "TE", "FLEX"] };

export const PLAYER_CACHE_KEY = "sleeper_player_dict";
export const PLAYER_CACHE_TIME_KEY = "sleeper_player_dict_time";
export const DRAFTED_CACHE_KEY = "drafted_players_state";
export const DRAFT_LOG_CACHE_KEY = "draft_log_state";
export const LINEUP_CACHE_KEY = "lineup_overrides_state";
export const SELECTED_TEAM_CACHE_KEY = "cfc_selected_team";
export const HEARTBEAT_INTERVAL_MS = 30_000;
export const ACTIVE_TEAMS_REFRESH_MS = 12_000;
export const CACHE_TTL_MS = 6 * 60 * 60 * 1000;
export const EMPTY_SLOT = "";
export const STATUS_MESSAGE_TIMEOUT_MS = 3000;
export const SKILL_POSITIONS = ["QB", "RB", "WR", "TE"];
/** Number of top-ranked prospects whose scouting grades are pre-computed on draft page load. */
export const PRECOMPUTED_GRADES_COUNT = 20;
export const DROPPABLE_BORDER_CLASS = "border border-blue-600/50";
export const MIN_TEAM_COUNT = 1;
