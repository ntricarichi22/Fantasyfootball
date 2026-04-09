export type LlmViewGuide = {
  view: string;
  purpose: string;
  keyColumns: string[];
  commonUses: string[];
  cautions?: string[];
};

export const ALLOWED_LLM_VIEWS = [
  "llm.seasons",
  "llm.franchise_seasons",
  "llm.team_games",
  "llm.matchups",
  "llm.lineup_entries",
  "llm.players",
  "llm.draft_picks",
  "llm.transactions",
  "llm.transaction_items",
  "llm.franchises",
] as const;

export const ALLOWED_LLM_VIEW_SET = new Set<string>(ALLOWED_LLM_VIEWS);

export const LLM_VIEW_GUIDE: LlmViewGuide[] = [
  {
    view: "llm.seasons",
    purpose: "Season-level context.",
    keyColumns: ["season_year", "championship_week"],
    commonUses: [
      "season boundaries",
      "championship-week lookups",
      "season-specific framing",
    ],
  },
  {
    view: "llm.franchise_seasons",
    purpose: "One franchise-season row per team-season.",
    keyColumns: ["franchise_id", "franchise_name", "season_year"],
    commonUses: [
      "which franchises existed in a season",
      "playoff drought / participation scaffolding",
      "season presence",
    ],
    cautions: [
      "Use llm.team_games to derive wins, losses, points, and playoff outcomes when possible.",
    ],
  },
  {
    view: "llm.team_games",
    purpose: "One row per franchise per game.",
    keyColumns: [
      "franchise_id",
      "franchise_name",
      "season_year",
      "week",
      "week_type",
      "opponent_franchise_name",
      "result",
      "points_for",
      "points_against",
      "is_playoffs",
      "is_championship",
    ],
    commonUses: [
      "single-team game results",
      "season records",
      "points-for / points-against",
      "playoff performance",
      "championship outcomes",
    ],
  },
  {
    view: "llm.matchups",
    purpose: "One row per matchup between two franchises.",
    keyColumns: [
      "season_year",
      "week",
      "week_type",
      "franchise_a_name",
      "franchise_b_name",
      "franchise_a_points",
      "franchise_b_points",
    ],
    commonUses: [
      "head-to-head records",
      "rivalries",
      "biggest blowouts",
      "closest games",
      "combined-score matchups",
    ],
  },
  {
    view: "llm.lineup_entries",
    purpose: "One player-row per franchise game lineup entry.",
    keyColumns: [
      "team_game_id",
      "season_year",
      "week",
      "week_type",
      "franchise_id",
      "franchise_name",
      "opponent_franchise_name",
      "result",
      "is_playoffs",
      "is_championship",
      "is_starter",
      "player_id",
      "player_name",
      "points",
    ],
    commonUses: [
      "player career scoring",
      "started vs benched points",
      "bench mistakes",
      "playoff player performance",
      "player-franchise stints at the weekly level",
    ],
    cautions: [
      "llm.lineup_entries.franchise_id is uuid.",
      "llm.lineup_entries.player_id is uuid.",
      "When joining llm.lineup_entries to llm.transaction_items on player_id, cast llm.lineup_entries.player_id::text.",
      "When evaluating post-acquisition value, bound points to the correct stint or time window instead of summing an entire player-franchise history.",
    ],
  },
  {
    view: "llm.players",
    purpose: "Player lookup table.",
    keyColumns: ["player_id", "player_name", "primary_position"],
    commonUses: [
      "player name disambiguation",
      "position context",
      "player existence checks",
    ],
  },
  {
    view: "llm.draft_picks",
    purpose: "Draft pick history and player selected.",
    keyColumns: [
      "draft_pick_id",
      "season_year",
      "round",
      "pick_number",
      "selected_by_franchise_id",
      "selected_by_franchise_name",
      "selected_player_id",
      "selected_player_name",
    ],
    commonUses: [
      "specific pick lookup",
      "best/worst draft pick",
      "draft classes",
      "franchise draft history",
      "value vs slot analysis",
    ],
  },
  {
    view: "llm.transactions",
    purpose: "Transaction-level header rows.",
    keyColumns: [
      "transaction_id",
      "season_year",
      "week",
      "transaction_ts",
      "transaction_type",
      "transaction_status",
      "platform",
    ],
    commonUses: [
      "transaction timing",
      "season-level transaction counts",
      "high-level transaction logs",
    ],
    cautions: [
      "Use llm.transaction_items, not llm.transactions alone, when you need players, picks, or from/to franchise movement.",
    ],
  },
  {
    view: "llm.transaction_items",
    purpose: "Transaction item rows with asset-level movement.",
    keyColumns: [
      "transaction_id",
      "season_year",
      "week",
      "transaction_ts",
      "transaction_type",
      "transaction_status",
      "platform",
      "asset_type",
      "player_id",
      "player_name",
      "pick_season",
      "pick_round",
      "pick_original_franchise_id",
      "pick_original_franchise_name",
      "from_franchise_id",
      "from_franchise_name",
      "to_franchise_id",
      "to_franchise_name",
      "action_type",
    ],
    commonUses: [
      "trade history",
      "waiver history",
      "pick lineage",
      "most traded players",
      "player movement between franchises",
    ],
    cautions: [
      "llm.transaction_items.player_id is text, not uuid.",
      "llm.transaction_items.to_franchise_id and from_franchise_id are uuid.",
      "For trade or waiver value questions, think in stints and time windows instead of naive player-franchise totals.",
      "transaction_type and action_type may both matter when distinguishing trade vs waiver vs claim behavior.",
    ],
  },
  {
    view: "llm.franchises",
    purpose: "Franchise lookup table.",
    keyColumns: ["franchise_id", "franchise_name"],
    commonUses: [
      "franchise name disambiguation",
      "franchise existence checks",
      "franchise ID lookup",
    ],
  },
];

export function buildHistorianSchemaGuide(): string {
  return [
    "Allowed read-only SQL surface: llm.* only.",
    "Use only SELECT statements.",
    "Critical join rules:",
    "- llm.transaction_items.player_id is text.",
    "- llm.lineup_entries.player_id is uuid.",
    "- Therefore, when joining those views on player_id, use llm.lineup_entries.player_id::text = llm.transaction_items.player_id (or equivalent text-safe comparison).",
    "- llm.transaction_items.to_franchise_id/from_franchise_id and llm.lineup_entries.franchise_id are uuid, so franchise_id joins are safe without casting.",
    "Known views:",
    ...LLM_VIEW_GUIDE.map((guide) => {
      const sections = [
        `- ${guide.view}: ${guide.purpose}`,
        `  key columns: ${guide.keyColumns.join(", ")}`,
        `  common uses: ${guide.commonUses.join(", ")}`,
      ];

      if (guide.cautions?.length) {
        sections.push(`  cautions: ${guide.cautions.join(" ")}`);
      }

      return sections.join("\n");
    }),
    "Historian reasoning rules:",
    "- Answer the actual user question, not a brittle keyword bucket.",
    "- For subjective rankings, define the metric explicitly before concluding.",
    "- Prefer exact franchise/player matches when possible; otherwise use a small lookup query first.",
    "- For trade and waiver value questions, bound scoring to the relevant stint or time window when the question implies a specific move.",
    "- Validate suspicious results with a follow-up query instead of guessing.",
    "- Use natural language in the final answer, not database-export phrasing.",
  ].join("\n");
}
