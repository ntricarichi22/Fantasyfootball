export const TEAM_HQ_WANTS_MORE_VALUES = ["picks", "studs", "youth", "depth"] as const;
export const TEAM_HQ_MARKET_VALUES = ["buy", "hold", "sell"] as const;
export const TEAM_HQ_OWN_GUYS_VALUES = [
  "love_my_guys",
  "prefer_to_keep_them",
  "neutral",
  "ready_to_shake_it_up",
] as const;

export type TeamHqWantsMore = (typeof TEAM_HQ_WANTS_MORE_VALUES)[number];
export type TeamHqMarket = (typeof TEAM_HQ_MARKET_VALUES)[number];
export type TeamHqOwnGuysPreference = (typeof TEAM_HQ_OWN_GUYS_VALUES)[number];

export type TeamStrategyProfile = {
  league_id: string;
  team_id: string;
  wants_more: TeamHqWantsMore[];
  qb_market: TeamHqMarket;
  rb_market: TeamHqMarket;
  wr_market: TeamHqMarket;
  te_market: TeamHqMarket;
  picks_market: TeamHqMarket;
  own_guys_preference: TeamHqOwnGuysPreference;
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
  wr_market: "hold",
  te_market: "hold",
  picks_market: "hold",
  own_guys_preference: "neutral",
};
