"use client"

import { useEffect, useRef, useState } from "react"
import type { TeamTheme } from "./teamTheme"

const INK = "#13131A"
const BRASS = "#B08D57"

export type TeamMastheadProps = {
  teamName: string
  /** Per-team logo, e.g. "/teams/virginia-founders.png" (optional / may 404) */
  crestSrc?: string
  /** band = torn strip color, accent = page color, text = wordmark color */
  theme: TeamTheme
  seasons: number
  rings: number
  /** Years this team won the title, e.g. [2021, 2022] */
  titleYears?: number[]
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
 * Team identity banner: a torn navy strip ripped across the team's page
 * color, with the crest bursting through it and the wordmark on the strip.
 * Topps/80s energy via the ragged feTurbulence tear edges. Colors come
 * from the per-team theme. The wordmark auto-shrinks to always fit.
 */
export function TeamMasthead({
  teamName,
  crestSrc,
  theme,
  seasons,
  rings,
  titleYears = [],
  compact = false,
}: TeamMastheadProps) {
  const [logoFailed, setLogoFailed] = useState(false)
  const imgRef = useRef<HTMLImageElement>(null)
  const showLogo = !!crestSrc && !logoFailed

  useEffect(() => {
    const img = imgRef.current
    if (img && img.complete && img.naturalWidth === 0) setLogoFailed(true)
  }, [])

  // sizing
  const bandH = compact ? 56 : 162
  const crestH = compact ? 76 : 206
  const crestLeft = compact ? 6 : 26
  const maxFs = compact ? 22 : 60
  const minFs = compact ? 13 : 26
  const stripTop = compact ? 7 : 18
  const stripH = bandH - stripTop * 2
  const wordLeft = crestLeft + crestH * 0.86 + (compact ? 8 : 22)

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
      while (el.scrollWidth > box.clientWidth && size > minFs && guard < 120) {
        size -= 1
        el.style.fontSize = `${size}px`
        guard++
      }
      setFs(size)
    }
    fit()
    window.addEventListener("resize", fit)
    return () => window.removeEventListener("resize", fit)
  }, [teamName, maxFs, minFs, wordLeft])

  const stats =
    `${seasons} SEASON${seasons === 1 ? "" : "S"} · ${rings} RING${rings === 1 ? "" : "S"}` +
    (titleYears.length ? ` · ${titleYears.join(", ")}` : "")

  const crest = (
    <div
      style={{
        width: crestH * 0.95,
        height: crestH,
        display: "flex",
        alignItems: "center",
        justifyContent: "center",
        filter: "drop-shadow(3px 4px 0 rgba(0,0,0,0.4))",
      }}
    >
      {showLogo ? (
        <img
          ref={imgRef}
          src={crestSrc}
          alt={`${teamName} logo`}
          onError={() => setLogoFailed(true)}
          style={{ width: "100%", height: "100%", objectFit: "contain", display: "block" }}
        />
      ) : (
        <div
          style={{
            width: crestH * 0.82,
            height: crestH * 0.82,
            borderRadius: "50%",
            background: theme.band,
            border: `4px solid ${BRASS}`,
            display: "flex",
            alignItems: "center",
            justifyContent: "center",
          }}
        >
          <span style={{ fontFamily: "Impact, system-ui, sans-serif", fontSize: crestH * 0.3, color: theme.accent }}>
            {monogram(teamName)}
          </span>
        </div>
      )}
    </div>
  )

  return (
    <div style={{ position: "relative", width: "100%", height: bandH, flexShrink: 0 }}>
      {/* Band: page color + torn navy strip, clipped to the band rect */}
      <div
        style={{
          position: "absolute",
          inset: 0,
          background: theme.accent,
          border: `3px solid ${INK}`,
          borderRadius: 3,
          overflow: "hidden",
          boxSizing: "border-box",
          boxShadow: `4px 4px 0 ${INK}`,
        }}
      >
        {/* zubaz texture on the page */}
        <div
          style={{
            position: "absolute",
            inset: 0,
            background: `repeating-linear-gradient(118deg, rgba(0,0,0,0.06) 0 14px, transparent 14px 30px)`,
          }}
        />
        {/* torn navy strip */}
        <svg
          width="100%"
          height={bandH}
          viewBox={`0 0 1000 ${bandH}`}
          preserveAspectRatio="none"
          style={{ position: "absolute", inset: 0, display: "block" }}
        >
          <defs>
            <filter id="mh-tear" x="-3%" y="-40%" width="106%" height="180%">
              <feTurbulence type="fractalNoise" baseFrequency="0.02 0.06" numOctaves="3" seed="6" result="n" />
              <feDisplacementMap in="SourceGraphic" in2="n" scale={compact ? 7 : 12} />
            </filter>
          </defs>
          <rect x="-20" y={stripTop} width="1040" height={stripH} fill={theme.band} filter="url(#mh-tear)" />
          <rect
            x="-20"
            y={stripTop}
            width="1040"
            height={stripH}
            fill="none"
            stroke="#FEFCF9"
            strokeWidth={compact ? 2.5 : 4}
            filter="url(#mh-tear)"
          />
        </svg>
      </div>

      {/* Crest bursting through the strip */}
      <div
        style={{
          position: "absolute",
          left: crestLeft,
          top: (bandH - crestH) / 2,
          height: crestH,
          zIndex: 3,
        }}
      >
        {crest}
      </div>

      {/* Wordmark + stats, vertically centered on the strip */}
      <div
        ref={boxRef}
        style={{
          position: "absolute",
          left: wordLeft,
          right: compact ? 10 : 28,
          top: 0,
          bottom: 0,
          zIndex: 4,
          display: "flex",
          flexDirection: "column",
          alignItems: "center",
          justifyContent: "center",
          textAlign: "center",
        }}
      >
        <span
          ref={nameRef}
          style={{
            display: "inline-block",
            whiteSpace: "nowrap",
            fontFamily: "Impact, 'Arial Black', sans-serif",
            fontSize: fs,
            lineHeight: 0.92,
            letterSpacing: "0.01em",
            color: theme.text,
            textShadow: `3px 3px 0 ${INK}`,
          }}
        >
          {teamName.toUpperCase()}
        </span>
        <span
          style={{
            fontFamily: "'JetBrains Mono', monospace",
            fontSize: compact ? 9 : 13,
            fontWeight: 700,
            letterSpacing: "0.14em",
            color: theme.text,
            opacity: 0.92,
            marginTop: compact ? 2 : 7,
            whiteSpace: "nowrap",
          }}
        >
          {stats}
        </span>
      </div>
    </div>
  )
}
