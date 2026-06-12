"use client"

import { useEffect, useRef, useState, type ReactNode } from "react"

export type OrgPersonRow = {
  key: string
  /** Mono uppercase label, e.g. "BIG BOARD" or "CHAMPIONSHIPS · 2" */
  label: string
  /** 6px left accent border color */
  accentColor?: string
  /** When set the row renders as a button with a › chevron */
  onClick?: () => void
  ariaLabel?: string
}

export type OrgPersonCardProps = {
  name: string
  subtitle: string
  avatarSrc: string
  avatarAlt: string
  /** Colored padded frame around the avatar (the availability-badge frame) */
  frameColor: string
  /** Rendered inside the cream inner box when the image is missing/broken */
  avatarFallback?: ReactNode
  onAvatarClick: () => void
  avatarAriaLabel: string
  /** Default square; mobile passes "2 / 1" to crop into a banner */
  avatarAspect?: string
  /**
   * The door: the card's one emphasized destination (office/inbox).
   * Black two-line panel — mono label + chevron on top, notification
   * status underneath. `notice.active` shows the pulsing yellow dot.
   */
  door: {
    label: string
    onClick: () => void
    notice: { active: boolean; text?: ReactNode }
    ariaLabel?: string
  }
  /** "RESPONSIBILITIES" | "ATTRIBUTES" */
  sectionLabel: string
  rows: OrgPersonRow[]
  /** height:100% so cards equalize when the grid row stretches */
  fillHeight?: boolean
}

const PULSE_KEYFRAMES = `
@keyframes cfc-ticker-pulse {
  0%, 100% { opacity: 0.45; }
  50% { opacity: 1; }
}
`

const buttonReset = {
  background: "none",
  border: "none",
  padding: 0,
  font: "inherit",
  color: "inherit",
  textAlign: "left",
  cursor: "pointer",
  width: "100%",
} as const

/**
 * Person card for the home org chart, mirroring the RosterPlayerCard
 * aesthetic from Set Availability: cream card with hard shadow, square
 * avatar in a colored frame, Impact uppercase name, then pill rows.
 * Unlike RosterPlayerCard the root is NOT clickable — the avatar, the
 * door panel, and individual rows are each their own targets.
 */
export function OrgPersonCard({
  name,
  subtitle,
  avatarSrc,
  avatarAlt,
  frameColor,
  avatarFallback,
  onAvatarClick,
  avatarAriaLabel,
  avatarAspect = "1 / 1",
  door,
  sectionLabel,
  rows,
  fillHeight = false,
}: OrgPersonCardProps) {
  const [imgFailed, setImgFailed] = useState(false)
  const imgRef = useRef<HTMLImageElement>(null)
  const showFallback = imgFailed || !avatarSrc

  // A missing image can finish erroring before React hydrates, so the
  // onError handler never fires - catch that case on mount.
  useEffect(() => {
    const img = imgRef.current
    if (img && img.complete && img.naturalWidth === 0) {
      setImgFailed(true)
    }
  }, [])

  return (
    <div
      style={{
        background: "#FEFCF9",
        border: "3px solid #1A1A1A",
        borderRadius: 12,
        boxShadow: "4px 4px 0 #1A1A1A",
        boxSizing: "border-box",
        overflow: "hidden",
        width: "100%",
        display: "flex",
        flexDirection: "column",
        ...(fillHeight ? { height: "100%" } : {}),
      }}
    >
      <style>{PULSE_KEYFRAMES}</style>

      {/* Avatar in colored frame - the person's "door" by portrait */}
      <div style={{ padding: "10px 10px 0" }}>
        <button
          type="button"
          onClick={onAvatarClick}
          aria-label={avatarAriaLabel}
          style={{
            ...buttonReset,
            display: "block",
            background: frameColor,
            padding: 5,
            borderRadius: 8,
            boxSizing: "border-box",
          }}
        >
          <div
            style={{
              aspectRatio: avatarAspect,
              background: "#FEFCF9",
              borderRadius: 5,
              overflow: "hidden",
              display: "flex",
              alignItems: "center",
              justifyContent: "center",
            }}
          >
            {showFallback ? (
              avatarFallback ?? null
            ) : (
              <img
                ref={imgRef}
                src={avatarSrc}
                alt={avatarAlt}
                onError={() => setImgFailed(true)}
                style={{
                  width: "100%",
                  height: "100%",
                  objectFit: "cover",
                  display: "block",
                }}
              />
            )}
          </div>
        </button>
      </div>

      {/* Name + subtitle */}
      <div style={{ padding: "12px 14px 8px" }}>
        <p
          style={{
            fontFamily: "Impact, system-ui, sans-serif",
            fontSize: 22,
            fontWeight: 900,
            color: "#1A1A1A",
            margin: 0,
            lineHeight: 1,
            letterSpacing: "0.01em",
          }}
        >
          {name.toUpperCase()}
        </p>
        <p
          style={{
            fontFamily: "'DM Sans', sans-serif",
            fontSize: 11,
            fontWeight: 700,
            color: "#1A1A1A",
            margin: "6px 0 0",
          }}
        >
          {subtitle}
        </p>
      </div>

      {/* Door panel - emphasized destination, sits before the rows */}
      <div style={{ padding: "0 10px 6px" }}>
        <button
          type="button"
          onClick={door.onClick}
          aria-label={door.ariaLabel ?? door.label}
          style={{
            ...buttonReset,
            background: "#1A1A1A",
            border: "2px solid #1A1A1A",
            borderRadius: 8,
            padding: "9px 12px",
            display: "flex",
            flexDirection: "column",
            gap: 6,
            boxSizing: "border-box",
            minHeight: 64,
            justifyContent: "center",
          }}
        >
          <span
            style={{
              display: "flex",
              justifyContent: "space-between",
              alignItems: "center",
              width: "100%",
            }}
          >
            <span
              style={{
                fontFamily: "'JetBrains Mono', monospace",
                fontSize: 12,
                fontWeight: 800,
                color: "#FEFCF9",
                letterSpacing: "0.06em",
                textTransform: "uppercase",
              }}
            >
              {door.label}
            </span>
            <span
              style={{
                fontFamily: "system-ui, sans-serif",
                fontSize: 16,
                fontWeight: 700,
                color: "#FEFCF9",
                lineHeight: 1,
              }}
            >
              {"›"}
            </span>
          </span>
          <span
            style={{
              display: "flex",
              alignItems: "center",
              gap: 7,
              minHeight: 16,
            }}
          >
            {door.notice.active && (
              <span
                style={{
                  width: 8,
                  height: 8,
                  borderRadius: "50%",
                  background: "#F5C230",
                  flexShrink: 0,
                  animation: "cfc-ticker-pulse 1.6s ease-in-out infinite",
                }}
              />
            )}
            <span
              style={{
                fontFamily: "'DM Sans', sans-serif",
                fontSize: 12,
                lineHeight: 1.32,
                fontWeight: 500,
                color: door.notice.active ? "#FEFCF9" : "rgba(254,252,249,0.55)",
              }}
            >
              {door.notice.text}
            </span>
          </span>
        </button>
      </div>

      {/* Section label + rows */}
      <div
        style={{
          padding: "4px 10px 10px",
          display: "flex",
          flexDirection: "column",
          gap: 6,
          flex: 1,
        }}
      >
        <div
          style={{
            fontFamily: "'JetBrains Mono', monospace",
            fontSize: 9,
            fontWeight: 700,
            letterSpacing: "0.16em",
            textTransform: "uppercase",
            color: "#8C7E6A",
            padding: "0 2px",
          }}
        >
          {sectionLabel}
        </div>
        {rows.map((row) => {
          const inner = (
            <>
              <span
                style={{
                  fontFamily: "'JetBrains Mono', monospace",
                  fontSize: 12,
                  fontWeight: 800,
                  color: "#1A1A1A",
                  letterSpacing: "0.06em",
                  textTransform: "uppercase",
                }}
              >
                {row.label}
              </span>
              {row.onClick && (
                <span
                  style={{
                    fontFamily: "system-ui, sans-serif",
                    fontSize: 16,
                    fontWeight: 700,
                    color: "#1A1A1A",
                    lineHeight: 1,
                  }}
                >
                  {"›"}
                </span>
              )}
            </>
          )
          const rowStyle = {
            background: "#FEFCF9",
            border: "2px solid #1A1A1A",
            borderLeft: `6px solid ${row.accentColor ?? "#1A1A1A"}`,
            borderRadius: 8,
            padding: "9px 12px",
            display: "flex",
            justifyContent: "space-between",
            alignItems: "center",
            boxSizing: "border-box",
          } as const
          return row.onClick ? (
            <button
              key={row.key}
              type="button"
              onClick={row.onClick}
              aria-label={row.ariaLabel ?? row.label}
              style={{ ...buttonReset, ...rowStyle }}
            >
              {inner}
            </button>
          ) : (
            <div key={row.key} style={rowStyle}>
              {inner}
            </div>
          )
        })}
      </div>
    </div>
  )
}
