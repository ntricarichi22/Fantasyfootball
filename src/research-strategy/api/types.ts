export const TEAM_HQ_WANTS_MORE_VALUES = ["picks", "studs", "youth", "depth"] as const;
export const TEAM_HQ_MARKET_VALUES = ["buy", "hold", "sell"] as const;

// Per-position trade intent (multi-select arrays). See trade_brain.docx Section 7.
//   buy intent  — gated by <pos>_market = "buy"   ("what do we need here?")
//   picks kind  — gated by picks_market = "buy"    ("what kind of picks?")
//   sell move   — gated by <pos>_market = "sell"   ("what's the move?")
export const TEAM_HQ_BUY_INTENT_VALUES = ["difference_maker", "insurance", "young"] as const;
export const TEAM_HQ_PICKS_KIND_VALUES = ["premium", "day2", "future"] as const;
export const TEAM_HQ_SELL_MOVE_VALUES = ["consolidate", "fill_need"] as const;
export const TEAM_HQ_OWN_GUYS_VALUES = [
  "love_my_guys",
  "prefer_to_keep_them",
  "neutral",
  "ready_to_shake_it_up",
] as const;
export const GM_PERSONA_VALUES = [
  "closer",
  "straight_shooter",
  "architect",
  "hustler",
] as const;

export type TeamHqWantsMore = (typeof TEAM_HQ_WANTS_MORE_VALUES)[number];
export type TeamHqMarket = (typeof TEAM_HQ_MARKET_VALUES)[number];
export type TeamHqBuyIntent = (typeof TEAM_HQ_BUY_INTENT_VALUES)[number];
export type TeamHqPicksKind = (typeof TEAM_HQ_PICKS_KIND_VALUES)[number];
export type TeamHqSellMove = (typeof TEAM_HQ_SELL_MOVE_VALUES)[number];
export type TeamHqOwnGuysPreference = (typeof TEAM_HQ_OWN_GUYS_VALUES)[number];
export type GmPersona = (typeof GM_PERSONA_VALUES)[number];

export type TeamStrategyProfile = {
  league_id: string;
  team_id: string;
  wants_more: TeamHqWantsMore[];
  qb_market: TeamHqMarket;
  rb_market: TeamHqMarket;
  pc_market: TeamHqMarket;
  picks_market: TeamHqMarket;
  qb_buy_intent: TeamHqBuyIntent[];
  rb_buy_intent: TeamHqBuyIntent[];
  pc_buy_intent: TeamHqBuyIntent[];
  picks_buy_kind: TeamHqPicksKind[];
  qb_sell_move: TeamHqSellMove[];
  rb_sell_move: TeamHqSellMove[];
  pc_sell_move: TeamHqSellMove[];
  picks_sell_move: TeamHqSellMove[];
  own_guys_preference: TeamHqOwnGuysPreference;
  gm_persona: GmPersona;
};

export type TeamStrategyProfileInput = Partial<
  Omit<TeamStrategyProfile, "league_id" | "team_id">
>;

export type TeamTradeValueRow = {
  sleeper_player_id: string;
  player_name: string | null;
  position: string | null;
  nfl_team: string | null;
  base_value: number;
  auto_value: number;
  manual_override_value: number | null;
  final_value: number;
  studs_modifier_pct: number;
  youth_modifier_pct: number;
  market_modifier_pct: number;
  own_guys_modifier_pct: number;
  total_modifier_pct: number;
  is_overridden: boolean;
  delta_vs_base: number;
};

export const TEAM_STRATEGY_DEFAULTS: Omit<TeamStrategyProfile, "league_id" | "team_id"> = {
  wants_more: [],
  qb_market: "hold",
  rb_market: "hold",
  pc_market: "hold",
  picks_market: "hold",
  qb_buy_intent: [],
  rb_buy_intent: [],
  pc_buy_intent: [],
  picks_buy_kind: [],
  qb_sell_move: [],
  rb_sell_move: [],
  pc_sell_move: [],
  picks_sell_move: [],
  own_guys_preference: "neutral",
  gm_persona: "straight_shooter",
};