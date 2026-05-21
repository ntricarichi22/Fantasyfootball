export type Position = "QB" | "RB" | "WR" | "TE";

export const POSITIONS: Position[] = ["QB", "RB", "WR", "TE"];

export type MarketStance = "buy" | "hold" | "sell" | "unknown";

export type AttachmentLevel = "untouchable" | "core_piece" | "listening" | "moveable";

// One player in the Sleeper dictionary. Position is narrowed to the four we
// value; everything else (K, DEF, etc.) is dropped upstream.
export type PlayerInfo = {
  id: string;
  name: string;
  position: Position;
  age: number | null;
  exp: number | null;
};

// A team's roster composition. No values or judgment here — just who is on it.
export type RosteredTeam = {
  rosterId: string;
  teamName: string;
  ownerId: string | null;
  playerIds: string[];
  starterIds: string[];
  players: PlayerInfo[];
};

// One owned draft pick (current year). overall = (round-1)*teamCount + slot.
export type PickInfo = {
  round: number;
  season: number;
  slot: number;
  overall: number;
  originalRosterId: string;
};

export type StrategyProfile = {
  teamId: string;
  wantsMore: string[];
  qbMarket: MarketStance;
  rbMarket: MarketStance;
  wrMarket: MarketStance;
  teMarket: MarketStance;
  picksMarket: MarketStance;
  persona: string | null;
};

// Last completed-season results, pulled from Sleeper roster settings.
export type SeasonResult = {
  rosterId: string;
  wins: number;
  losses: number;
  ties: number;
  points: number;
};

export type LeagueSettings = {
  // Starting-lineup slots, e.g. ["QB","RB","RB","WR","WR","WR","TE","FLEX","SUPER_FLEX"].
  rosterPositions: string[];
  previousLeagueId: string | null;
};

export type ValueMaps = {
  // Consensus CFC value, keyed by sleeper_player_id.
  value: Map<string, number>;
  // elite_multiplier_applied > 1.0, keyed by sleeper_player_id.
  isStud: Map<string, boolean>;
};

// Where last-season production actually came from, for transparency.
export type ResultsSource = "current" | "previous" | "none";

// The full assembled bundle. Pure facts — no scores, ranks, or classification.
export type LeagueData = {
  leagueId: string;
  cfcYear: number;
  teamCount: number;
  settings: LeagueSettings;
  players: Map<string, PlayerInfo>;
  teams: RosteredTeam[];
  values: ValueMaps;
  pickOwnership: Map<string, PickInfo[]>;
  strategy: Map<string, StrategyProfile>;
  attachments: Map<string, Map<string, AttachmentLevel>>;
  results: Map<string, SeasonResult>;
  resultsSource: ResultsSource;
  diagnostics: {
    rosterCount: number;
    playerDictSize: number;
    valueRowCount: number;
    studCount: number;
    strategyRowCount: number;
    attachmentRowCount: number;
    tradedPickCount: number;
    currentYearPickCount: number;
    rosterPositions: string[];
    resultsSource: ResultsSource;
    previousLeagueId: string | null;
  };
};