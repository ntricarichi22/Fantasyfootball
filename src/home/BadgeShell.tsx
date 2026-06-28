"use client"

import { useEffect, useRef, useState, type ReactNode } from "react"

/* ─────────────────────────────────────────────────────────────────────────
   Employee ID badge — shared chrome for the front-office home screen.

   The GM and the three directors all render as laminated ID badges: a
   lanyard clip, a navy header band (team wordmark + crest), a faded team
   seal watermark, the variant-specific body, a barcode strip, and a navy
   ENTER OFFICE footer. GMPersonCard / DirectorPersonCard supply the body
   and footer status; every link/handler is passed in so behavior is
   unchanged from the old card UI.
   ───────────────────────────────────────────────────────────────────────── */

export const NAVY = "#16294A"
export const GOLD = "#E2A12C"
export const AMBER = "#E3A23C"
export const RED = "#E04A2C"
export const CREAM = "#F1E9D2"
export const PANEL = "#FCFAF3"
export const MUTED = "#A99B7B"

/** Constant league crest shown in every badge header. */
const CFC_LOGO = "/cfc-logo.png"

/* Shared vertical skeleton so all four badges line up row-for-row:
   identical portrait size, the TITLE/DEPARTMENT row, and the two tile
   rows (GM persona/stats ↔ director responsibility rows). */
export const PHOTO_W = 116
export const PHOTO_H = 122
/** Fixed height of the first info slot (name / DIRECTOR) so the second
    slot (title box / DEPARTMENT) starts at the same Y across badges. */
export const INFO_SLOT1_H = 55
export const INFO_SLOT_GAP = 6
export const TILE_H = 46
export const TILE_GAP = 8

/** Navy section tab (ATTRIBUTES / RESPONSIBILITIES) — identical on every
    badge so the tile rows below it line up across all four. */
export function SectionTab({ label }: { label: string }) {
  return (
    <div
      style={{
        display: "inline-flex",
        alignItems: "center",
        alignSelf: "flex-start",
        height: 20,
        boxSizing: "border-box",
        background: NAVY,
        color: "#F1E9D2",
        fontFamily: "'JetBrains Mono', monospace",
        fontSize: 9.5,
        fontWeight: 700,
        letterSpacing: "0.12em",
        padding: "0 11px",
        borderRadius: 6,
        marginTop: 14,
        flexShrink: 0,
      }}
    >
      {label}
    </div>
  )
}

/** Grayscale portrait that fills the frame width and sits flush to the
    bottom, showing the whole (square) original photo. The colored field
    shows as a thin strip above. Shared by the GM and director badges. */
export function Portrait({
  src,
  alt,
  fieldColor,
  fallback,
  onClick,
  ariaLabel,
}: {
  src: string
  alt: string
  fieldColor: string
  fallback: ReactNode
  onClick: () => void
  ariaLabel: string
}) {
  const [failed, setFailed] = useState(false)
  const imgRef = useRef<HTMLImageElement>(null)
  useEffect(() => {
    const img = imgRef.current
    if (img && img.complete && img.naturalWidth === 0) {
      queueMicrotask(() => setFailed(true))
    }
  }, [])
  return (
    <button
      type="button"
      onClick={onClick}
      aria-label={ariaLabel}
      style={{
        ...buttonReset,
        width: PHOTO_W,
        height: "100%",
        flexShrink: 0,
        background: fieldColor,
        border: `2.5px solid ${NAVY}`,
        borderRadius: 6,
        overflow: "hidden",
        display: "flex",
        flexDirection: "column",
        justifyContent: "flex-end",
        boxSizing: "border-box",
      }}
    >
      {failed ? (
        <div style={{ height: "100%", width: "100%", display: "flex", alignItems: "center", justifyContent: "center" }}>{fallback}</div>
      ) : (
        <img
          ref={imgRef}
          src={src}
          alt={alt}
          onError={() => setFailed(true)}
          style={{ width: "100%", height: "auto", display: "block", filter: "grayscale(1)" }}
        />
      )}
    </button>
  )
}

/** Deterministic vertical-bar barcode (no Math.random so SSR/CSR match). */
const BAR_WIDTHS = [
  2, 1, 3, 1, 1, 2, 1, 3, 2, 1, 1, 2, 3, 1, 2, 1, 1, 3, 1, 2, 2, 1, 1, 3, 2, 1,
  2, 1, 3, 1, 1, 2, 1, 2, 3, 1, 1, 2, 1, 3, 2, 1, 2, 1, 1, 3, 1, 2, 2, 1, 3, 1,
  1, 2, 1, 3, 2, 1, 1, 2, 3, 1, 2, 1,
]

function Barcode({ height = 30 }: { height?: number }) {
  // Bars flex-grow proportional to their weight so the whole strip fills
  // the content width (matching the ENTER OFFICE button below it).
  return (
    <div style={{ display: "flex", alignItems: "stretch", gap: 1.5, height, width: "100%" }} aria-hidden="true">
      {BAR_WIDTHS.map((w, i) => (
        <div key={i} style={{ flex: `${w} 0 0`, background: i % 2 === 0 ? NAVY : "transparent" }} />
      ))}
    </div>
  )
}

/** Faded team logo centered in the space between the portrait and the
    card's right edge (sits behind the title text). */
function TeamWatermark({ crestSrc }: { crestSrc: string }) {
  return (
    <div
      aria-hidden="true"
      style={{
        position: "absolute",
        top: 2,
        left: 12 + PHOTO_W,
        right: 6,
        height: PHOTO_H + 10,
        display: "flex",
        alignItems: "center",
        justifyContent: "center",
        pointerEvents: "none",
      }}
    >
      <img
        src={crestSrc}
        alt=""
        style={{ height: "100%", width: "auto", maxWidth: "100%", objectFit: "contain", opacity: 0.14, userSelect: "none" }}
      />
    </div>
  )
}

/** Red circle with a › chevron — the "go" affordance on persona bar + footer. */
export function RedChevron({ size = 20 }: { size?: number }) {
  return (
    <span
      aria-hidden="true"
      style={{
        width: size,
        height: size,
        borderRadius: "50%",
        background: RED,
        color: "#FFF",
        display: "inline-flex",
        alignItems: "center",
        justifyContent: "center",
        fontFamily: "system-ui, sans-serif",
        fontSize: size * 0.62,
        fontWeight: 800,
        lineHeight: 1,
        flexShrink: 0,
        paddingBottom: 1,
      }}
    >
      ›
    </span>
  )
}

export const buttonReset = {
  background: "none",
  border: "none",
  padding: 0,
  font: "inherit",
  color: "inherit",
  textAlign: "left",
  cursor: "pointer",
  width: "100%",
} as const

export type BadgeFooter = {
  label: string
  href: string
  /** Right-aligned status (e.g. red "6 NEW" pill, or red dot + WANTS A WORD) */
  status: ReactNode
  ariaLabel?: string
}

export type BadgeShellProps = {
  /** Team wordmark in the header, e.g. "Virginia Founders" */
  teamName: string
  /** Header crest, e.g. "/teams/founders.png" */
  crestSrc: string
  footer: BadgeFooter
  /** Variant body (photo + info + persona/responsibilities) */
  children: ReactNode
}

const BADGE_STYLES = `
.cfc-badge { transition: transform 140ms ease, box-shadow 140ms ease; }
.cfc-badge-footer { transition: transform 90ms ease, box-shadow 90ms ease; }
@media (hover: hover) {
  .cfc-badge-footer:hover { transform: translate(1px, 1px); }
}
`

export function BadgeShell({ teamName, crestSrc, footer, children }: BadgeShellProps) {
  const [crestFailed, setCrestFailed] = useState(false)
  const crestRef = useRef<HTMLImageElement>(null)

  useEffect(() => {
    const img = crestRef.current
    if (img && img.complete && img.naturalWidth === 0) {
      queueMicrotask(() => setCrestFailed(true))
    }
  }, [])

  return (
    <div
      className="cfc-badge"
      style={{
        position: "relative",
        background: CREAM,
        backgroundImage: "radial-gradient(rgba(22,41,74,0.05) 1px, transparent 1px)",
        backgroundSize: "7px 7px",
        border: `3px solid ${NAVY}`,
        borderRadius: 18,
        boxShadow: "5px 6px 0 rgba(22,41,74,0.28)",
        boxSizing: "border-box",
        overflow: "hidden",
        width: "100%",
        height: "100%",
        minHeight: 0,
        display: "flex",
        flexDirection: "column",
      }}
    >
      <style>{BADGE_STYLES}</style>

      {/* Lanyard clip */}
      <div style={{ flexShrink: 0, height: 24, display: "flex", alignItems: "center", justifyContent: "center" }}>
        <div style={{ width: 76, height: 9, borderRadius: 5, border: `2px solid ${NAVY}` }} />
      </div>

      {/* Header band */}
      <div
        style={{
          flexShrink: 0,
          background: NAVY,
          padding: "9px 13px",
          display: "flex",
          alignItems: "center",
          justifyContent: "space-between",
          gap: 8,
        }}
      >
        <div style={{ minWidth: 0 }}>
          <div
            style={{
              fontFamily: "Impact, 'Arial Narrow', sans-serif",
              fontSize: 17,
              letterSpacing: "0.01em",
              color: GOLD,
              lineHeight: 1,
              whiteSpace: "nowrap",
              overflow: "hidden",
              textOverflow: "ellipsis",
            }}
          >
            {teamName.toUpperCase()}
          </div>
          <div
            style={{
              fontFamily: "'JetBrains Mono', monospace",
              fontSize: 8,
              fontWeight: 600,
              letterSpacing: "0.34em",
              color: "rgba(255,255,255,0.62)",
              marginTop: 3,
              whiteSpace: "nowrap",
            }}
          >
            FRONT OFFICE
          </div>
        </div>
        {!crestFailed && (
          <img
            ref={crestRef}
            src={CFC_LOGO}
            alt=""
            onError={() => setCrestFailed(true)}
            style={{ height: 32, width: "auto", display: "block", flexShrink: 0 }}
          />
        )}
      </div>

      {/* Body */}
      <div
        style={{
          position: "relative",
          flex: 1,
          minHeight: 0,
          padding: 12,
          display: "flex",
          flexDirection: "column",
        }}
      >
        <TeamWatermark crestSrc={crestSrc} />

        <div style={{ position: "relative", zIndex: 1, display: "flex", flexDirection: "column", height: "100%", minHeight: 0 }}>
          {children}

          <div style={{ flex: 1, minHeight: 14 }} />

          {/* Barcode */}
          <Barcode />

          {/* Footer: ENTER OFFICE */}
          <button
            type="button"
            className="cfc-badge-footer"
            onClick={() => {
              window.location.href = footer.href
            }}
            aria-label={footer.ariaLabel ?? footer.label}
            style={{
              ...buttonReset,
              marginTop: 9,
              background: NAVY,
              borderRadius: 9,
              height: 46,
              padding: "0 11px",
              display: "flex",
              alignItems: "center",
              gap: 8,
            }}
          >
            <span
              style={{
                flexShrink: 0,
                fontFamily: "Impact, 'Arial Narrow', sans-serif",
                fontSize: 16,
                letterSpacing: "0.02em",
                color: GOLD,
                lineHeight: 1,
                whiteSpace: "nowrap",
              }}
            >
              ENTER OFFICE
            </span>
            <span style={{ flexShrink: 0 }}>{footer.status}</span>
            <span style={{ flex: 1, minWidth: 4 }} />
            <RedChevron size={22} />
          </button>
        </div>
      </div>
    </div>
  )
}
