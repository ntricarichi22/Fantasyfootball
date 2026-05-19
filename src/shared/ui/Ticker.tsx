"use client"

import { useEffect, useState } from "react"

export type TickerProps = {
  label: string
  messages: string[]
  externalIndex?: number
  vertical?: boolean
}

const PULSE_KEYFRAMES = `
@keyframes cfc-ticker-pulse {
  0%, 100% { opacity: 0.45; }
  50% { opacity: 1; }
}
`

export function Ticker({
  label,
  messages,
  externalIndex,
  vertical = false,
}: TickerProps) {
  const [internalIndex, setInternalIndex] = useState(0)

  useEffect(() => {
    if (externalIndex !== undefined) return
    const id = setInterval(() => {
      setInternalIndex((i) => i + 1)
    }, 3500)
    return () => clearInterval(id)
  }, [externalIndex])

  const idx = externalIndex ?? internalIndex
  const message = messages.length > 0 ? messages[idx % messages.length] : ""

  if (vertical) {
    return (
      <>
        <style>{PULSE_KEYFRAMES}</style>
        <div
          style={{
            display: "flex",
            flexDirection: "column",
            gap: 5,
            justifyContent: "center",
            height: "100%",
            width: "100%",
          }}
        >
          <div
            style={{
              display: "flex",
              alignItems: "center",
              gap: 7,
              fontFamily: "var(--font-mono, monospace)",
              fontSize: 11,
              fontWeight: 700,
              letterSpacing: "0.14em",
              textTransform: "uppercase",
              color: "#F5C230",
              lineHeight: 1,
              animation: "cfc-ticker-pulse 1.6s ease-in-out infinite",
            }}
          >
            <span
              style={{
                width: 8,
                height: 8,
                borderRadius: "50%",
                background: "#F5C230",
                flexShrink: 0,
              }}
            />
            {label}
          </div>
          <div
            style={{
              fontSize: 12,
              lineHeight: 1.32,
              fontWeight: 500,
              color: "#FEFCF9",
            }}
          >
            {message}
          </div>
        </div>
      </>
    )
  }

  // Horizontal mode (legacy callers)
  return (
    <>
      <style>{PULSE_KEYFRAMES}</style>
      <div
        style={{
          display: "flex",
          alignItems: "center",
          gap: 10,
          background: "#1A1A1A",
          padding: "10px 14px",
          color: "#FEFCF9",
        }}
      >
        <span
          style={{
            display: "flex",
            alignItems: "center",
            gap: 8,
            animation: "cfc-ticker-pulse 1.6s ease-in-out infinite",
          }}
        >
          <span
            style={{
              width: 8,
              height: 8,
              borderRadius: "50%",
              background: "#F5C230",
              flexShrink: 0,
            }}
          />
          <span
            style={{
              fontFamily: "var(--font-mono, monospace)",
              fontSize: 11,
              fontWeight: 700,
              letterSpacing: "0.14em",
              textTransform: "uppercase",
              color: "#F5C230",
            }}
          >
            {label}
          </span>
        </span>
        <span style={{ opacity: 0.4 }}>·</span>
        <span style={{ fontSize: 13 }}>{message}</span>
      </div>
    </>
  )
}