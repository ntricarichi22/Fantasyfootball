"use client"

import { PersonaIcon } from "@/shared/ui/PersonaIcon"

// PersonaIcon's `persona` prop is a closed union. Mirror it here so the
// GMNameplate prop type is correct end-to-end.
type PersonaKey = "straight_shooter" | "closer" | "architect" | "hustler"

export type GMNameplateProps = {
  name: string
  personaKey: PersonaKey
  personaLabel: string
  championships: number
  years: number
  unreadCount: number
  inboxHref?: string
}

/**
 * The GM identity card in column 2 of the org chart. Black background with
 * subtle diagonal stripes, floating persona icon top-left, large brass-toned
 * "General Manager" eyebrow centered with the icon, GM name underneath, and
 * a white marquee at the bottom. Brass plaque overhangs the top-right as a
 * visual badge for unread inbox count. Clicking anywhere on the card opens
 * the inbox.
 */
export function GMNameplate({
  name,
  personaKey,
  personaLabel,
  championships,
  years,
  unreadCount,
  inboxHref = "/inbox",
}: GMNameplateProps) {
  const openInbox = () => {
    window.location.href = inboxHref
  }

  return (
    <button
      type="button"
      onClick={openInbox}
      aria-label={`Open inbox, ${unreadCount} unread`}
      style={{
        position: "relative",
        background: "#1A1A1A",
        border: "3px solid #1A1A1A",
        boxShadow: "4px 4px 0 #1A1A1A",
        display: "flex",
        flexDirection: "column",
        backgroundImage:
          "repeating-linear-gradient(135deg, transparent 0 18px, rgba(255,255,255,0.06) 18px 21px)",
        color: "#FEFCF9",
        height: 240,
        cursor: "pointer",
        textAlign: "left",
        padding: 0,
        fontFamily: "inherit",
        width: "100%",
      }}
    >
      {/* Brass plaque (visual badge - whole card is the click target) */}
      <div
        style={{
          position: "absolute",
          top: -3,
          right: 16,
          background: "#B89968",
          padding: "5px 12px",
          border: "2px solid #1A1A1A",
          borderTop: "none",
          fontFamily: "var(--font-mono, monospace)",
          fontSize: 10,
          fontWeight: 700,
          letterSpacing: "0.14em",
          textTransform: "uppercase",
          color: "#1A1A1A",
          zIndex: 3,
        }}
      >
        {unreadCount} New
      </div>

      {/* Body */}
      <div
        style={{
          flex: 1,
          padding: "18px 22px",
          width: "100%",
          boxSizing: "border-box",
        }}
      >
        {/* Icon + eyebrow row, vertically centered together */}
        <div
          style={{
            display: "flex",
            alignItems: "center",
            gap: 16,
          }}
        >
          <div style={{ flexShrink: 0, lineHeight: 0, color: "#FEFCF9" }}>
            <PersonaIcon persona={personaKey} size={48} />
          </div>
          <div
            style={{
              fontFamily: "var(--font-mono, monospace)",
              fontSize: 22,
              fontWeight: 700,
              letterSpacing: "0.14em",
              textTransform: "uppercase",
              color: "#B89968",
              lineHeight: 1,
            }}
          >
            General Manager
          </div>
        </div>

        {/* Big GM name */}
        <div
          style={{
            fontWeight: 800,
            fontSize: 40,
            lineHeight: 1,
            letterSpacing: "-0.01em",
            marginTop: 22,
            textTransform: "uppercase",
            color: "#FEFCF9",
          }}
        >
          {name}
        </div>
      </div>

      {/* White marquee at bottom */}
      <div
        style={{
          background: "#FEFCF9",
          color: "#1A1A1A",
          padding: "10px 14px",
          display: "flex",
          alignItems: "center",
          justifyContent: "center",
          gap: 10,
          fontFamily: "var(--font-mono, monospace)",
          fontSize: 10,
          fontWeight: 700,
          letterSpacing: "0.14em",
          textTransform: "uppercase",
          flexShrink: 0,
          borderTop: "2px solid #1A1A1A",
          flexWrap: "wrap",
          width: "100%",
          boxSizing: "border-box",
        }}
      >
        <PersonaIcon persona={personaKey} size={14} />
        <span>{personaLabel}</span>
        <span style={{ opacity: 0.35 }}>·</span>
        <span>
          {championships} {championships === 1 ? "Ring" : "Rings"}
        </span>
        <span style={{ opacity: 0.35 }}>·</span>
        <span>Year {years}</span>
      </div>
    </button>
  )
}