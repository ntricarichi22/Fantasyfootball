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

/** Theme derived from a team's identity color (hand-picked palette entry, or
 * the dominant color of an uploaded logo): the color becomes the masthead
 * band, wordmark ink flips light/dark for contrast, page stays house gold. */
export function themeFromColor(color: string | null): TeamTheme {
  const m = color ? /^#([0-9a-f]{6})$/i.exec(color) : null
  if (!m) return DEFAULT_THEME
  const n = parseInt(m[1], 16)
  const lum =
    (0.2126 * ((n >> 16) & 255) + 0.7152 * ((n >> 8) & 255) + 0.0722 * (n & 255)) / 255
  return {
    band: color!,
    text: lum > 0.62 ? "#13131A" : "#FEFCF9",
    accent: DEFAULT_THEME.accent,
  }
}
