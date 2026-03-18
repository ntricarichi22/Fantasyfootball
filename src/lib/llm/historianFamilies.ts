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

export const HISTORIAN_FAMILIES: Record<HistorianFamily, HistorianFamilyConfig> =
  {
    season_snapshot: {
      family: "season_snapshot",
      label: "Season Snapshot",
      description:
        "Season-level standings, records, regular-season points, playoff teams, and championship winner context.",
      allowedViews: [
        "llm.seasons",
        "llm.franchise_seasons",
        "llm.team_games",
        "llm.matchups",
      ],
      implemented: true,
    },
    franchise_history: {
      family: "franchise_history",
      label: "Franchise History",
      description:
        "All-time franchise history, including cumulative records, titles, playoff appearances, and year-by-year season summaries.",
      allowedViews: ["llm.franchises", "llm.franchise_seasons", "llm.team_games"],
      implemented: true,
    },
    matchup_history: {
      family: "matchup_history",
      label: "Matchup History",
      description:
        "Head-to-head and rivalry questions, including overall, regular-season, and playoff records between two franchises.",
      allowedViews: ["llm.matchups", "llm.seasons"],
      implemented: true,
    },
    weekly_performance: {
      family: "weekly_performance",
      label: "Weekly Performance",
      description:
        "Single-game and single-week team performance questions, including highest scores, lowest wins, blowouts, and close games.",
      allowedViews: ["llm.team_games", "llm.matchups", "llm.seasons"],
      implemented: true,
    },
    lineup_analysis: {
      family: "lineup_analysis",
      label: "Lineup Analysis",
      description:
        "Starter vs non-starter lineup questions, including bench-regret proxies and top benched-player results.",
      allowedViews: ["llm.lineup_entries"],
      implemented: true,
    },
    player_career: {
      family: "player_career",
      label: "Player Career",
      description:
        "Player-centric league history, including started points, best seasons, franchises played for, and draft origin.",
      allowedViews: ["llm.players", "llm.lineup_entries", "llm.draft_picks"],
      implemented: true,
    },
    draft_history: {
      family: "draft_history",
      label: "Draft History",
      description:
        "Draft pick lookup, round-based best/worst outcomes, draft classes, and franchise draft summaries.",
      allowedViews: ["llm.draft_picks", "llm.lineup_entries", "llm.players"],
      implemented: true,
    },
    transaction_history: {
      family: "transaction_history",
      label: "Transaction History",
      description:
        "Trades, waivers, player movement, and pick lineage over time.",
      allowedViews: [
        "llm.transaction_items",
        "llm.transactions",
        "llm.players",
        "llm.franchises",
      ],
      implemented: true,
    },
    historian_rankings: {
      family: "historian_rankings",
      label: "Historian Rankings",
      description:
        "Curated league-wide superlatives, including titles, playoff appearances, championship performances, and major playoff blowouts.",
      allowedViews: ["llm.team_games", "llm.matchups", "llm.franchise_seasons"],
      implemented: true,
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