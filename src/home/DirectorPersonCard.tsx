"use client"

import { BadgeShell, Portrait, SectionTab, buttonReset, NAVY, RED, PANEL, PHOTO_H, INFO_SLOT1_H, INFO_SLOT_GAP, TILE_H, TILE_GAP } from "./BadgeShell"
import type { DirectorConfig } from "./directors"

export type DirectorPersonCardProps = {
  director: DirectorConfig
  /** Team wordmark + crest for the badge header */
  teamName: string
  crestSrc: string
}

/** Department name for the badge, e.g. "Pro Personnel" -> "PERSONNEL". */
function departmentLabel(title: string): string {
  return title.replace(/^Pro\s+/i, "").toUpperCase()
}

function initialsFor(title: string): string {
  const words = title.trim().split(/\s+/)
  if (words.length === 1) return words[0].slice(0, 2).toUpperCase()
  return (words[0][0] + words[words.length - 1][0]).toUpperCase()
}

const LABEL = {
  fontFamily: "'JetBrains Mono', monospace",
  fontSize: 8,
  fontWeight: 700,
  letterSpacing: "0.2em",
  color: NAVY,
  opacity: 0.6,
  lineHeight: 1,
} as const

/**
 * A director's employee ID badge: red photo field, TITLE / DEPARTMENT block,
 * a RESPONSIBILITIES tab, and one numbered row per workroom. The footer and
 * every row link straight to their old destinations — behavior is unchanged.
 */
export function DirectorPersonCard({ director, teamName, crestSrc }: DirectorPersonCardProps) {
  const dept = departmentLabel(director.title)

  const status = (
    <span style={{ display: "inline-flex", alignItems: "center", gap: 7 }}>
      <span style={{ width: 8, height: 8, borderRadius: "50%", background: RED, flexShrink: 0 }} />
      <span
        style={{
          fontFamily: "Impact, 'Arial Narrow', sans-serif",
          fontSize: 13,
          letterSpacing: "0.03em",
          color: "#FFF",
          whiteSpace: "nowrap",
        }}
      >
        WANTS A WORD
      </span>
    </span>
  )

  return (
    <BadgeShell
      teamName={teamName}
      crestSrc={crestSrc}
      footer={{
        label: "Enter Office",
        href: director.officeHref,
        status,
        ariaLabel: `Enter the ${director.title} office`,
      }}
    >
      {/* Photo + title / department */}
      <div style={{ display: "flex", gap: 12, height: PHOTO_H, flexShrink: 0 }}>
        <Portrait
          src={director.avatarSrc}
          alt={`${director.title} director`}
          fieldColor={RED}
          ariaLabel={`Enter the ${director.title} office`}
          onClick={() => {
            window.location.href = director.officeHref
          }}
          fallback={<span style={{ fontFamily: "Impact, sans-serif", fontSize: 34, color: "#FFF", letterSpacing: "0.04em" }}>{initialsFor(director.title)}</span>}
        />

        <div style={{ flex: 1, minWidth: 0, height: "100%", overflow: "hidden" }}>
          {/* Slot 1 — fixed height so DEPARTMENT aligns with the GM TITLE box */}
          <div style={{ height: INFO_SLOT1_H, overflow: "hidden" }}>
            <div style={LABEL}>TITLE</div>
            <div
              style={{
                fontFamily: "Impact, 'Arial Narrow', sans-serif",
                fontSize: 23,
                lineHeight: 0.95,
                letterSpacing: "0.01em",
                color: NAVY,
                marginTop: 5,
              }}
            >
              DIRECTOR
            </div>
          </div>
          {/* Slot 2 — DEPARTMENT, aligns with the GM TITLE row */}
          <div style={{ marginTop: INFO_SLOT_GAP }}>
            <div style={LABEL}>DEPARTMENT</div>
            <div
              style={{
                fontFamily: "Impact, 'Arial Narrow', sans-serif",
                fontSize: 23,
                lineHeight: 0.95,
                letterSpacing: "0.01em",
                color: NAVY,
                marginTop: 5,
                whiteSpace: "nowrap",
                overflow: "hidden",
                textOverflow: "ellipsis",
              }}
            >
              {dept}
            </div>
          </div>
        </div>
      </div>

      {/* Responsibilities tab — mirrors the GM's ATTRIBUTES tab */}
      <SectionTab label="RESPONSIBILITIES" />

      {/* One row per workroom */}
      <div style={{ display: "flex", flexDirection: "column", gap: TILE_GAP, marginTop: 8, flexShrink: 0 }}>
        {director.workrooms.map((wr, i) => (
          <button
            key={wr.href}
            type="button"
            onClick={() => {
              window.location.href = wr.href
            }}
            aria-label={wr.title}
            style={{
              ...buttonReset,
              display: "flex",
              alignItems: "stretch",
              height: TILE_H,
              boxSizing: "border-box",
              background: PANEL,
              border: `2.5px solid ${NAVY}`,
              borderRadius: 9,
              overflow: "hidden",
            }}
          >
            <span
              style={{
                background: RED,
                color: "#FFF",
                fontFamily: "Impact, 'Arial Narrow', sans-serif",
                fontSize: 17,
                display: "flex",
                alignItems: "center",
                justifyContent: "center",
                padding: "0 11px",
                flexShrink: 0,
              }}
            >
              {String(i + 1).padStart(2, "0")}
            </span>
            <span style={{ flex: 1, minWidth: 0, padding: "7px 10px", display: "flex", flexDirection: "column", justifyContent: "center", gap: 2 }}>
              <span
                style={{
                  fontFamily: "Impact, 'Arial Narrow', sans-serif",
                  fontSize: 14,
                  letterSpacing: "0.01em",
                  color: NAVY,
                  lineHeight: 1,
                  whiteSpace: "nowrap",
                  overflow: "hidden",
                  textOverflow: "ellipsis",
                }}
              >
                {wr.title.toUpperCase()}
              </span>
              {wr.subtitle && (
                <span
                  style={{
                    fontFamily: "'DM Sans', sans-serif",
                    fontSize: 9.5,
                    fontWeight: 500,
                    color: NAVY,
                    opacity: 0.72,
                    lineHeight: 1.2,
                    whiteSpace: "nowrap",
                    overflow: "hidden",
                    textOverflow: "ellipsis",
                  }}
                >
                  {wr.subtitle}
                </span>
              )}
            </span>
            <span
              aria-hidden="true"
              style={{
                color: RED,
                fontFamily: "system-ui, sans-serif",
                fontSize: 18,
                fontWeight: 800,
                display: "flex",
                alignItems: "center",
                paddingRight: 12,
                paddingLeft: 4,
                flexShrink: 0,
              }}
            >
              ›
            </span>
          </button>
        ))}
      </div>
    </BadgeShell>
  )
}
