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

const DEFAULT_THEME: TeamTheme = {
  band: "#1A1A1A",
  text: "#FEFCF9",
  accent: "#F5C230",
}

const TEAM_THEMES: Record<string, TeamTheme> = {
  // founders: { band: "#0B2C5C", text: "#FEFCF9", accent: "#C8A24A" },
}

export function teamTheme(slug: string): TeamTheme {
  return TEAM_THEMES[slug] ?? DEFAULT_THEME
}
