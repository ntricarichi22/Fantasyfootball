"use client"

import { useEffect, useRef, useState, type ReactNode } from "react"

export type OrgPersonRow = {
  key: string
  /** Mono uppercase label, e.g. "BIG BOARD" or "CHAMPIONSHIPS · 2" */
  label: string
  /** When set the row renders as a button with a › chevron */
  onClick?: () => void
  ariaLabel?: string
}

export type OrgPersonCardProps = {
  name: string
  avatarSrc: string
  avatarAlt: string
  /** Solid color filled behind the portrait (and the frame around it) */
  frameColor: string
  /** Rendered inside the portrait box when the image is missing/broken */
  avatarFallback?: ReactNode
  onAvatarClick: () => void
  avatarAriaLabel: string
  /**
   * The office door: black paneled button with brass hinges and handle.
   * Swings on hover, swings further on click, then navigates to `href`.
   * `notice.active` = pulsing yellow dot; inactive = steady green dot.
   */
  door: {
    label: string
    href: string
    notice: { active: boolean; text: ReactNode }
    ariaLabel?: string
  }
  /** "RESPONSIBILITIES" | "ATTRIBUTES" - yellow tab on the ledger */
  sectionLabel: string
  rows: OrgPersonRow[]
  /**
   * Desktop row: fixed portrait height so headshots, doors and ledger
   * tabs all line up across cards, with leftover space falling to the
   * bottom. Mobile (fill): portrait flexes to fill the card.
   */
  fixedPortrait?: boolean
  portraitHeight?: number
}

const INK = "#1A1A1A"
const CREAM = "#FEFCF9"
const BRASS = "#B89968"
const BRASS_DARK = "#8A6F47"
const YELLOW = "#F5C230"
const GREEN = "#019942"

const DOOR_STYLES = `
@keyframes cfc-dot-pulse {
  0%, 100% { opacity: 0.45; }
  50% { opacity: 1; }
}
.cfc-doorwrap { perspective: 700px; }
@media (hover: hover) {
  .cfc-doorwrap:hover .cfc-door:not(.cfc-door-opening) { transform: rotateY(-13deg); }
}
.cfc-door { transform-origin: left center; transition: transform 0.3s ease; }
.cfc-door-opening { transform: rotateY(-34deg); }
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
 * Portrait person card for the home front office: cream card with a hard
 * shadow, a headshot on a solid team-color field filling the top, the
 * Impact name, an office-door button, then a yellow-tabbed ledger. The
 * portrait flexes so every card in a row lands at the same height.
 */
export function OrgPersonCard({
  name,
  avatarSrc,
  avatarAlt,
  frameColor,
  avatarFallback,
  onAvatarClick,
  avatarAriaLabel,
  door,
  sectionLabel,
  rows,
  fixedPortrait = false,
  portraitHeight = 220,
}: OrgPersonCardProps) {
  const [imgFailed, setImgFailed] = useState(false)
  const [doorOpening, setDoorOpening] = useState(false)
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

  // The door swings open on click before navigating. Returning via the
  // browser back/forward cache restores the page mid-swing, so reset the
  // door to closed whenever the page is shown again.
  useEffect(() => {
    const reset = () => setDoorOpening(false)
    window.addEventListener("pageshow", reset)
    return () => window.removeEventListener("pageshow", reset)
  }, [])

  const openDoor = () => {
    if (doorOpening) return
    setDoorOpening(true)
    window.setTimeout(() => {
      window.location.href = door.href
    }, 300)
  }

  return (
    <div
      style={{
        background: CREAM,
        border: `3px solid ${INK}`,
        borderRadius: 12,
        boxShadow: `4px 4px 0 ${INK}`,
        boxSizing: "border-box",
        overflow: "hidden",
        width: "100%",
        height: "100%",
        minHeight: 0,
        display: "flex",
        flexDirection: "column",
      }}
    >
      <style>{DOOR_STYLES}</style>

      {/* Headshot on the team-color field. Desktop: fixed height so the
          headshots line up. Mobile: flexes to fill the card. */}
      <div
        style={{
          padding: "8px 8px 0",
          display: "flex",
          ...(fixedPortrait
            ? { height: portraitHeight, flexShrink: 0 }
            : { flex: 1, minHeight: 0 }),
        }}
      >
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
            height: "100%",
            minHeight: 0,
          }}
        >
          <div
            style={{
              background: frameColor,
              borderRadius: 5,
              overflow: "hidden",
              height: "100%",
              minHeight: 40,
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
                  objectPosition: "center top",
                  display: "block",
                }}
              />
            )}
          </div>
        </button>
      </div>

      {/* Name */}
      <p
        style={{
          fontFamily: "Impact, system-ui, sans-serif",
          fontSize: 17,
          fontWeight: 900,
          color: INK,
          margin: 0,
          padding: "9px 11px 7px",
          lineHeight: 1,
          letterSpacing: "0.01em",
          whiteSpace: "nowrap",
          overflow: "hidden",
          textOverflow: "ellipsis",
          flexShrink: 0,
        }}
      >
        {name.toUpperCase()}
      </p>

      {/* Office door */}
      <div style={{ padding: "0 8px", flexShrink: 0 }}>
        <div className="cfc-doorwrap" style={{ background: BRASS, borderRadius: 8 }}>
          <button
            type="button"
            onClick={openDoor}
            aria-label={door.ariaLabel ?? door.label}
            className={`cfc-door${doorOpening ? " cfc-door-opening" : ""}`}
            style={{
              ...buttonReset,
              position: "relative",
              background: INK,
              borderRadius: 8,
              padding: "9px 30px 9px 13px",
              height: 72,
              boxSizing: "border-box",
              display: "flex",
              flexDirection: "column",
              justifyContent: "center",
            }}
          >
            <span
              aria-hidden="true"
              style={{ position: "absolute", inset: 4, border: "1px solid rgba(254,252,249,0.22)", borderRadius: 5, pointerEvents: "none" }}
            />
            <span aria-hidden="true" style={{ position: "absolute", left: -1, top: 12, width: 3, height: 10, background: BRASS, borderRadius: 1 }} />
            <span aria-hidden="true" style={{ position: "absolute", left: -1, bottom: 12, width: 3, height: 10, background: BRASS, borderRadius: 1 }} />
            <span
              style={{
                display: "block",
                fontFamily: "'JetBrains Mono', monospace",
                fontSize: 11,
                fontWeight: 700,
                letterSpacing: "0.12em",
                textTransform: "uppercase",
                color: CREAM,
                lineHeight: 1,
              }}
            >
              {door.label}
            </span>
            <span style={{ display: "flex", alignItems: "flex-start", gap: 7, marginTop: 6 }}>
              <span
                aria-hidden="true"
                style={{
                  width: 7,
                  height: 7,
                  borderRadius: "50%",
                  background: door.notice.active ? YELLOW : GREEN,
                  flexShrink: 0,
                  marginTop: 4,
                  animation: door.notice.active ? "cfc-dot-pulse 1.6s ease-in-out infinite" : undefined,
                }}
              />
              <span
                style={{
                  fontFamily: "'DM Sans', sans-serif",
                  fontSize: 12,
                  fontWeight: 500,
                  color: CREAM,
                  opacity: 0.9,
                  lineHeight: 1.3,
                  minWidth: 0,
                  display: "-webkit-box",
                  WebkitLineClamp: 2,
                  WebkitBoxOrient: "vertical",
                  overflow: "hidden",
                }}
              >
                {door.notice.text}
              </span>
            </span>
            <span
              aria-hidden="true"
              style={{
                position: "absolute",
                right: 9,
                top: "50%",
                transform: "translateY(-50%)",
                width: 10,
                height: 36,
                background: BRASS,
                border: `1.5px solid ${BRASS_DARK}`,
                borderRadius: 5,
                boxSizing: "border-box",
              }}
            />
          </button>
        </div>
      </div>

      {/* Ledger: yellow tab + merged rows */}
      <div style={{ padding: "8px 8px 8px", flexShrink: 0 }}>
        <div
          style={{
            display: "flex",
            width: "fit-content",
            alignItems: "center",
            height: 19,
            boxSizing: "border-box",
            background: YELLOW,
            border: `2px solid ${INK}`,
            borderBottom: "none",
            borderRadius: "6px 6px 0 0",
            padding: "0 10px",
            fontFamily: "'JetBrains Mono', monospace",
            fontSize: 10,
            fontWeight: 700,
            letterSpacing: "0.14em",
            textTransform: "uppercase",
            color: INK,
            lineHeight: 1,
          }}
        >
          {sectionLabel}
        </div>
        <div style={{ border: `2px solid ${INK}`, borderRadius: "0 8px 8px 8px", overflow: "hidden" }}>
          {rows.map((row, i) => {
            const rowStyle = {
              height: 27,
              padding: "0 11px",
              borderBottom: i < rows.length - 1 ? `2px solid ${INK}` : "none",
              display: "flex",
              justifyContent: "space-between",
              alignItems: "center",
              boxSizing: "border-box",
            } as const
            const labelSpan = (
              <span
                style={{
                  fontFamily: "'JetBrains Mono', monospace",
                  fontWeight: 700,
                  letterSpacing: "0.06em",
                  textTransform: "uppercase",
                  color: INK,
                  fontSize: 11,
                  lineHeight: 1.1,
                  whiteSpace: "nowrap",
                  overflow: "hidden",
                  textOverflow: "ellipsis",
                }}
              >
                {row.label}
              </span>
            )
            return row.onClick ? (
              <button key={row.key} type="button" onClick={row.onClick} aria-label={row.ariaLabel ?? row.label} style={{ ...buttonReset, ...rowStyle }}>
                {labelSpan}
                <span style={{ fontFamily: "system-ui, sans-serif", fontSize: 14, fontWeight: 700, color: INK, lineHeight: 1, flexShrink: 0, paddingLeft: 6 }}>{"›"}</span>
              </button>
            ) : (
              <div key={row.key} style={rowStyle}>
                {labelSpan}
              </div>
            )
          })}
        </div>
      </div>

      {/* Leftover space (e.g. cards with fewer responsibilities) falls here */}
      {fixedPortrait && <div style={{ flex: 1, minHeight: 0 }} />}
    </div>
  )
}
