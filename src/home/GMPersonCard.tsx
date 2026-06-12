"use client"

import { OrgPersonCard } from "./OrgPersonCard"
import { PersonaIcon } from "@/shared/ui/PersonaIcon"
import type { GmPersona } from "@/research-strategy/api/types"

export type GMPersonCardProps = {
  name: string
  persona: GmPersona
  personaLabel: string
  championships: number
  years: number
  unreadCount: number
  onPersonaClick: () => void
  isMobile?: boolean
  inboxHref?: string
}

/**
 * The GM on the home org chart, rendered as a person card with the
 * same anatomy as the director cards: avatar and door panel both open
 * the inbox (the GM's "office"), attributes listed as rows below.
 * Only the persona row is clickable - it opens the persona picker.
 */
export function GMPersonCard({
  name,
  persona,
  personaLabel,
  championships,
  years,
  unreadCount,
  onPersonaClick,
  isMobile = false,
  inboxHref = "/inbox",
}: GMPersonCardProps) {
  const openInbox = () => {
    window.location.href = inboxHref
  }

  const hasUnread = unreadCount > 0

  return (
    <OrgPersonCard
      name={name}
      subtitle="General Manager"
      avatarSrc="/avatars/gm.png"
      avatarAlt={name}
      frameColor="#B89968"
      avatarFallback={
        <span style={{ color: "#1A1A1A", lineHeight: 0 }}>
          <PersonaIcon persona={persona} size={120} />
        </span>
      }
      onAvatarClick={openInbox}
      avatarAriaLabel={`Open inbox, ${unreadCount} unread`}
      avatarAspect={isMobile ? "2 / 1" : "1 / 1"}
      door={{
        label: "Inbox",
        onClick: openInbox,
        notice: {
          active: hasUnread,
          text: hasUnread
            ? `${unreadCount} new message${unreadCount === 1 ? "" : "s"}`
            : "All clear",
        },
        ariaLabel: `Open inbox, ${unreadCount} unread`,
      }}
      sectionLabel="Attributes"
      rows={[
        {
          key: "persona",
          label: `Persona · ${personaLabel}`,
          accentColor: "#B89968",
          onClick: onPersonaClick,
          ariaLabel: "Change persona",
        },
        {
          key: "championships",
          label: `Championships · ${championships}`,
          accentColor: "#B89968",
        },
        {
          key: "tenure",
          label: `Tenure · Year ${years}`,
          accentColor: "#B89968",
        },
      ]}
      fillHeight={false}
    />
  )
}
