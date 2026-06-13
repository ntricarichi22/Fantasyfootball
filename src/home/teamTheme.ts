// Per-team masthead theming. Keyed by the nickname slug (the same slug
// used for GM avatars: lowercased, spaces -> hyphens).
//
// To match a team's logo, fill in an entry below: `band` is the masthead
// background, `text` the wordmark color, `accent` the rule + stat color.
// Anything not listed falls back to the neutral CFC default (black band,
// cream wordmark, gold accent). When real per-team logos land we can also
// auto-derive these from the logo's dominant colors.

export type TeamTheme = {
  band: string
  text: string
  accent: string
}

// CFC house palette (navy strip on a gold page) — fits the crest set.
// Override per team below once their logo colors are extracted.
const DEFAULT_THEME: TeamTheme = {
  band: "#0E2A4E",
  text: "#FEFCF9",
  accent: "#E2B23C",
}

const TEAM_THEMES: Record<string, TeamTheme> = {
  // wingmen: { band: "#7A1620", text: "#FEFCF9", accent: "#D9A33A" },
}

export function teamTheme(slug: string): TeamTheme {
  return TEAM_THEMES[slug] ?? DEFAULT_THEME
}
