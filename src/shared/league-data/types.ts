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

// ── Per-position trade intent ──────────────────────────────────────────────
// The signal the brain consumes, replacing the old global wantsMore array.
// Intent is tied to each position's market stance, so "young QB" vs "stud PC"
// is explicit instead of guessed. All three are MULTI-SELECT (stored as arrays;
// empty array = nothing selected). See trade_brain.docx Section 7.

// Buy side — "What do we need here?" (gated by the position's market = "buy").
//   difference_maker : studs + clear starter upgrades (go land the best guy).
//   insurance        : a proven guy who'd step in and start if a starter goes down.
//   young            : young pieces to build on (cornerstones down to cheap fliers).
export type BuyIntent = "difference_maker" | "insurance" | "young";

// Picks side — "What kind?" (gated by picksMarket = "buy").
//   premium : this year's first-rounders.
//   day2    : this year's 2nds & 3rds.
//   future  : down-the-road capital. On its own, means all future picks; combined
//             with premium/day2, extends those into future years too.
export type PicksKind = "premium" | "day2" | "future";

// Sell side — "What's the move?" (gated by the position's market = "sell").
//   consolidate : package this depth into one better player here (same engine
//                 action as a buy → difference_maker).
//   fill_need   : route the surplus to whatever else we've flagged thin (a
//                 position or picks). Governed by the other buy/picks settings.
export type SellMove = "consolidate" | "fill_need";

export type StrategyProfile = {
  teamId: string;
  // DEPRECATED — the old global wants signal. Kept only through the transition
  // to the per-position intent below; dropped (and the new fields tightened to
  // required) in the cleanup commit once nothing reads it.
  wantsMore: string[];
  qbMarket: MarketStance;
  rbMarket: MarketStance;
  pcMarket: MarketStance;
  picksMarket: MarketStance;
  persona: string | null;
  // Per-position intent. Optional ONLY during the transition — accessors
  // populates them (empty-array default) in the next file, and they become
  // required when wantsMore is removed. Consumers should read them as
  // `?? []` until then.
  qbBuyIntent?: BuyIntent[];
  rbBuyIntent?: BuyIntent[];
  pcBuyIntent?: BuyIntent[];
  picksBuyKind?: PicksKind[];
  qbSellMove?: SellMove[];
  rbSellMove?: SellMove[];
  pcSellMove?: SellMove[];
  picksSellMove?: SellMove[];
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