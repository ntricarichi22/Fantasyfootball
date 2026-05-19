"use client"

export type HomeTopbarProps = {
  teamName?: string
  searchHref?: string
}

function getInitials(teamName: string): string {
  if (!teamName || teamName === "—") return "—"
  const words = teamName.trim().split(/\s+/)
  if (words.length === 0) return "—"
  if (words.length === 1) return words[0].slice(0, 2).toUpperCase()
  return (words[0][0] + words[words.length - 1][0]).toUpperCase()
}

/**
 * Top bar shown above the home page hero. CFC diagonal brand block plus
 * the "Front Office" wordmark on the left. On the right: a small avatar
 * circle showing the team's initials (or "—" if no team is loaded), then
 * the search button.
 */
export function HomeTopbar({
  teamName = "—",
  searchHref = "/search",
}: HomeTopbarProps) {
  const openSearch = () => {
    window.location.href = searchHref
  }

  const initials = getInitials(teamName)

  return (
    <div
      style={{
        display: "flex",
        justifyContent: "space-between",
        alignItems: "center",
        padding: "8px 24px",
        background: "#FEFCF9",
        borderBottom: "2px solid #1A1A1A",
      }}
    >
      {/* Brand */}
      <div style={{ display: "flex", alignItems: "center", gap: 14 }}>
        <div
          style={{
            background: "#1A1A1A",
            color: "#FEFCF9",
            fontWeight: 800,
            fontSize: 18,
            letterSpacing: "0.04em",
            padding: "7px 26px 7px 14px",
            clipPath: "polygon(0 0, 100% 0, calc(100% - 14px) 100%, 0 100%)",
          }}
        >
          CFC
        </div>
        <div
          style={{
            fontFamily: "var(--font-mono, monospace)",
            fontSize: 12,
            fontWeight: 700,
            letterSpacing: "0.18em",
            textTransform: "uppercase",
            color: "#1A1A1A",
          }}
        >
          Front Office
        </div>
      </div>

      {/* User controls */}
      <div style={{ display: "flex", alignItems: "center", gap: 12 }}>
        <div
          aria-label={`Team: ${teamName}`}
          style={{
            width: 32,
            height: 32,
            borderRadius: "50%",
            background: "#FEFCF9",
            border: "2px solid #1A1A1A",
            display: "flex",
            alignItems: "center",
            justifyContent: "center",
            fontFamily: "var(--font-mono, monospace)",
            fontSize: 11,
            fontWeight: 700,
            color: "#1A1A1A",
            letterSpacing: "0.04em",
          }}
        >
          {initials}
        </div>

        <button
          type="button"
          onClick={openSearch}
          aria-label="Search"
          style={{
            width: 32,
            height: 32,
            background: "none",
            border: "2px solid #1A1A1A",
            cursor: "pointer",
            color: "#1A1A1A",
            display: "flex",
            alignItems: "center",
            justifyContent: "center",
            padding: 0,
          }}
        >
          <svg
            width={16}
            height={16}
            viewBox="0 0 24 24"
            fill="none"
            stroke="currentColor"
            strokeWidth={2}
            strokeLinecap="round"
            strokeLinejoin="round"
            aria-hidden="true"
          >
            <circle cx={11} cy={11} r={7} />
            <path d="M21 21l-5-5" />
          </svg>
        </button>
      </div>
    </div>
  )
}