import { teamNickname } from "./nicknames";

// Each team's identity color, hand-picked from its logo art in public/teams
// (same nickname-slug keys as GM_NAMES and the logo files). Used anywhere a
// surface wants to wear a team's color — e.g. the negotiation card frame.
// Update alongside the logo if a team rebrands.
export const TEAM_COLORS: Record<string, string> = {
  birdmen: "#2E7D46", // kelly green jacket
  browns: "#A96B32", // paper-bag brown
  buschmasters: "#8E1F1F", // rattlesnake diamond red
  crossfitters: "#C83803", // Bears orange
  destroyers: "#1E2A4E", // battleship navy
  founders: "#1F3050", // crest navy
  freaks: "#C1502E", // burnt-orange orc
  kush: "#2447C5", // royal blue couch
  "matzos-balls": "#C87A24", // marigold skull flowers
  onslaught: "#2C2C2A", // blackout shield
  rawdoggers: "#33473A", // military dog-tag green
  wingmen: "#24335F", // patch navy
};

const FALLBACK = "#8C7E6A";

/** Identity color for a full team name (e.g. "Fairmount Freaks" -> burnt orange). */
export function teamColorFor(teamName: string): string {
  const slug = teamNickname(teamName).toLowerCase().replace(/\s+/g, "-");
  return TEAM_COLORS[slug] ?? FALLBACK;
}
