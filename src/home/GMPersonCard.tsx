"use client"

import { type CSSProperties } from "react"
import { BadgeShell, Portrait, SectionTab, RedChevron, buttonReset, NAVY, AMBER, RED, PANEL, PHOTO_H, INFO_SLOT1_H, INFO_SLOT_GAP, TILE_H, TILE_GAP } from "./BadgeShell"
import { PersonaIcon } from "@/shared/ui/PersonaIcon"
import type { GmPersona } from "@/research-strategy/api/types"

export type GMPersonCardProps = {
  /** Bare GM name for the badge, e.g. "Nick Tricarichi" */
  name: string
  /** Team wordmark + crest for the badge header */
  teamName: string
  crestSrc: string
  persona: GmPersona
  personaLabel: string
  championships: number
  years: number
  unreadCount: number
  /** Team-specific headshot, e.g. "/avatars/gm/founders.png" */
  avatarSrc: string
  onPersonaClick: () => void
  inboxHref?: string
}

/** Two-line split of a full name so the badge stacks first / last. */
function splitName(name: string): [string, string] {
  const parts = name.trim().split(/\s+/)
  if (parts.length < 2) return [name.toUpperCase(), ""]
  const first = parts[0]
  const rest = parts.slice(1).join(" ")
  return [first.toUpperCase(), rest.toUpperCase()]
}

const LABEL: CSSProperties = {
  fontFamily: "'JetBrains Mono', monospace",
  fontSize: 8,
  fontWeight: 700,
  letterSpacing: "0.2em",
  color: NAVY,
  opacity: 0.6,
  lineHeight: 1,
}

/**
 * The GM's employee ID badge: amber photo, name block, GM title chip, the
 * persona bar (tap to change), and the tenure / titles stat boxes. The
 * footer enters the inbox; the persona bar opens the persona picker.
 */
export function GMPersonCard({
  name,
  teamName,
  crestSrc,
  persona,
  personaLabel,
  championships,
  years,
  unreadCount,
  avatarSrc,
  onPersonaClick,
  inboxHref = "/inbox",
}: GMPersonCardProps) {
  const [first, last] = splitName(name)
  const hasUnread = unreadCount > 0

  const status = hasUnread ? (
    <span
      style={{
        background: RED,
        color: "#FFF",
        fontFamily: "Impact, 'Arial Narrow', sans-serif",
        fontSize: 12,
        letterSpacing: "0.04em",
        padding: "4px 9px",
        borderRadius: 5,
        lineHeight: 1,
        whiteSpace: "nowrap",
      }}
    >
      {unreadCount} NEW
    </span>
  ) : (
    <span style={{ display: "inline-flex", alignItems: "center", gap: 6 }}>
      <span style={{ width: 8, height: 8, borderRadius: "50%", background: "#3FB24F", flexShrink: 0 }} />
      <span
        style={{
          fontFamily: "'JetBrains Mono', monospace",
          fontSize: 9,
          fontWeight: 700,
          letterSpacing: "0.08em",
          color: "rgba(255,255,255,0.85)",
          whiteSpace: "nowrap",
        }}
      >
        ALL CLEAR
      </span>
    </span>
  )

  return (
    <BadgeShell
      teamName={teamName}
      crestSrc={crestSrc}
      footer={{
        label: "Enter Office",
        href: inboxHref,
        status,
        ariaLabel: `Enter your office, ${unreadCount} unread`,
      }}
    >
      {/* Photo + name / title */}
      <div style={{ display: "flex", gap: 12, height: PHOTO_H, flexShrink: 0 }}>
        <Portrait
          src={avatarSrc}
          alt={name}
          fieldColor={AMBER}
          ariaLabel="Enter your office"
          onClick={() => {
            window.location.href = inboxHref
          }}
          fallback={
            <span style={{ color: NAVY, lineHeight: 0, filter: "grayscale(1)" }}>
              <PersonaIcon persona={persona} size={56} />
            </span>
          }
        />

        <div style={{ flex: 1, minWidth: 0, height: "100%", overflow: "hidden" }}>
          {/* Slot 1 — fixed height so the title row aligns across badges */}
          <div style={{ height: INFO_SLOT1_H, overflow: "hidden" }}>
            <div style={LABEL}>NAME</div>
            <div
              style={{
                fontFamily: "Impact, 'Arial Narrow', sans-serif",
                fontSize: 21,
                lineHeight: 0.95,
                letterSpacing: "0.01em",
                color: NAVY,
                marginTop: 5,
              }}
            >
              {first}
              {last && (
                <>
                  <br />
                  {last}
                </>
              )}
            </div>
          </div>

          {/* Slot 2 — TITLE box, aligns with the director DEPARTMENT row */}
          <div style={{ marginTop: INFO_SLOT_GAP }}>
            <div style={LABEL}>TITLE</div>
            <div
              style={{
                marginTop: 5,
                border: `2.5px solid ${NAVY}`,
                borderRadius: 7,
                overflow: "hidden",
                display: "flex",
                alignItems: "stretch",
                background: PANEL,
              }}
            >
            <div
              style={{
                background: RED,
                color: "#FFF",
                fontFamily: "Impact, 'Arial Narrow', sans-serif",
                fontSize: 16,
                letterSpacing: "0.02em",
                display: "flex",
                alignItems: "center",
                justifyContent: "center",
                padding: "0 10px",
                flexShrink: 0,
              }}
            >
              GM
            </div>
            <div
              style={{
                fontFamily: "Impact, 'Arial Narrow', sans-serif",
                fontSize: 13,
                lineHeight: 1,
                color: NAVY,
                display: "flex",
                alignItems: "center",
                padding: "6px 9px",
              }}
            >
              GENERAL
              <br />
              MANAGER
            </div>
            </div>
          </div>
        </div>
      </div>

      {/* Attributes tab — mirrors the directors' RESPONSIBILITIES tab */}
      <SectionTab label="ATTRIBUTES" />

      {/* Persona bar */}
      <button
        type="button"
        onClick={onPersonaClick}
        aria-label="Change persona"
        style={{
          ...buttonReset,
          marginTop: 8,
          background: `linear-gradient(180deg, ${AMBER} 0%, #D9952F 100%)`,
          border: `2.5px solid ${NAVY}`,
          borderRadius: 9,
          height: TILE_H,
          flexShrink: 0,
          padding: "0 10px",
          display: "flex",
          alignItems: "center",
          gap: 7,
        }}
      >
        <span style={{ color: NAVY, lineHeight: 0, flexShrink: 0 }}>
          <PersonaIcon persona={persona} size={22} />
        </span>
        <span
          style={{
            flex: 1,
            minWidth: 0,
            fontFamily: "Impact, 'Arial Narrow', sans-serif",
            fontSize: 13,
            letterSpacing: "0.01em",
            color: NAVY,
            lineHeight: 1,
            whiteSpace: "nowrap",
            overflow: "hidden",
            textOverflow: "ellipsis",
          }}
        >
          {personaLabel.toUpperCase()}
        </span>
        <span
          style={{
            flexShrink: 0,
            fontFamily: "'JetBrains Mono', monospace",
            fontSize: 7,
            fontWeight: 700,
            letterSpacing: "0.05em",
            color: NAVY,
            opacity: 0.7,
            whiteSpace: "nowrap",
          }}
        >
          TAP TO CHANGE
        </span>
        <RedChevron size={20} />
      </button>

      {/* Stat boxes */}
      <div style={{ display: "flex", gap: 9, marginTop: TILE_GAP, flexShrink: 0 }}>
        <StatBox label="TENURE" value={`YR ${years}`} />
        <StatBox label="TITLES" value={`${championships}×`} accent />
      </div>
    </BadgeShell>
  )
}

function StatBox({ label, value, accent = false }: { label: string; value: string; accent?: boolean }) {
  const color = accent ? RED : NAVY
  return (
    <div
      style={{
        flex: 1,
        minWidth: 0,
        background: PANEL,
        border: `2.5px solid ${accent ? RED : NAVY}`,
        borderRadius: 9,
        height: TILE_H,
        padding: "0 12px",
        display: "flex",
        alignItems: "center",
        justifyContent: "space-between",
        gap: 6,
      }}
    >
      <span
        style={{
          fontFamily: "'JetBrains Mono', monospace",
          fontSize: 9,
          fontWeight: 700,
          letterSpacing: "0.12em",
          color,
          whiteSpace: "nowrap",
        }}
      >
        {label}
      </span>
      <span
        style={{
          fontFamily: "Impact, 'Arial Narrow', sans-serif",
          fontSize: 19,
          letterSpacing: "0.02em",
          color: NAVY,
          lineHeight: 1,
          whiteSpace: "nowrap",
        }}
      >
        {value}
      </span>
    </div>
  )
}
