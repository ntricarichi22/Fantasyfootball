// Team name shortening for display contexts.
// Default rule: drop the first word (city). Overrides handle multi-word
// city prefixes that the default rule mishandles.

export const TEAM_NAME_OVERRIDES: Record<string, string> = {
  "Windy City Crossfitters": "Crossfitters",
};

export function teamNick(name: string): string {
  if (!name) return "";
  if (TEAM_NAME_OVERRIDES[name]) return TEAM_NAME_OVERRIDES[name];
  const parts = name.split(" ");
  return parts.length > 1 ? parts.slice(1).join(" ") : name;
}