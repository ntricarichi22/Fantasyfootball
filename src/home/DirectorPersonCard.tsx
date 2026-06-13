"use client"

import { OrgPersonCard } from "./OrgPersonCard"
import type { DirectorConfig } from "./directors"

export type DirectorPersonCardProps = {
  director: DirectorConfig
  /** Shared tick from HomeScreen so all door teasers rotate in sync */
  tickerTick: number
}

function initialsFor(title: string): string {
  const words = title.trim().split(/\s+/)
  if (words.length === 1) return words[0].slice(0, 2).toUpperCase()
  return (words[0][0] + words[words.length - 1][0]).toUpperCase()
}

/**
 * One director on the home org chart. The headshot and the office door
 * both enter the office; the door carries the rotating "wants a word"
 * teaser next to its status dot. Each workroom is a row in the ledger.
 */
export function DirectorPersonCard({
  director,
  tickerTick,
}: DirectorPersonCardProps) {
  const message =
    director.feedMessages.length > 0
      ? director.feedMessages[tickerTick % director.feedMessages.length]
      : ""

  return (
    <OrgPersonCard
      name={`${director.title} Director`}
      avatarSrc={director.avatarSrc}
      avatarAlt={`${director.title} director`}
      frameColor={director.accentColor}
      avatarFallback={
        <span
          style={{
            fontFamily: "Impact, system-ui, sans-serif",
            fontSize: 40,
            fontWeight: 900,
            color: "#FEFCF9",
            letterSpacing: "0.04em",
          }}
        >
          {initialsFor(director.title)}
        </span>
      }
      onAvatarClick={() => {
        window.location.href = director.officeHref
      }}
      avatarAriaLabel={`Enter the ${director.title} office`}
      door={{
        label: "Director's Office",
        href: director.officeHref,
        // No real "wants a word" API signal yet - the dot stays yellow and
        // the hardcoded teasers rotate. Wire `active` to a signal later.
        notice: { active: true, text: message },
        ariaLabel: `Enter the ${director.title} office`,
      }}
      sectionLabel="Responsibilities"
      rows={director.workrooms.map((wr) => ({
        key: wr.href,
        label: wr.title,
        onClick: () => {
          window.location.href = wr.href
        },
      }))}
    />
  )
}
