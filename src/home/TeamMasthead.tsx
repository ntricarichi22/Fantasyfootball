"use client"

import { useEffect, useRef, useState } from "react"
import type { TeamTheme } from "./teamTheme"

const INK = "#1A1A1A"
const PAPER = "#F5F0E6"

export type TeamMastheadProps = {
  teamName: string
  /** Per-team logo, e.g. "/teams/virginia-founders.png" (optional / may 404) */
  crestSrc?: string
  /** band drives the letterhead rules + monogram; text/accent kept for API compat */
  theme: TeamTheme
  /** Slim variant for mobile */
  compact?: boolean
}

function monogram(teamName: string): string {
  const words = teamName.trim().split(/\s+/).filter(Boolean)
  if (words.length === 0) return "—"
  if (words.length === 1) return words[0].slice(0, 2).toUpperCase()
  return (words[0][0] + words[words.length - 1][0]).toUpperCase()
}

/**
 * Team letterhead: a cream sheet of front-office stationery on the desk —
 * crest, wordmark, the FRONT OFFICE department line, and a double rule in
 * the team's identity color. Deliberately the quietest object on the page;
 * the ID badges below carry the loud vintage energy. (Tenure/rings live on
 * the GM badge, so they don't repeat here.)
 */
export function TeamMasthead({
  teamName,
  crestSrc,
  theme,
  compact = false,
}: TeamMastheadProps) {
  const [logoFailed, setLogoFailed] = useState(false)
  const showLogo = !!crestSrc && !logoFailed

  const maxFs = compact ? 17 : 24
  const minFs = compact ? 12 : 14
  const crestH = compact ? 26 : 34

  // auto-fit the wordmark to the available width
  const boxRef = useRef<HTMLDivElement>(null)
  const nameRef = useRef<HTMLSpanElement>(null)
  const [fs, setFs] = useState(maxFs)
  useEffect(() => {
    const fit = () => {
      const box = boxRef.current
      const el = nameRef.current
      if (!box || !el) return
      let size = maxFs
      el.style.fontSize = `${size}px`
      let guard = 0
      while (el.scrollWidth > box.clientWidth && size > minFs && guard < 60) {
        size -= 1
        el.style.fontSize = `${size}px`
        guard++
      }
      setFs(size)
    }
    fit()
    // Syne is a webfont — refit once it lands so the first paint's fallback
    // metrics can't leave the wordmark clipped on slow connections.
    document.fonts?.ready?.then(fit)
    window.addEventListener("resize", fit)
    return () => window.removeEventListener("resize", fit)
  }, [teamName, maxFs, minFs])

  return (
    <div
      style={{
        background: PAPER,
        boxShadow: "3px 3px 0 rgba(26,26,26,0.22)",
        padding: compact ? "10px 12px 8px" : "13px 18px 11px",
        flexShrink: 0,
      }}
    >
      <div style={{ display: "flex", alignItems: "center", gap: compact ? 8 : 12 }}>
        {showLogo ? (
          <img
            src={crestSrc}
            alt={`${teamName} logo`}
            onError={() => setLogoFailed(true)}
            style={{ width: crestH, height: crestH, objectFit: "contain", display: "block", flexShrink: 0 }}
          />
        ) : (
          <span
            style={{
              fontFamily: "Syne, sans-serif",
              fontWeight: 900,
              fontSize: compact ? 11 : 13,
              color: theme.band,
              border: `2.5px solid ${theme.band}`,
              padding: "2px 5px",
              flexShrink: 0,
            }}
          >
            {monogram(teamName)}
          </span>
        )}
        {/* The fit box wraps ONLY the wordmark, so clientWidth is exactly the
            space the name may use — the crest and stats never skew the fit. */}
        <div ref={boxRef} style={{ flex: 1, minWidth: 0, overflow: "hidden" }}>
          <span
            ref={nameRef}
            style={{
              fontFamily: "Syne, sans-serif",
              fontWeight: 900,
              fontSize: fs,
              letterSpacing: "0.01em",
              lineHeight: 1,
              color: INK,
              whiteSpace: "nowrap",
              display: "inline-block",
            }}
          >
            {teamName.toUpperCase()}
          </span>
        </div>
      </div>

      {/* the double rule in the team's identity color */}
      <div style={{ marginTop: compact ? 7 : 10, borderTop: `3px solid ${theme.band}` }} />
      <div style={{ marginTop: 2, borderTop: `1px solid ${theme.band}` }} />
    </div>
  )
}
