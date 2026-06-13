import { teamNickname } from "@/shared/league-data/nicknames"

// Real owner names per team, keyed by nickname slug (same slugs as the GM
// avatars). Sleeper only stores team names + login handles, not real names,
// so these are maintained here. Update when an owner changes.
export const GM_NAMES: Record<string, string> = {
  birdmen: "Larry Yusuf",
  browns: "Jeff Gleason",
  buschmasters: "Mike DiNunzio",
  crossfitters: "Dan Cronin",
  destroyers: "Anthony Tricarichi",
  founders: "Nick Tricarichi",
  freaks: "Nidal Qasem",
  kush: "Ryan Goldstein",
  "matzos-balls": "Gabe Goldstein",
  onslaught: "Porter Loud",
  rawdoggers: "Andy Doucet",
  wingmen: "Kramer Voigt",
}

/** Owner name for a full team name (e.g. "Buffalo Wingmen" -> "Kramer Voigt"). */
export function gmNameFor(teamName: string): string | undefined {
  const slug = teamNickname(teamName).toLowerCase().replace(/\s+/g, "-")
  return GM_NAMES[slug]
}
