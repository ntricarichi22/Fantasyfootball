// Team nickname resolution — a shared FACT, used anywhere we show a short team
// name (e.g. "via Crossfitters"). General rule: the nickname is the LAST word
// of the team name ("Cleveland Founders" -> "Founders"). A multi-word CITY
// needs nothing special, since the last word is still the nickname
// ("Windy City Crossfitters" -> "Crossfitters").
//
// The one case the rule can't infer is a multi-word NICKNAME — "last word"
// would wrongly take only the final word. List those below: key = how the full
// team name ENDS (lowercased), value = how to display it. Add a line per team
// as needed; everything else falls back to the last word automatically.
const MULTI_WORD_NICKNAMES: Record<string, string> = {
  "matzos balls": "Matzos Balls",
  // The league name is "Mayfield Matzo Balls" (no s on Matzo) — map it to the
  // same display/slug so /teams/matzos-balls.png resolves.
  "matzo balls": "Matzos Balls",
};

/** Two-letter monogram fallback for when a crest image can't render. */
export function teamInitials(fullName: string): string {
  const name = (fullName ?? "").trim();
  if (!name || name === "—") return "GM";
  const words = name.split(/\s+/);
  if (words.length === 1) return words[0].slice(0, 2).toUpperCase();
  return (words[0][0] + words[words.length - 1][0]).toUpperCase();
}

/** Team crest under public/teams/, keyed by nickname slug — or null when the
 * team name is unknown/placeholder so callers can fall back to initials. */
export function teamCrestSrc(fullName: string): string | null {
  const name = (fullName ?? "").trim();
  if (!name || name === "—") return null;
  return `/teams/${teamNickname(name).toLowerCase().replace(/\s+/g, "-")}.png`;
}

/** Team-specific GM headshot under public/avatars/gm/, keyed by nickname slug —
 * or null when the team name is unknown/placeholder. */
export function gmAvatarSrc(fullName: string): string | null {
  const name = (fullName ?? "").trim();
  if (!name || name === "—") return null;
  return `/avatars/gm/${teamNickname(name).toLowerCase().replace(/\s+/g, "-")}.png`;
}

export function teamNickname(fullName: string): string {
  const name = (fullName ?? "").trim();
  if (!name) return name;
  const lower = name.toLowerCase();
  for (const [ending, display] of Object.entries(MULTI_WORD_NICKNAMES)) {
    if (lower.endsWith(ending)) return display;
  }
  const parts = name.split(/\s+/);
  return parts[parts.length - 1];
}