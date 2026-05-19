export type DirectorWorkroom = {
  title: string
  href: string
  icon: string
}

export type DirectorConfig = {
  key: string
  title: string
  officeHref: string
  /** Bar background color */
  barBg: string
  /** Bar text color (white or near-black depending on bar bg) */
  barText: string
  /** rgba color used for the diagonal stripe overlay on the bar */
  barStripe: string
  /** Icon name for top-left of the bar (resolved by WorkroomIcon in DirectorBox) */
  headerIcon: string
  /** Eyebrow label shown above the rotating feed message inside the black window */
  feedLabel: string
  /** Rotating messages shown one at a time inside the black feed window */
  feedMessages: string[]
  /** Direct-link items shown below the yellow accent stripe */
  workrooms: DirectorWorkroom[]
}

export const DIRECTORS: DirectorConfig[] = [
  {
    key: "scouting",
    title: "Scouting",
    officeHref: "/scouting",
    barBg: "#E8503A",
    barText: "#FEFCF9",
    barStripe: "rgba(255,255,255,0.12)",
    headerIcon: "binoculars",
    feedLabel: "Wants a word",
    feedMessages: [
      "Three rookies climbing my board this week",
      "Updated rankings for next year's class are live",
      "Late-round sleeper hitting my radar",
    ],
    workrooms: [
      { title: "Big Board", href: "/scouting/big-board", icon: "clipboard-list" },
      { title: "Draft Room", href: "/scouting/draft-room", icon: "presentation" },
      { title: "Mock Draft", href: "/scouting/mock-draft", icon: "dice" },
    ],
  },
  {
    key: "pro_personnel",
    title: "Pro Personnel",
    officeHref: "/pro-personnel",
    barBg: "#FEFCF9",
    barText: "#1A1A1A",
    barStripe: "rgba(0,0,0,0.05)",
    headerIcon: "briefcase",
    feedLabel: "Wants a word",
    feedMessages: [
      "Two teams just texted about your RB",
      "Trade market is hot at QB right now",
      "Owner X looking to move a vet",
    ],
    workrooms: [
      { title: "Build a Trade", href: "/pro-personnel/trade-builder", icon: "arrows-exchange" },
      { title: "Shop My Guys", href: "/pro-personnel/shop", icon: "tag" },
    ],
  },
  {
    key: "strategy",
    title: "Strategy",
    officeHref: "/strategy",
    barBg: "#3366CC",
    barText: "#FEFCF9",
    barStripe: "rgba(255,255,255,0.12)",
    headerIcon: "bar-chart",
    feedLabel: "Wants a word",
    feedMessages: [
      "Roster gaps at WR3 and TE this week",
      "Standings tell a story — let's talk",
      "Your posture might need a refresh",
    ],
    workrooms: [
      { title: "Set Strategy", href: "/strategy/set-strategy", icon: "compass" },
      { title: "Set Availability", href: "/strategy/set-availability", icon: "calendar-check" },
    ],
  },
]