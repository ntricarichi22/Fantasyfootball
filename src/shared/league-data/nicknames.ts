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
};

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