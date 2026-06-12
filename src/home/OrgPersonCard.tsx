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
  /** Colored padded frame around the avatar */
  frameColor: string
  /** Rendered inside the cream inner box when the image is missing/broken */
  avatarFallback?: ReactNode
  onAvatarClick: () => void
  avatarAriaLabel: string
  /**
   * The office door: black door-elevation button with brass hinges and
   * handle. Swings open on hover, swings further on click, then navigates
   * to `href`. `notice.active` = pulsing yellow dot (something waiting);
   * inactive = steady green dot (all clear).
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
  /** Mobile: natural height + banner avatar. Desktop: fill height, avatar flexes. */
  isMobile?: boolean
}

const INK = "#1A1A1A"
const CREAM = "#FEFCF9"
const BRASS = "#B89968"
const BRASS_DARK = "#8A6F47"
const YELLOW = "#F5C230"
const GREEN = "#019942"

/**
 * Every card reserves ledger space for this many rows so avatars align.
 * Rows and tab are fixed-height so the reserve is exact across cards.
 */
const LEDGER_MIN_ROWS = 3
const LEDGER_ROW_H = 27
const LEDGER_TAB_H = 19
const LEDGER_BOX_BORDER = 4

const DOOR_STYLES = `
@keyframes cfc-dot-pulse {
  0%, 100% { opacity: 0.45; }
  50% { opacity: 1; }
}
.cfc-doorwrap { perspective: 700px; }
@media (hover: hover) {
  .cfc-doorwrap:hover .cfc-door:not(.cfc-door-opening) { transform: rotateY(-14deg); }
}
.cfc-door { transform-origin: left center; transition: transform 0.3s ease; }
.cfc-door-opening { transform: rotateY(-34deg); }
`

const monoLabel = {
  fontFamily: "'JetBrains Mono', monospace",
  fontWeight: 700,
  letterSpacing: "0.06em",
  textTransform: "uppercase",
  color: INK,
} as const

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
 * Person card for the home org chart, in the RosterPlayerCard aesthetic:
 * cream card with hard shadow, headshot in a colored frame, Impact
 * uppercase name, an office-door button, and a tabbed ledger of rows.
 * On desktop the card fills its grid cell and the headshot absorbs the
 * leftover height, so all four cards land at identical heights without
 * any card scrolling the page.
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
  isMobile = false,
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

  const openDoor = () => {
    if (doorOpening) return
    setDoorOpening(true)
    window.setTimeout(() => {
      window.location.href = door.href
    }, 300)
  }

  const ledgerMinHeight =
    LEDGER_TAB_H + LEDGER_MIN_ROWS * LEDGER_ROW_H + LEDGER_BOX_BORDER

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
        display: "flex",
        flexDirection: "column",
        ...(isMobile ? {} : { height: "100%", minHeight: 0 }),
      }}
    >
      <style>{DOOR_STYLES}</style>

      {/* Headshot in colored frame - flexes to absorb leftover height */}
      <div
        style={{
          padding: "8px 8px 0",
          ...(isMobile ? {} : { flex: 1, minHeight: 0, display: "flex" }),
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
            ...(isMobile ? {} : { height: "100%", minHeight: 0 }),
          }}
        >
          <div
            style={{
              background: CREAM,
              borderRadius: 5,
              overflow: "hidden",
              display: "flex",
              alignItems: "center",
              justifyContent: "center",
              ...(isMobile
                ? { aspectRatio: "2 / 1" }
                : { height: "100%", minHeight: 40 }),
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
                  objectPosition: "center 25%",
                  display: "block",
                }}
              />
            )}
          </div>
        </button>
      </div>

      {/* One-line name */}
      <p
        style={{
          fontFamily: "Impact, system-ui, sans-serif",
          fontSize: 20,
          fontWeight: 900,
          color: INK,
          margin: 0,
          padding: "9px 12px 7px",
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
        <div
          className="cfc-doorwrap"
          style={{ background: BRASS, borderRadius: 8 }}
        >
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
              padding: "8px 32px 8px 13px",
              minHeight: 54,
              boxSizing: "border-box",
              display: "block",
            }}
          >
            {/* Recessed door panel outline */}
            <span
              aria-hidden="true"
              style={{
                position: "absolute",
                inset: 4,
                border: "1px solid rgba(254,252,249,0.22)",
                borderRadius: 5,
                pointerEvents: "none",
              }}
            />
            {/* Hinges */}
            <span
              aria-hidden="true"
              style={{
                position: "absolute",
                left: -1,
                top: 11,
                width: 3,
                height: 10,
                background: BRASS,
                borderRadius: 1,
              }}
            />
            <span
              aria-hidden="true"
              style={{
                position: "absolute",
                left: -1,
                bottom: 11,
                width: 3,
                height: 10,
                background: BRASS,
                borderRadius: 1,
              }}
            />
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
            <span
              style={{
                display: "flex",
                alignItems: "center",
                gap: 7,
                marginTop: 6,
              }}
            >
              <span
                aria-hidden="true"
                style={{
                  width: 7,
                  height: 7,
                  borderRadius: "50%",
                  background: door.notice.active ? YELLOW : GREEN,
                  flexShrink: 0,
                  animation: door.notice.active
                    ? "cfc-dot-pulse 1.6s ease-in-out infinite"
                    : undefined,
                }}
              />
              <span
                style={{
                  fontFamily: "'DM Sans', sans-serif",
                  fontSize: 12,
                  fontWeight: 500,
                  color: CREAM,
                  opacity: 0.9,
                  lineHeight: 1.2,
                  whiteSpace: "nowrap",
                  overflow: "hidden",
                  textOverflow: "ellipsis",
                }}
              >
                {door.notice.text}
              </span>
            </span>
            {/* Brass handle */}
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
      <div
        style={{
          padding: "8px 8px 8px",
          flexShrink: 0,
          ...(isMobile ? {} : { minHeight: ledgerMinHeight }),
          boxSizing: "content-box",
        }}
      >
        <div
          style={{
            display: "flex",
            width: "fit-content",
            alignItems: "center",
            height: LEDGER_TAB_H,
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
        <div
          style={{
            border: `2px solid ${INK}`,
            borderRadius: "0 8px 8px 8px",
            overflow: "hidden",
          }}
        >
          {rows.map((row, i) => {
            const rowStyle = {
              height: LEDGER_ROW_H,
              padding: "0 11px",
              borderBottom:
                i < rows.length - 1 ? `2px solid ${INK}` : "none",
              display: "flex",
              justifyContent: "space-between",
              alignItems: "center",
              boxSizing: "border-box",
            } as const
            const labelSpan = (
              <span style={{ ...monoLabel, fontSize: 11, lineHeight: 1.1 }}>
                {row.label}
              </span>
            )
            return row.onClick ? (
              <button
                key={row.key}
                type="button"
                onClick={row.onClick}
                aria-label={row.ariaLabel ?? row.label}
                style={{ ...buttonReset, ...rowStyle }}
              >
                {labelSpan}
                <span
                  style={{
                    fontFamily: "system-ui, sans-serif",
                    fontSize: 14,
                    fontWeight: 700,
                    color: INK,
                    lineHeight: 1,
                  }}
                >
                  {"›"}
                </span>
              </button>
            ) : (
              <div key={row.key} style={rowStyle}>
                {labelSpan}
              </div>
            )
          })}
        </div>
      </div>
    </div>
  )
}
