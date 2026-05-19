"use client"

import { Ticker } from "@/shared/ui/Ticker"
import type { DirectorConfig } from "./directors"

/**
 * Inline SVG icon set used by DirectorBox.
 * Hand-rolled outline icons (Tabler is not installed in the repo) on a
 * 24x24 viewBox. Includes workroom icons, navigation icons, and the three
 * director header icons (binoculars, briefcase, bar-chart).
 */
function WorkroomIcon({
  name,
  size = 18,
  color = "currentColor",
}: {
  name: string
  size?: number
  color?: string
}) {
  const common = {
    width: size,
    height: size,
    viewBox: "0 0 24 24",
    fill: "none" as const,
    stroke: color,
    strokeWidth: 2,
    strokeLinecap: "round" as const,
    strokeLinejoin: "round" as const,
    "aria-hidden": true,
  }

  switch (name) {
    // Workroom (responsibility) icons
    case "clipboard-list":
      return (
        <svg {...common}>
          <rect x="9" y="3" width="6" height="4" rx="1" />
          <path d="M9 5H7a2 2 0 0 0-2 2v12a2 2 0 0 0 2 2h10a2 2 0 0 0 2-2V7a2 2 0 0 0-2-2h-2" />
          <path d="M9 12h6" />
          <path d="M9 16h6" />
        </svg>
      )
    case "presentation":
      return (
        <svg {...common}>
          <rect x="3" y="4" width="18" height="12" rx="1" />
          <path d="M12 16v4" />
          <path d="M8 20h8" />
          <path d="M7 12l2-2 2 2 4-5" />
        </svg>
      )
    case "dice":
      return (
        <svg {...common}>
          <rect x="4" y="4" width="16" height="16" rx="2" />
          <circle cx="9" cy="9" r="1.2" fill={color} stroke="none" />
          <circle cx="12" cy="12" r="1.2" fill={color} stroke="none" />
          <circle cx="15" cy="15" r="1.2" fill={color} stroke="none" />
        </svg>
      )
    case "arrows-exchange":
      return (
        <svg {...common}>
          <path d="M7 10h13" />
          <path d="M17 7l3 3-3 3" />
          <path d="M17 14H4" />
          <path d="M7 11l-3 3 3 3" />
        </svg>
      )
    case "tag":
      return (
        <svg {...common}>
          <path d="M3 12V4a1 1 0 0 1 1-1h8l9 9-9 9-9-9z" />
          <circle cx="7" cy="7" r="1.5" fill={color} stroke="none" />
        </svg>
      )
    case "compass":
      return (
        <svg {...common}>
          <circle cx="12" cy="12" r="9" />
          <path d="M14.5 9.5l-2 5-5 2 2-5 5-2z" />
        </svg>
      )
    case "calendar-check":
      return (
        <svg {...common}>
          <rect x="4" y="5" width="16" height="16" rx="2" />
          <path d="M4 10h16" />
          <path d="M9 3v4" />
          <path d="M15 3v4" />
          <path d="M9 15l2 2 4-4" />
        </svg>
      )
    case "door-enter":
      return (
        <svg {...common}>
          <path d="M13 3h6a2 2 0 0 1 2 2v14a2 2 0 0 1-2 2h-6" />
          <path d="M3 12h10" />
          <path d="M10 9l3 3-3 3" />
        </svg>
      )
    case "arrow-right":
      return (
        <svg {...common}>
          <path d="M5 12h14" />
          <path d="M13 6l6 6-6 6" />
        </svg>
      )
    // Director header icons
    case "binoculars":
      return (
        <svg {...common}>
          <path d="M3 6h6v8a3 3 0 0 1-6 0z" />
          <path d="M15 6h6v8a3 3 0 0 1-6 0z" />
          <path d="M9 11h6" />
        </svg>
      )
    case "briefcase":
      return (
        <svg {...common}>
          <rect x="3" y="7" width="18" height="14" rx="2" />
          <path d="M9 7V4a1 1 0 0 1 1-1h4a1 1 0 0 1 1 1v3" />
          <path d="M3 13h18" />
          <path d="M11 13v2" />
        </svg>
      )
    case "bar-chart":
      return (
        <svg {...common}>
          <path d="M3 20h18" />
          <rect x="5" y="13" width="3" height="7" />
          <rect x="10" y="9" width="3" height="11" />
          <rect x="15" y="5" width="3" height="15" />
        </svg>
      )
    default:
      return null
  }
}

export type DirectorBoxProps = {
  director: DirectorConfig
  tickerTick: number
}

/**
 * One of three director cards on the home org chart. The colored bar
 * (the "office facade") is one big click target that opens the director's
 * office. Below the yellow accent stripe, each responsibility is its own
 * link. Card height locked at 295px and bar at 185px so all three cards
 * line up across the row regardless of how many responsibilities they have.
 */
export function DirectorBox({ director, tickerTick }: DirectorBoxProps) {
  const isDarkText = director.barText === "#1A1A1A"
  const eyebrowColor = isDarkText ? "#8C7E6A" : director.barText
  const eyebrowOpacity = isDarkText ? 1 : 0.85

  const enterOffice = () => {
    window.location.href = director.officeHref
  }

  const enterWorkroom = (href: string) => {
    window.location.href = href
  }

  return (
    <div
      style={{
        background: "#FEFCF9",
        border: "3px solid #1A1A1A",
        boxShadow: "4px 4px 0 #1A1A1A",
        display: "flex",
        flexDirection: "column",
        height: 295,
      }}
    >
      {/* Bar - entire surface clickable to enter the office */}
      <button
        type="button"
        onClick={enterOffice}
        aria-label={`Open the ${director.title} office`}
        style={{
          position: "relative",
          padding: 16,
          height: 185,
          flexShrink: 0,
          backgroundColor: director.barBg,
          color: director.barText,
          backgroundImage: `repeating-linear-gradient(135deg, transparent 0 18px, ${director.barStripe} 18px 21px)`,
          boxSizing: "border-box",
          overflow: "hidden",
          border: "none",
          width: "100%",
          textAlign: "left",
          cursor: "pointer",
          fontFamily: "inherit",
          display: "block",
        }}
      >
        {/* Icon + title stack */}
        <div style={{ display: "flex", alignItems: "flex-start", gap: 14 }}>
          <div style={{ flexShrink: 0, lineHeight: 0 }}>
            <WorkroomIcon
              name={director.headerIcon}
              size={36}
              color={director.barText}
            />
          </div>
          <div style={{ flex: 1, minWidth: 0 }}>
            <div
              style={{
                fontFamily: "var(--font-mono, monospace)",
                fontSize: 13,
                fontWeight: 700,
                letterSpacing: "0.1em",
                textTransform: "uppercase",
                lineHeight: 1,
                marginBottom: 4,
                color: eyebrowColor,
                opacity: eyebrowOpacity,
              }}
            >
              Director
            </div>
            <div
              style={{
                fontWeight: 800,
                fontSize: 28,
                lineHeight: 1,
                letterSpacing: "-0.01em",
                textTransform: "uppercase",
              }}
            >
              {director.title}
            </div>
          </div>
        </div>

        {/* Black feed window */}
        <div
          style={{
            position: "absolute",
            bottom: 16,
            left: 16,
            right: 80,
            height: 60,
            background: "#1A1A1A",
            padding: "8px 12px",
            boxSizing: "border-box",
            zIndex: 2,
          }}
        >
          <Ticker
            label={director.feedLabel}
            messages={director.feedMessages}
            externalIndex={tickerTick}
            vertical
          />
        </div>

        {/* Door + Enter label */}
        <div
          style={{
            position: "absolute",
            bottom: 14,
            right: 14,
            textAlign: "center",
            lineHeight: 1,
            zIndex: 1,
            color: director.barText,
          }}
        >
          <WorkroomIcon name="door-enter" size={44} color={director.barText} />
          <div
            style={{
              fontFamily: "var(--font-mono, monospace)",
              fontSize: 10,
              fontWeight: 700,
              letterSpacing: "0.12em",
              textTransform: "uppercase",
              marginTop: 3,
              color: director.barText,
            }}
          >
            Enter →
          </div>
        </div>
      </button>

      {/* Yellow accent stripe */}
      <div style={{ height: 7, background: "#F5C230", flexShrink: 0 }} />

      {/* Responsibilities */}
      <div
        style={{
          padding: "12px 16px 14px",
          display: "flex",
          flexDirection: "column",
          gap: 4,
          flex: 1,
          background: "#FEFCF9",
        }}
      >
        <div
          style={{
            fontFamily: "var(--font-mono, monospace)",
            fontSize: 9,
            fontWeight: 700,
            letterSpacing: "0.16em",
            textTransform: "uppercase",
            color: "#8C7E6A",
            marginBottom: 3,
          }}
        >
          Responsibilities
        </div>
        {director.workrooms.map((wr) => (
          <button
            key={wr.title}
            type="button"
            onClick={() => enterWorkroom(wr.href)}
            style={{
              display: "flex",
              alignItems: "center",
              gap: 10,
              fontSize: 13,
              fontWeight: 600,
              color: "#1A1A1A",
              padding: "2px 0",
              background: "none",
              border: "none",
              cursor: "pointer",
              fontFamily: "inherit",
              textAlign: "left",
              width: "100%",
            }}
          >
            <WorkroomIcon name={wr.icon} size={16} color="#3366CC" />
            <span style={{ flex: 1 }}>{wr.title}</span>
            <WorkroomIcon name="arrow-right" size={12} color="rgba(140,126,106,0.5)" />
          </button>
        ))}
      </div>
    </div>
  )
}