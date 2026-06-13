export type DirectorWorkroom = {
  title: string
  href: string
  /** Legacy icon name - kept in the data but no longer rendered */
  icon?: string
}

export type DirectorConfig = {
  key: string
  title: string
  officeHref: string
  /** Headshot under public/, e.g. "/avatars/scouting.png" */
  avatarSrc: string
  /** Director's color: solid portrait-background fill behind the headshot */
  accentColor: string
  /** Eyebrow label for the door panel's notification line */
  feedLabel: string
  /** Rotating messages shown one at a time in the door panel */
  feedMessages: string[]
  /** Clickable responsibility rows below the door panel */
  workrooms: DirectorWorkroom[]
}

export const DIRECTORS: DirectorConfig[] = [
  {
    key: "scouting",
    title: "Scouting",
    officeHref: "/scouting",
    avatarSrc: "/avatars/scouting.png",
    accentColor: "#1A1A1A",
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
    avatarSrc: "/avatars/pro-personnel.png",
    // Red portrait field for the personnel director
    accentColor: "#E8503A",
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
    avatarSrc: "/avatars/strategy.png",
    accentColor: "#3366CC",
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
