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
  /** Team-specific headshot, e.g. "/avatars/gm/founders.png" */
  avatarSrc: string
  onPersonaClick: () => void
  layout?: "badge" | "stack"
  inboxHref?: string
}

/**
 * The GM on the home org chart - same anatomy as the director cards.
 * The headshot and "Your Office" door both open the inbox; the door's
 * status mirrors the directors: pulsing yellow dot with the unread
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
  avatarSrc,
  onPersonaClick,
  layout = "badge",
  inboxHref = "/inbox",
}: GMPersonCardProps) {
  const hasUnread = unreadCount > 0

  return (
    <OrgPersonCard
      name={name}
      avatarSrc={avatarSrc}
      avatarAlt={name}
      frameColor="#B08D57"
      avatarFallback={
        <span style={{ color: "#FEFCF9", lineHeight: 0 }}>
          <PersonaIcon persona={persona} size={72} />
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
        { key: "championships", label: `Championships · ${championships}` },
        { key: "tenure", label: `Tenure · Year ${years}` },
      ]}
      layout={layout}
    />
  )
}
