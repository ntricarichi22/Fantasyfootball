"use client"

import { useEffect, useRef, useState } from "react"
import type { TeamTheme } from "./teamTheme"

const INK = "#1A1A1A"
const BRASS = "#B08D57"

export type TeamMastheadProps = {
  teamName: string
  /** Per-team logo, e.g. "/teams/virginia-founders.png" (optional / may 404) */
  crestSrc?: string
  theme: TeamTheme
  seasons: number
  rings: number
  /** Slim single-line variant for mobile */
  compact?: boolean
}

function monogram(teamName: string): string {
  const words = teamName.trim().split(/\s+/).filter(Boolean)
  if (words.length === 0) return "—"
  if (words.length === 1) return words[0].slice(0, 2).toUpperCase()
  return (words[0][0] + words[words.length - 1][0]).toUpperCase()
}

/**
 * Team identity banner across the top of the front office: a crest (team
 * logo, or a monogram fallback while logos aren't uploaded), the team
 * wordmark, an accent rule, and a seasons/rings stat line. Colors come
 * from the per-team theme so the banner reads in the team's colors.
 */
export function TeamMasthead({
  teamName,
  crestSrc,
  theme,
  seasons,
  rings,
  compact = false,
}: TeamMastheadProps) {
  const [logoFailed, setLogoFailed] = useState(false)
  const imgRef = useRef<HTMLImageElement>(null)
  const showLogo = !!crestSrc && !logoFailed

  useEffect(() => {
    const img = imgRef.current
    if (img && img.complete && img.naturalWidth === 0) setLogoFailed(true)
  }, [])

  const crestSize = compact ? 34 : 76
  const stats = `${seasons} SEASON${seasons === 1 ? "" : "S"} · ${rings} RING${rings === 1 ? "" : "S"}`

  const crest = (
    <div
      style={{
        width: crestSize,
        height: crestSize,
        borderRadius: "50%",
        background: theme.text,
        border: `3px solid ${BRASS}`,
        flexShrink: 0,
        overflow: "hidden",
        display: "flex",
        alignItems: "center",
        justifyContent: "center",
      }}
    >
      {showLogo ? (
        <img
          ref={imgRef}
          src={crestSrc}
          alt={`${teamName} logo`}
          onError={() => setLogoFailed(true)}
          style={{ width: "100%", height: "100%", objectFit: "cover", display: "block" }}
        />
      ) : (
        <span style={{ fontFamily: "Impact, system-ui, sans-serif", fontSize: compact ? 14 : 26, color: INK, letterSpacing: "0.02em" }}>
          {monogram(teamName)}
        </span>
      )}
    </div>
  )

  if (compact) {
    return (
      <div
        style={{
          display: "flex",
          alignItems: "center",
          gap: 10,
          background: theme.band,
          border: `2px solid ${INK}`,
          borderRadius: 10,
          boxShadow: `3px 3px 0 ${INK}`,
          padding: "6px 10px",
          boxSizing: "border-box",
        }}
      >
        {crest}
        <div style={{ minWidth: 0, flex: 1 }}>
          <div
            style={{
              fontFamily: "Impact, system-ui, sans-serif",
              fontSize: 18,
              color: theme.text,
              lineHeight: 1,
              letterSpacing: "0.01em",
              whiteSpace: "nowrap",
              overflow: "hidden",
              textOverflow: "ellipsis",
            }}
          >
            {teamName.toUpperCase()}
          </div>
          <div style={{ fontFamily: "'JetBrains Mono', monospace", fontSize: 9, fontWeight: 700, letterSpacing: "0.12em", color: theme.accent, marginTop: 2 }}>
            {stats}
          </div>
        </div>
      </div>
    )
  }

  return (
    <div
      style={{
        display: "flex",
        alignItems: "center",
        gap: 18,
        background: theme.band,
        border: `3px solid ${INK}`,
        borderRadius: 12,
        boxShadow: `4px 4px 0 ${INK}`,
        padding: "14px 20px",
        boxSizing: "border-box",
        flexShrink: 0,
      }}
    >
      {crest}
      <div style={{ minWidth: 0, flex: 1 }}>
        <div
          style={{
            fontFamily: "Impact, system-ui, sans-serif",
            fontSize: 40,
            color: theme.text,
            lineHeight: 0.92,
            letterSpacing: "0.01em",
            whiteSpace: "nowrap",
            overflow: "hidden",
            textOverflow: "ellipsis",
          }}
        >
          {teamName.toUpperCase()}
        </div>
        <div style={{ display: "flex", alignItems: "center", gap: 10, marginTop: 7 }}>
          <div style={{ height: 3, width: 32, background: theme.accent, flexShrink: 0 }} />
          <span style={{ fontFamily: "'JetBrains Mono', monospace", fontSize: 11, fontWeight: 700, letterSpacing: "0.14em", color: theme.accent }}>
            {stats}
          </span>
        </div>
      </div>
    </div>
  )
}
