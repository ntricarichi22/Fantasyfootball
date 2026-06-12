"use client"

import { OrgPersonCard } from "./OrgPersonCard"
import type { DirectorConfig } from "./directors"

export type DirectorPersonCardProps = {
  director: DirectorConfig
  /** Shared tick from HomeScreen so all door panels rotate in sync */
  tickerTick: number
  isMobile?: boolean
}

function initialsFor(title: string): string {
  const words = title.trim().split(/\s+/)
  if (words.length === 1) return words[0].slice(0, 2).toUpperCase()
  return (words[0][0] + words[words.length - 1][0]).toUpperCase()
}

/**
 * One director on the home org chart, rendered as a person card.
 * The avatar and the black door panel both enter the office; the
 * door panel carries the rotating "wants a word" teaser as its
 * notification line. Each workroom is its own clickable row.
 */
export function DirectorPersonCard({
  director,
  tickerTick,
  isMobile = false,
}: DirectorPersonCardProps) {
  const enterOffice = () => {
    window.location.href = director.officeHref
  }

  const message =
    director.feedMessages.length > 0
      ? director.feedMessages[tickerTick % director.feedMessages.length]
      : ""

  return (
    <OrgPersonCard
      name={director.title}
      subtitle="Director"
      avatarSrc={director.avatarSrc}
      avatarAlt={`${director.title} director`}
      frameColor={director.accentColor}
      avatarFallback={
        <span
          style={{
            fontFamily: "Impact, system-ui, sans-serif",
            fontSize: 48,
            fontWeight: 900,
            color: "#1A1A1A",
            letterSpacing: "0.04em",
          }}
        >
          {initialsFor(director.title)}
        </span>
      }
      onAvatarClick={enterOffice}
      avatarAriaLabel={`Open the ${director.title} office`}
      avatarAspect={isMobile ? "2 / 1" : "1 / 1"}
      door={{
        label: "Director's Office",
        onClick: enterOffice,
        // No real "wants a word" API signal yet - the dot stays on and
        // the hardcoded teasers rotate. Wire `active` to a signal later.
        notice: { active: true, text: message },
        ariaLabel: `Open the ${director.title} office`,
      }}
      sectionLabel="Responsibilities"
      rows={director.workrooms.map((wr) => ({
        key: wr.href,
        label: wr.title,
        accentColor: director.accentColor,
        onClick: () => {
          window.location.href = wr.href
        },
      }))}
      fillHeight
    />
  )
}
