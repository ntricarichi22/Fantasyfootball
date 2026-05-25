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

// One owned draft pick — the COMPLETE fact: current AND future picks, each
// carrying its canonical key. Scoping to a single draft year is a caller's job.
//   key:               see the pick-key contract — built identically to the trade engine.
//   slot / overall:    set for current-year picks with a known order; null for future.
//   kind:              season === cfcYear ? "current" : "future".
//   currentRosterId:   who holds it now (this is the ownership map key).
//   originalRosterId:  whose pick it originally is — drives the future-pick tier lookup.
export type OwnedPick = {
  key: string;
  season: number;
  round: number;
  slot: number | null;
  overall: number | null;
  kind: "current" | "future";
  currentRosterId: string;
  originalRosterId: string;
};

export type StrategyProfile = {
  teamId: string;
  wantsMore: string[];
  qbMarket: MarketStance;
  rbMarket: MarketStance;
  pcMarket: MarketStance;
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

// Canonical draft-pick slot ladder. Key = "R.SS" with a ZERO-PADDED slot
// (e.g. "1.06", "2.04", "3.12"); value = cfc_value from the pick_template rows.
export type PickLadder = Map<string, number>;

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
  pickOwnership: Map<string, OwnedPick[]>;
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