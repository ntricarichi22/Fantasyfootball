export type HistorianFamily =
  | "season_snapshot"
  | "franchise_history"
  | "matchup_history"
  | "weekly_performance"
  | "lineup_analysis"
  | "player_career"
  | "draft_history"
  | "transaction_history"
  | "historian_rankings";

export type HistorianFamilyConfig = {
  family: HistorianFamily;
  label: string;
  description: string;
  allowedViews: readonly string[];
  implemented: boolean;
};

export const HISTORIAN_FAMILIES: Record<HistorianFamily, HistorianFamilyConfig> = {
  season_snapshot: {
    family: "season_snapshot",
    label: "Season Snapshot",
    description:
      "Season-level standings, records, points, playoff context, and high-level year summaries.",
    allowedViews: ["llm.seasons", "llm.franchise_seasons", "llm.team_games", "llm.weeks"],
    implemented: true,
  },
  franchise_history: {
    family: "franchise_history",
    label: "Franchise History",
    description:
      "All-time franchise history across seasons, including cumulative results and year-by-year team summaries.",
    allowedViews: [
      "llm.franchises",
      "llm.franchise_seasons",
      "llm.team_games",
      "llm.matchups",
      "llm.seasons",
    ],
    implemented: false,
  },
  matchup_history: {
    family: "matchup_history",
    label: "Matchup History",
    description:
      "Head-to-head and rivalry questions, including records, margins, playoff meetings, and notable rematches.",
    allowedViews: ["llm.matchups", "llm.team_games", "llm.weeks", "llm.seasons"],
    implemented: false,
  },
  weekly_performance: {
    family: "weekly_performance",
    label: "Weekly Performance",
    description:
      "Single-week and single-game team performance questions, including highs, lows, upsets, and blowouts.",
    allowedViews: ["llm.team_games", "llm.matchups", "llm.weeks", "llm.seasons"],
    implemented: false,
  },
  lineup_analysis: {
    family: "lineup_analysis",
    label: "Lineup Analysis",
    description:
      "Starter, bench, optimal lineup, and start-sit questions, including playoff and championship lineup decisions.",
    allowedViews: ["llm.lineup_entries", "llm.team_games", "llm.players", "llm.weeks", "llm.seasons"],
    implemented: false,
  },
  player_career: {
    family: "player_career",
    label: "Player Career",
    description:
      "Player-centric league history including seasonal production, longevity, team history, and career superlatives.",
    allowedViews: [
      "llm.players",
      "llm.lineup_entries",
      "llm.team_games",
      "llm.transactions",
      "llm.transaction_items",
      "llm.seasons",
    ],
    implemented: false,
  },
  draft_history: {
    family: "draft_history",
    label: "Draft History",
    description:
      "Rookie draft history, pick outcomes, round/slot performance, draft classes, and draft ROI questions.",
    allowedViews: ["llm.draft_picks", "llm.players", "llm.lineup_entries", "llm.seasons"],
    implemented: false,
  },
  transaction_history: {
    family: "transaction_history",
    label: "Transaction History",
    description:
      "Trades, waivers, asset movement, and pick lineage across time.",
    allowedViews: [
      "llm.transactions",
      "llm.transaction_items",
      "llm.players",
      "llm.franchises",
      "llm.seasons",
    ],
    implemented: false,
  },
  historian_rankings: {
    family: "historian_rankings",
    label: "Historian Rankings",
    description:
      "Cross-category rankings and superlatives that combine deterministic outputs from other historian families.",
    allowedViews: [],
    implemented: false,
  },
};

export function isHistorianFamily(value: string): value is HistorianFamily {
  return value in HISTORIAN_FAMILIES;
}

export function getHistorianFamilyConfig(
  family: HistorianFamily
): HistorianFamilyConfig {
  return HISTORIAN_FAMILIES[family];
}

export function getImplementedHistorianFamilies(): HistorianFamily[] {
  return (Object.values(HISTORIAN_FAMILIES) as HistorianFamilyConfig[])
    .filter((config) => config.implemented)
    .map((config) => config.family);
}