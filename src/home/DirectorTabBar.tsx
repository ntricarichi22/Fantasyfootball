"use client"

const INK = "#1A1A1A"
const PAPER = "#FEFCF9"
const YELLOW = "#F5C230"

export type DirectorTab = {
  key: string
  /** Short label, e.g. "Scouting" */
  label: string
  avatarSrc: string
  /** Solid color behind the thumb portrait */
  color: string
  /** Yellow dot when something's waiting, green when clear */
  active: boolean
}

export type DirectorTabBarProps = {
  items: DirectorTab[]
  activeKey: string | null
  onSelect: (key: string) => void
}

/**
 * Persistent bottom tab bar for the mobile home screen, matching the
 * Set Strategy / Set Availability bottom-nav schema: paper fill, 3px
 * ink top border, 2px ink dividers between buttons, and the selected
 * tab inverted to ink fill with paper text. Each tab carries the
 * director's portrait thumb, name, "Director" subline, and status dot.
 */
export function DirectorTabBar({ items, activeKey, onSelect }: DirectorTabBarProps) {
  return (
    <div style={{ display: "flex", background: PAPER, borderTop: `3px solid ${INK}`, flexShrink: 0 }}>
      {items.map((it, i) => {
        const on = activeKey === it.key
        const fg = on ? PAPER : INK
        return (
          <button
            key={it.key}
            type="button"
            onClick={() => onSelect(it.key)}
            style={{
              flex: 1,
              minWidth: 0,
              border: "none",
              borderRight: i < items.length - 1 ? `2px solid ${INK}` : "none",
              background: on ? INK : PAPER,
              color: fg,
              padding: "11px 6px",
              cursor: "pointer",
              display: "flex",
              alignItems: "center",
              justifyContent: "center",
              gap: 7,
              fontFamily: "inherit",
            }}
          >
            <span
              style={{
                width: 32,
                height: 32,
                borderRadius: 5,
                background: it.color,
                flexShrink: 0,
                overflow: "hidden",
                display: "block",
              }}
            >
              <img
                src={it.avatarSrc}
                alt=""
                aria-hidden="true"
                style={{ width: "100%", height: "100%", objectFit: "cover", objectPosition: "center top", display: "block" }}
              />
            </span>
            <span style={{ minWidth: 0, textAlign: "left" }}>
              <span style={{ display: "flex", alignItems: "center", gap: 4 }}>
                <span
                  style={{
                    fontFamily: "'JetBrains Mono', monospace",
                    fontSize: 11,
                    fontWeight: 700,
                    letterSpacing: "0.04em",
                    color: fg,
                    whiteSpace: "nowrap",
                    overflow: "hidden",
                    textOverflow: "ellipsis",
                  }}
                >
                  {it.label.toUpperCase()}
                </span>
                <span
                  aria-hidden="true"
                  style={{
                    width: 5,
                    height: 5,
                    borderRadius: "50%",
                    background: it.active ? YELLOW : "#019942",
                    flexShrink: 0,
                  }}
                />
              </span>
              <span
                style={{
                  display: "block",
                  fontFamily: "'JetBrains Mono', monospace",
                  fontSize: 10,
                  fontWeight: 700,
                  letterSpacing: "0.06em",
                  color: fg,
                  opacity: 0.6,
                  lineHeight: 1.2,
                }}
              >
                DIRECTOR
              </span>
            </span>
          </button>
        )
      })}
    </div>
  )
}
