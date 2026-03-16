export type LlmIntent = "season_summary";

type IntentConfig = {
  intent: LlmIntent;
  allowedViews: string[];
  description: string;
};

const intentCatalog: Record<LlmIntent, IntentConfig> = {
  season_summary: {
    intent: "season_summary",
    allowedViews: ["llm.seasons", "llm.franchise_seasons"],
    description: "For season-level summary questions only.",
  },
};

export function isSupportedIntent(value: string): value is LlmIntent {
  return value in intentCatalog;
}

export function getAllowedViewsForIntent(intent: LlmIntent): string[] {
  return intentCatalog[intent].allowedViews;
}
