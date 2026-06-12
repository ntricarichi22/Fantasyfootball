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
 * The GM on the home org chart - same anatomy as the director cards.
 * The headshot and "Your Office" door both open the inbox; the door's
 * status line mirrors the directors: pulsing yellow dot with the unread
 * count, or steady green when caught up. Attributes ledger below, with
 * only the persona row clickable.
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
  const hasUnread = unreadCount > 0

  return (
    <OrgPersonCard
      name={name}
      avatarSrc="/avatars/gm.png"
      avatarAlt={name}
      frameColor="#B89968"
      avatarFallback={
        <span style={{ color: "#1A1A1A", lineHeight: 0 }}>
          <PersonaIcon persona={persona} size={64} />
        </span>
      }
      onAvatarClick={() => {
        window.location.href = inboxHref
      }}
      avatarAriaLabel={`Enter your office, ${unreadCount} unread`}
      door={{
        label: "Your Office",
        href: inboxHref,
        notice: {
          active: hasUnread,
          text: hasUnread
            ? `${unreadCount} unread message${unreadCount === 1 ? "" : "s"} in your inbox`
            : "Desk is clear — you're all caught up",
        },
        ariaLabel: `Enter your office, ${unreadCount} unread`,
      }}
      sectionLabel="Attributes"
      rows={[
        {
          key: "persona",
          label: `Persona · ${personaLabel}`,
          onClick: onPersonaClick,
          ariaLabel: "Change persona",
        },
        {
          key: "championships",
          label: `Championships · ${championships}`,
        },
        {
          key: "tenure",
          label: `Tenure · Year ${years}`,
        },
      ]}
      isMobile={isMobile}
    />
  )
}
